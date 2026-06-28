"""Tests for the Sales Weekly Digest metrics service (TED-567).

Reference date is a fixed Sunday (2026-06-28), so:
  * last week  = Mon 2026-06-15 .. Sun 2026-06-21
  * prior week = Mon 2026-06-08 .. Sun 2026-06-14
  * Mon-Fri inactivity window = 2026-06-15 .. 2026-06-19
"""
from datetime import date, datetime, time
from zoneinfo import ZoneInfo

from django.core import mail
from django.core.management import call_command
from django.test import TestCase
from rest_framework.test import APIClient

from auth_app.models import CustomUser
from entries.models import ClassOfInsurance, SalesKPIEntry
from roles.models import Role, RoleModulePermission

from .models import Report, ReportSendLog, ReportSetting
from .scheduling import effective_schedule, is_due
from .services.sales_weekly_digest import SalesWeeklyDigestService

DUBAI = ZoneInfo('Asia/Dubai')
REF = date(2026, 6, 28)


class SalesWeeklyDigestServiceTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.role = Role.objects.create(name='Sales', data_visibility='own')
        RoleModulePermission.objects.create(role=cls.role, module='sales_kpi')
        cls.coi = ClassOfInsurance.objects.create(name='Motor')

        def user(email, name):
            return CustomUser.objects.create(email=email, full_name=name, role=cls.role)

        cls.alice = user('alice@x.com', 'Alice A')
        cls.bob = user('bob@x.com', 'Bob B')
        cls.carol = user('carol@x.com', 'Carol C')
        cls.dave = user('dave@x.com', 'Dave D')
        cls.eve = user('eve@x.com', 'Eve E')

        # --- closed deals (premium / conversion / performers) --------------
        # Last week wins: Alice 100k + 50k (2), Bob 20k (1)  => premium 170k
        cls._deal(cls.alice, 'won', 100000, closed_day=16)
        cls._deal(cls.alice, 'won', 50000, closed_day=18)
        cls._deal(cls.bob, 'won', 20000, closed_day=17)
        # Last week loss (Dave) -> closed_total = 4, conversion = 3/4 = 75%
        cls._deal(cls.dave, 'lost', 0, closed_day=19)
        # Prior week win: 100k, no losses -> prior conversion = 100%
        cls._deal(cls.alice, 'won', 100000, closed_day=10)

        # --- open pipeline (pending snapshot, date-independent) ------------
        cls._open(cls.alice, SalesKPIEntry.STATUS_LEAD)
        cls._open(cls.alice, SalesKPIEntry.STATUS_AWAITING_QUOTE)
        cls._open(cls.bob, SalesKPIEntry.STATUS_SHARED_WITH_CLIENT)

        # --- Mon-Fri logging activity (inactive-user detection) -----------
        # Active on >1 weekday => active; <=1 => inactive; none => Never.
        cls._activity(cls.alice, [15, 16, 17, 18, 19])
        cls._activity(cls.bob, [15, 16])
        # 1 weekday in last week's window (Jun 15) -> inactive; the Jun 1 / Jun 8
        # entries are out-of-window but exercise the all-time "Last Used" = max.
        cls._activity(cls.carol, [1, 8, 15])
        cls._activity(cls.dave, [15, 16, 17, 18, 19])
        # eve: no activity at all -> inactive, last_used "Never"

    # -- factory helpers ----------------------------------------------------
    @classmethod
    def _base(cls, assignee, status):
        # `date` (the enquiry date) is required but irrelevant to these metrics,
        # which bucket by status_changed_at / added_at.
        return SalesKPIEntry.objects.create(
            customer_name='C', entry_type='new', class_of_insurance=cls.coi,
            assignee=assignee, added_by=assignee, status=status,
            date=date(2026, 6, 15),
        )

    @classmethod
    def _deal(cls, assignee, status, converted, closed_day):
        e = cls._base(assignee, status)
        SalesKPIEntry.objects.filter(id=e.id).update(
            converted_premium=converted,
            status_changed_at=datetime(2026, 6, closed_day, 12, tzinfo=DUBAI),
        )

    @classmethod
    def _open(cls, assignee, status):
        cls._base(assignee, status)

    @classmethod
    def _activity(cls, user, days):
        # status_changed_at stays null -> invisible to closed/premium metrics;
        # counts only as a logged entry on its added_at local day.
        for d in days:
            e = cls._base(user, SalesKPIEntry.STATUS_WON)
            SalesKPIEntry.objects.filter(id=e.id).update(
                added_at=datetime(2026, 6, d, 10, tzinfo=DUBAI),
            )

    # -- tests --------------------------------------------------------------
    def setUp(self):
        self.m = SalesWeeklyDigestService(ref_date=REF).build()

    def test_week_windows(self):
        self.assertEqual(self.m['week_start'], date(2026, 6, 15))
        self.assertEqual(self.m['week_end'], date(2026, 6, 21))

    def test_converted_premium_and_delta(self):
        cp = self.m['converted_premium']
        self.assertEqual(cp['value'], 170000.0)
        self.assertEqual(cp['prior'], 100000.0)
        self.assertEqual(cp['delta']['pct'], 70.0)
        self.assertEqual(cp['delta']['direction'], 'up')

    def test_conversion_rate_and_delta(self):
        cr = self.m['conversion_rate']
        self.assertEqual(cr['value'], 75.0)        # 3 won / 4 closed
        self.assertEqual(cr['won_count'], 3)
        self.assertEqual(cr['closed_total'], 4)
        self.assertEqual(cr['prior'], 100.0)
        self.assertEqual(cr['delta']['pct'], -25.0)
        self.assertEqual(cr['delta']['direction'], 'down')

    def test_top_performers_assignee_and_order(self):
        performers = self.m['top_performers']
        self.assertEqual(len(performers), 2)
        self.assertEqual(performers[0]['name'], 'Alice A')
        self.assertEqual(performers[0]['premium'], 150000.0)
        self.assertEqual(performers[0]['won_count'], 2)
        self.assertEqual(performers[1]['name'], 'Bob B')
        self.assertEqual(performers[1]['won_count'], 1)

    def test_pending_snapshot(self):
        self.assertEqual(self.m['pending_count'], 3)

    def test_inactive_users(self):
        names = {u['name'] for u in self.m['inactive_users']}
        self.assertEqual(names, {'Carol C', 'Eve E'})
        eve = next(u for u in self.m['inactive_users'] if u['name'] == 'Eve E')
        self.assertIsNone(eve['last_used'])
        self.assertEqual(eve['last_used_display'], 'Never')
        # Carol logged only on Mon 2026-06-15 -> that is her all-time Last Used.
        carol = next(u for u in self.m['inactive_users'] if u['name'] == 'Carol C')
        self.assertEqual(carol['last_used'], '2026-06-15')


