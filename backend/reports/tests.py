"""Tests for the Sales Weekly Digest (TED-567).

Reference date is a fixed Sunday (2026-06-28), so:
  * last week  = Mon 2026-06-15 .. Sun 2026-06-21
  * prior week = Mon 2026-06-08 .. Sun 2026-06-14
  * Mon-Fri inactivity window = 2026-06-15 .. 2026-06-19
All metrics bucket deals by ``added_at`` local day (Asia/Dubai).
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


class MetricsTests(TestCase):
    """Key Metrics + conversion + top performers, bucketed by added_at."""

    @classmethod
    def setUpTestData(cls):
        cls.coi = ClassOfInsurance.objects.create(name='Motor')
        # Deals are entered by an ops user; performers are credited via assignee.
        cls.ops = CustomUser.objects.create(email='ops@x.com', full_name='Ops')
        cls.alice = CustomUser.objects.create(email='alice@x.com', full_name='Alice A')
        cls.bob = CustomUser.objects.create(email='bob@x.com', full_name='Bob B')
        cls.dave = CustomUser.objects.create(email='dave@x.com', full_name='Dave D')

        WON, LOST = SalesKPIEntry.STATUS_WON, SalesKPIEntry.STATUS_LOST
        LEAD, AQ = SalesKPIEntry.STATUS_LEAD, SalesKPIEntry.STATUS_AWAITING_QUOTE
        # Last week (added_at Jun 15-21): total 7, won 3, pending 3, lost 1.
        cls._deal(cls.alice, WON, 100000, 16)
        cls._deal(cls.alice, WON, 50000, 18)
        cls._deal(cls.bob, WON, 20000, 17)
        cls._deal(cls.dave, LOST, None, 19)
        cls._deal(cls.dave, LEAD, None, 15)
        cls._deal(cls.dave, LEAD, None, 16)
        cls._deal(cls.dave, AQ, None, 17)
        # Prior week (added_at Jun 8-14): total 1, won 1.
        cls._deal(cls.alice, WON, 100000, 10)

    @classmethod
    def _deal(cls, assignee, status, converted, day):
        e = SalesKPIEntry.objects.create(
            customer_name='C', entry_type='new', class_of_insurance=cls.coi,
            assignee=assignee, added_by=cls.ops, status=status,
            date=date(2026, 6, 15), potential_premium=10000, converted_premium=converted,
        )
        SalesKPIEntry.objects.filter(id=e.id).update(
            added_at=datetime(2026, 6, day, 12, tzinfo=DUBAI),
        )

    def setUp(self):
        self.m = SalesWeeklyDigestService(ref_date=REF).build()
        self.km = {c['label']: c for c in self.m['key_metrics']}

    def test_key_metric_values(self):
        self.assertEqual(self.km['Total Enquiries']['value'], 7)
        self.assertEqual(self.km['Pending']['value'], 3)
        self.assertEqual(self.km['Won']['value'], 3)
        self.assertEqual(self.km['Potential Premium']['value'], 70000.0)
        self.assertEqual(self.km['Converted Premium']['value'], 170000.0)
        self.assertEqual(self.km['Potential Premium']['display'], '70K')
        self.assertEqual(self.km['Converted Premium']['display'], '170K')

    def test_deltas(self):
        self.assertEqual(self.km['Total Enquiries']['delta']['display'], '+600%')
        self.assertEqual(self.km['Won']['delta']['display'], '+200%')
        self.assertEqual(self.km['Converted Premium']['delta']['display'], '+70%')
        self.assertEqual(self.km['Pending']['delta']['direction'], 'new')  # prior 0

    def test_conversion_rate(self):
        cr = self.m['conversion_rate']
        self.assertEqual(cr['value'], 42.9)   # 3 won / 7 total
        self.assertEqual(cr['won_count'], 3)
        self.assertEqual(cr['total'], 7)
        self.assertEqual(cr['delta']['direction'], 'down')  # 42.9% vs 100%

    def test_top_performers(self):
        performers = self.m['top_performers']
        self.assertEqual([p['name'] for p in performers], ['Alice A', 'Bob B'])
        self.assertEqual(performers[0]['premium'], 150000.0)
        self.assertEqual(performers[0]['won_count'], 2)


class InactiveUsersTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.coi = ClassOfInsurance.objects.create(name='Motor')
        cls.role = Role.objects.create(name='Sales', data_visibility='own')
        RoleModulePermission.objects.create(role=cls.role, module='sales_kpi')

        def user(email, name):
            return CustomUser.objects.create(email=email, full_name=name, role=cls.role)
        cls.alice = user('alice@x.com', 'Alice A')
        cls.bob = user('bob@x.com', 'Bob B')
        cls.carol = user('carol@x.com', 'Carol C')
        cls.dave = user('dave@x.com', 'Dave D')
        cls.eve = user('eve@x.com', 'Eve E')

        cls._activity(cls.alice, [15, 16, 17, 18, 19])
        cls._activity(cls.dave, [15, 16, 17, 18, 19])
        cls._activity(cls.bob, [15, 16])
        cls._activity(cls.carol, [1, 8, 15])   # 1 weekday in window -> inactive
        # eve: no activity -> inactive, Last Used "Never"

    @classmethod
    def _activity(cls, user, days):
        for d in days:
            e = SalesKPIEntry.objects.create(
                customer_name='A', entry_type='new', class_of_insurance=cls.coi,
                assignee=user, added_by=user, status=SalesKPIEntry.STATUS_LEAD,
                date=date(2026, 6, 15),
            )
            SalesKPIEntry.objects.filter(id=e.id).update(
                added_at=datetime(2026, 6, d, 10, tzinfo=DUBAI),
            )

    def test_inactive_users(self):
        m = SalesWeeklyDigestService(ref_date=REF).build()
        names = {u['name'] for u in m['inactive_users']}
        self.assertEqual(names, {'Carol C', 'Eve E'})
        eve = next(u for u in m['inactive_users'] if u['name'] == 'Eve E')
        self.assertIsNone(eve['last_used'])
        self.assertEqual(eve['last_used_display'], 'Never')
        # Carol logged Jun 1 / 8 / 15 -> all-time Last Used is the max (Jun 15).
        carol = next(u for u in m['inactive_users'] if u['name'] == 'Carol C')
        self.assertEqual(carol['last_used'], '2026-06-15')


class ReportAPITests(TestCase):
    """Admin-only CRUD + activate/deactivate/send_test/send_now + subject/schedule."""

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
        self.assertEqual(r.data['recipients'], ['a@x.com', 'b@x.com'])
        self.assertFalse(r.data['is_active'])

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
        r = self.client.post('/api/reports/', {'name': 'D', 'recipients': []}, format='json')
        self.assertEqual(r.status_code, 400)

    def test_recipients_required_on_create(self):
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
        self.assertEqual(sorted(m.to[0] for m in mail.outbox), ['a@x.com', 'b@x.com'])
        self.assertTrue(ReportSendLog.objects.filter(report_id=rid).exists())

    def test_send_now_requires_recipients(self):
        report = Report.objects.create(name='Empty', recipients=[])
        self.client.force_authenticate(self.admin)
        self.assertEqual(self.client.post(f'/api/reports/{report.id}/send_now/').status_code, 400)

    def test_send_now_requires_admin(self):
        report = Report.objects.create(name='R', recipients=['a@x.com'])
        self.client.force_authenticate(self.regular)
        self.assertEqual(self.client.post(f'/api/reports/{report.id}/send_now/').status_code, 403)

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
