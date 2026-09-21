"""Tests for the Void (write-off) feature (TED-594).

Void marks an entry as written off: it keeps the row for audit but excludes it
from every dashboard metric/report, freezes it from further edits, and (for
panel-backed modules) records the reason as an immutable "Void Reason" remark.

SalesKPIEntry is used as the representative module — it is in
ALLOWED_REMARK_MODELS (so a void-reason remark is created) and has the premium
fields the dashboard aggregates.
"""
from datetime import date

from django.contrib.contenttypes.models import ContentType
from django.test import TestCase
from rest_framework.test import APIClient

from auth_app.models import CustomUser
from roles.models import Role, RoleModulePermission

from .models import ClassOfInsurance, EntryRemark, SalesKPIEntry


def void_url(pk):
    return f'/api/entries/sales-kpi/{pk}/void/'


class VoidActionTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.coi = ClassOfInsurance.objects.create(name='Motor')

        cls.sales_role = Role.objects.create(name='Sales', data_visibility='own')
        RoleModulePermission.objects.create(role=cls.sales_role, module='sales_kpi')

        cls.hod_role = Role.objects.create(name='Sales HOD', data_visibility='all', is_hod=True)
        RoleModulePermission.objects.create(role=cls.hod_role, module='sales_kpi')

        cls.creator = CustomUser.objects.create(
            email='creator@x.com', full_name='Cara Creator', role=cls.sales_role,
        )
        cls.other = CustomUser.objects.create(
            email='other@x.com', full_name='Otto Other', role=cls.sales_role,
        )
        cls.admin = CustomUser.objects.create(
            email='admin@x.com', full_name='Ada Admin', is_staff=True,
        )
        cls.hod = CustomUser.objects.create(
            email='hod@x.com', full_name='Hank Hod', role=cls.hod_role,
        )

    def setUp(self):
        self.client = APIClient()

    def _deal(self, added_by=None, status=SalesKPIEntry.STATUS_WON,
              converted='1000.00', potential='5000.00'):
        added_by = added_by or self.creator
        return SalesKPIEntry.objects.create(
            customer_name='C', entry_type='new', class_of_insurance=self.coi,
            assignee=added_by, added_by=added_by, status=status,
            date=date(2026, 7, 1),
            potential_premium=potential, converted_premium=converted,
        )

    # ── permission matrix ────────────────────────────────────────────────
    def test_creator_can_void_own_entry(self):
        entry = self._deal(self.creator)
        self.client.force_authenticate(self.creator)
        resp = self.client.post(void_url(entry.id), {'void_reason': 'Duplicate deal'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

        entry.refresh_from_db()
        self.assertTrue(entry.is_voided)
        self.assertEqual(entry.voided_by_id, self.creator.id)
        self.assertEqual(entry.void_reason, 'Duplicate deal')
        self.assertIsNotNone(entry.voided_at)

        # Serializer surfaces the void fields.
        self.assertTrue(resp.data['is_voided'])
        self.assertEqual(resp.data['void_reason'], 'Duplicate deal')
        self.assertEqual(resp.data['voided_by_name'], 'Cara Creator')

        # A "Void Reason" remark is created for this panel-backed module.
        ct = ContentType.objects.get_for_model(SalesKPIEntry)
        remark = EntryRemark.objects.get(content_type=ct, object_id=entry.id)
        self.assertEqual(remark.kind, EntryRemark.KIND_VOID)
        self.assertEqual(remark.text, 'Duplicate deal')
        self.assertEqual(remark.author_id, self.creator.id)

    def test_admin_can_void_another_users_entry(self):
        entry = self._deal(self.creator)
        self.client.force_authenticate(self.admin)
        resp = self.client.post(void_url(entry.id), {'void_reason': 'Written off by admin'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)
        entry.refresh_from_db()
        self.assertTrue(entry.is_voided)
        self.assertEqual(entry.voided_by_id, self.admin.id)

    def test_hod_cannot_void(self):
        entry = self._deal(self.creator)
        self.client.force_authenticate(self.hod)
        resp = self.client.post(void_url(entry.id), {'void_reason': 'nope'}, format='json')
        self.assertEqual(resp.status_code, 403, resp.content)
        entry.refresh_from_db()
        self.assertFalse(entry.is_voided)

    def test_non_owner_regular_user_cannot_void(self):
        # `other` has the module permission but data_visibility='own', so the
        # creator's entry is not in their queryset → 404 from get_object().
        entry = self._deal(self.creator)
        self.client.force_authenticate(self.other)
        resp = self.client.post(void_url(entry.id), {'void_reason': 'nope'}, format='json')
        self.assertEqual(resp.status_code, 404, resp.content)
        entry.refresh_from_db()
        self.assertFalse(entry.is_voided)

    # ── validation ───────────────────────────────────────────────────────
    def test_void_requires_a_reason(self):
        entry = self._deal(self.creator)
        self.client.force_authenticate(self.creator)
        resp = self.client.post(void_url(entry.id), {'void_reason': '   '}, format='json')
        self.assertEqual(resp.status_code, 400, resp.content)
        entry.refresh_from_db()
        self.assertFalse(entry.is_voided)

    def test_cannot_void_twice(self):
        entry = self._deal(self.creator)
        self.client.force_authenticate(self.creator)
        first = self.client.post(void_url(entry.id), {'void_reason': 'first'}, format='json')
        self.assertEqual(first.status_code, 200, first.content)
        second = self.client.post(void_url(entry.id), {'void_reason': 'again'}, format='json')
        self.assertEqual(second.status_code, 400, second.content)
        # Only one void-reason remark exists.
        ct = ContentType.objects.get_for_model(SalesKPIEntry)
        self.assertEqual(
            EntryRemark.objects.filter(content_type=ct, object_id=entry.id, kind=EntryRemark.KIND_VOID).count(),
            1,
        )

    # ── frozen after voiding ─────────────────────────────────────────────
    def test_voided_entry_cannot_be_edited(self):
        entry = self._deal(self.creator, status=SalesKPIEntry.STATUS_LEAD)
        self.client.force_authenticate(self.creator)
        self.assertEqual(
            self.client.post(void_url(entry.id), {'void_reason': 'x'}, format='json').status_code, 200,
        )
        resp = self.client.patch(
            f'/api/entries/sales-kpi/{entry.id}/', {'customer_name': 'Changed'}, format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.content)

    def test_voided_entry_cannot_be_deleted(self):
        entry = self._deal(self.creator)
        self.client.force_authenticate(self.creator)
        self.client.post(void_url(entry.id), {'void_reason': 'x'}, format='json')
        resp = self.client.delete(f'/api/entries/sales-kpi/{entry.id}/')
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertTrue(SalesKPIEntry.objects.filter(id=entry.id).exists())

    # ── read-only via the normal update path ─────────────────────────────
    def test_is_voided_is_read_only_on_update(self):
        # A client cannot flip is_voided via a normal PATCH — only the void
        # action can, and it enforces permission + a reason.
        entry = self._deal(self.creator, status=SalesKPIEntry.STATUS_LEAD)
        self.client.force_authenticate(self.creator)
        resp = self.client.patch(
            f'/api/entries/sales-kpi/{entry.id}/',
            {'is_voided': True, 'void_reason': 'sneaky'}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        entry.refresh_from_db()
        self.assertFalse(entry.is_voided)
        self.assertEqual(entry.void_reason, '')


class VoidStatsTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.coi = ClassOfInsurance.objects.create(name='Motor')
        cls.role = Role.objects.create(name='Sales', data_visibility='own')
        RoleModulePermission.objects.create(role=cls.role, module='sales_kpi')
        cls.user = CustomUser.objects.create(
            email='u@x.com', full_name='Uma User', role=cls.role,
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _deal(self, status=SalesKPIEntry.STATUS_WON, converted='100.00'):
        return SalesKPIEntry.objects.create(
            customer_name='C', entry_type='new', class_of_insurance=self.coi,
            assignee=self.user, added_by=self.user, status=status,
            date=date(2026, 7, 1), potential_premium='100.00', converted_premium=converted,
        )

    def test_voided_entries_excluded_from_stats_and_counted(self):
        self._deal()  # won, counted
        self._deal()  # won, counted
        voided = self._deal()  # won, then voided
        resp = self.client.post(void_url(voided.id), {'void_reason': 'oops'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.content)

        stats = self.client.get('/api/entries/sales-kpi/stats/')
        self.assertEqual(stats.status_code, 200, stats.content)
        self.assertEqual(stats.data['total'], 2)
        self.assertEqual(stats.data['won'], 2)
        self.assertEqual(stats.data['converted_premium_total'], 200.0)
        self.assertEqual(stats.data['voided'], 1)


class VoidRemarkImmutabilityTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.coi = ClassOfInsurance.objects.create(name='Motor')
        cls.role = Role.objects.create(name='Sales', data_visibility='own')
        RoleModulePermission.objects.create(role=cls.role, module='sales_kpi')
        cls.user = CustomUser.objects.create(
            email='u2@x.com', full_name='Val User', role=cls.role,
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def test_void_reason_remark_cannot_be_edited_or_deleted(self):
        entry = SalesKPIEntry.objects.create(
            customer_name='C', entry_type='new', class_of_insurance=self.coi,
            assignee=self.user, added_by=self.user, status=SalesKPIEntry.STATUS_WON,
            date=date(2026, 7, 1), potential_premium='100.00', converted_premium='100.00',
        )
        self.client.post(void_url(entry.id), {'void_reason': 'reason'}, format='json')
        ct = ContentType.objects.get_for_model(SalesKPIEntry)
        remark = EntryRemark.objects.get(content_type=ct, object_id=entry.id, kind=EntryRemark.KIND_VOID)

        # Serializer reports it as non-editable/deletable even to the author.
        listing = self.client.get(f'/api/entries/remarks/?content_type={ct.id}&object_id={entry.id}')
        self.assertEqual(listing.status_code, 200, listing.content)
        row = next(r for r in listing.data['results'] if r['id'] == remark.id)
        self.assertEqual(row['kind'], EntryRemark.KIND_VOID)
        self.assertFalse(row['can_edit'])
        self.assertFalse(row['can_delete'])

        # And the API enforces it.
        self.assertEqual(
            self.client.patch(f'/api/entries/remarks/{remark.id}/', {'text': 'x'}, format='json').status_code,
            403,
        )
        self.assertEqual(
            self.client.delete(f'/api/entries/remarks/{remark.id}/').status_code,
            403,
        )