class ReportAPITests(TestCase):
    """Admin-only CRUD + activate/deactivate/send_test for the Reports API."""

    def setUp(self):
        self.admin = CustomUser.objects.create(
            email='admin@x.com', full_name='Admin', is_staff=True,
        )
        self.regular = CustomUser.objects.create(email='reg@x.com', full_name='Reg')
        self.client = APIClient()

    def test_requires_admin(self):
        self.assertIn(self.client.get('/api/reports/').status_code, (401, 403))
        self.client.force_authenticate(self.regular)
        self.assertEqual(self.client.get('/api/reports/').status_code, 403)

    def test_admin_crud_and_actions(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post(
            '/api/reports/',
            {'name': 'Digest', 'recipients': ['A@X.com', 'a@x.com', 'b@x.com']},
            format='json',
        )
        self.assertEqual(r.status_code, 201, r.content)
        rid = r.data['id']
        # Lowercased + deduped by the serializer.
        self.assertEqual(r.data['recipients'], ['a@x.com', 'b@x.com'])
        self.assertFalse(r.data['is_active'])  # created inactive

        self.assertEqual(self.client.post(f'/api/reports/{rid}/activate/').status_code, 200)
        self.assertTrue(Report.objects.get(id=rid).is_active)
        self.assertEqual(self.client.post(f'/api/reports/{rid}/deactivate/').status_code, 200)
        self.assertFalse(Report.objects.get(id=rid).is_active)

        resp = self.client.post(f'/api/reports/{rid}/send_test/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(len(mail.outbox), 1)
        self.assertEqual(mail.outbox[0].to, ['admin@x.com'])
        self.assertEqual(mail.outbox[0].subject, 'Sales Weekly Digest - System Generated')

        self.assertEqual(self.client.delete(f'/api/reports/{rid}/').status_code, 204)

    def test_invalid_email_rejected(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post(
            '/api/reports/', {'name': 'D', 'recipients': ['not-an-email']}, format='json',
        )
        self.assertEqual(r.status_code, 400)

    def test_empty_recipients_rejected(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post(
            '/api/reports/', {'name': 'D', 'recipients': []}, format='json',
        )
        self.assertEqual(r.status_code, 400)

    def test_recipients_required_on_create(self):
        # Omitting recipients entirely must also be rejected (not silently []).
        self.client.force_authenticate(self.admin)
        r = self.client.post('/api/reports/', {'name': 'D'}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_send_now_delivers_to_recipients(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post(
            '/api/reports/',
            {'name': 'D', 'recipients': ['a@x.com', 'b@x.com']},
            format='json',
        )
        rid = r.data['id']
        mail.outbox.clear()
        resp = self.client.post(f'/api/reports/{rid}/send_now/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['sent'], 2)
        # Goes to the configured recipients, NOT the requesting admin.
        self.assertEqual(sorted(m.to[0] for m in mail.outbox), ['a@x.com', 'b@x.com'])
        self.assertTrue(ReportSendLog.objects.filter(report_id=rid).exists())

    def test_send_now_requires_recipients(self):
        # A report with no recipients can't exist via the API, but guard anyway.
        report = Report.objects.create(name='Empty', recipients=[])
        self.client.force_authenticate(self.admin)
        resp = self.client.post(f'/api/reports/{report.id}/send_now/')
        self.assertEqual(resp.status_code, 400)

    def test_send_now_requires_admin(self):
        report = Report.objects.create(name='R', recipients=['a@x.com'])
        self.client.force_authenticate(self.regular)
        self.assertEqual(
            self.client.post(f'/api/reports/{report.id}/send_now/').status_code, 403,
        )

    def test_custom_subject_used_in_email(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post(
            '/api/reports/',
            {'name': 'D', 'subject': 'My Custom Subject', 'recipients': ['a@x.com']},
            format='json',
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.data['subject'], 'My Custom Subject')
        mail.outbox.clear()
        self.client.post(f'/api/reports/{r.data["id"]}/send_now/')
        self.assertEqual(mail.outbox[0].subject, 'My Custom Subject')

    def test_default_subject_when_omitted(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post(
            '/api/reports/', {'name': 'D', 'recipients': ['a@x.com']}, format='json',
        )
        self.assertEqual(r.data['subject'], 'Sales Weekly Digest - System Generated')

    def test_per_report_schedule_override_via_api(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post(
            '/api/reports/',
            {'name': 'X', 'recipients': ['a@x.com'], 'send_weekday': 2, 'send_time': '07:30'},
            format='json',
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertEqual(r.data['send_weekday'], 2)
        self.assertEqual(r.data['send_time'], '07:30:00')

    def test_invalid_weekday_rejected(self):
        self.client.force_authenticate(self.admin)
        r = self.client.post(
            '/api/reports/',
            {'name': 'X', 'recipients': ['a@x.com'], 'send_weekday': 9},
            format='json',
        )
        self.assertEqual(r.status_code, 400)


DUBAI = ZoneInfo('Asia/Dubai')


class SchedulingTests(TestCase):
    def setUp(self):
        self.setting = ReportSetting.load()  # defaults: Monday (0) @ 06:00

    def test_effective_schedule_fallback_and_override(self):
        default_report = Report(name='x')
        self.assertEqual(effective_schedule(default_report, self.setting), (0, time(6, 0)))
        custom = Report(name='y', send_weekday=2, send_time=time(9, 30))
        self.assertEqual(effective_schedule(custom, self.setting), (2, time(9, 30)))

    def test_is_due(self):
        report = Report(name='x')  # global default: Monday 06:00
        # Wed 2026-06-24 10:00 — this week's Monday 06:00 already passed -> due.
        self.assertTrue(is_due(report, self.setting, datetime(2026, 6, 24, 10, 0, tzinfo=DUBAI)))
        # Mon 2026-06-22 05:00 — before 06:00 -> not due.
        self.assertFalse(is_due(report, self.setting, datetime(2026, 6, 22, 5, 0, tzinfo=DUBAI)))
        # Override to Friday 08:00; on Wednesday it isn't due yet.
        report.send_weekday, report.send_time = 4, time(8, 0)
        self.assertFalse(is_due(report, self.setting, datetime(2026, 6, 24, 10, 0, tzinfo=DUBAI)))

    def test_force_sends_all_active_regardless_of_schedule(self):
        Report.objects.create(name='A', recipients=['a@x.com'], is_active=True)
        Report.objects.create(name='B', recipients=['b@x.com'], is_active=False)
        mail.outbox.clear()
        call_command('send_weekly_sales_digest', '--force')
        self.assertEqual([m.to[0] for m in mail.outbox], ['a@x.com'])


class ReportSettingAPITests(TestCase):
    def setUp(self):
        self.admin = CustomUser.objects.create(email='admin@x.com', full_name='A', is_staff=True)
        self.regular = CustomUser.objects.create(email='reg@x.com', full_name='R')
        self.client = APIClient()

    def test_get_and_patch_defaults(self):
        self.client.force_authenticate(self.admin)
        r = self.client.get('/api/reports/settings/')
        self.assertEqual(r.status_code, 200)
        self.assertEqual(r.data['default_send_weekday'], 0)
        r = self.client.patch(
            '/api/reports/settings/',
            {'default_send_weekday': 3, 'default_send_time': '09:00'},
            format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)
        s = ReportSetting.load()
        self.assertEqual(s.default_send_weekday, 3)
        self.assertEqual(s.default_send_time, time(9, 0))

    def test_requires_admin(self):
        self.assertIn(self.client.get('/api/reports/settings/').status_code, (401, 403))
        self.client.force_authenticate(self.regular)
        self.assertEqual(self.client.get('/api/reports/settings/').status_code, 403)
