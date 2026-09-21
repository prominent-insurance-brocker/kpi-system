"""Tests for the terminal "Rejected" status stage (TED-595).

Rejected is an additional terminal status on the six enquiry modules
(general/motor/motor-fleet new & renewal). Once an entry is Rejected it is
frozen: it cannot be edited, deleted, or have its status changed again. Void
(the admin write-off) is deliberately still allowed. Rejecting also requires
confirming the Revision Count and No. of Quotes Compared (TED-595 comment).

MotorNewEntry represents the "new-type" machine (reachable from new/in_progress)
and MotorRenewalEntry the "renewal-type" machine (reachable from new).
"""
from datetime import date

from django.test import TestCase
from rest_framework.test import APIClient

from auth_app.models import CustomUser
from roles.models import Role, RoleModulePermission

from .models import MotorNewEntry, MotorRenewalEntry


class RejectedStatusTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.role = Role.objects.create(name='Enquiry', data_visibility='own')
        RoleModulePermission.objects.create(role=cls.role, module='motor_new')
        RoleModulePermission.objects.create(role=cls.role, module='motor_renewal')

        cls.creator = CustomUser.objects.create(
            email='creator@x.com', full_name='Cara Creator', role=cls.role,
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.creator)

    def _motor_new(self, status=MotorNewEntry.STATUS_NEW):
        return MotorNewEntry.objects.create(
            client_name='C', agent=self.creator, chassis_no='CH1',
            added_by=self.creator, status=status, date=date(2026, 7, 1),
            potential_premium='5000.00',
        )

    def _motor_renewal(self, status=MotorRenewalEntry.STATUS_NEW):
        return MotorRenewalEntry.objects.create(
            client_name='C', agent=self.creator, chassis_no='CH1',
            added_by=self.creator, status=status, date=date(2026, 7, 1),
        )

    # ── the state machine ────────────────────────────────────────────────
    def test_rejected_is_terminal_and_reachable(self):
        self.assertIn('rejected', dict(MotorNewEntry.STATUS_CHOICES))
        self.assertIn(MotorNewEntry.STATUS_REJECTED, MotorNewEntry.TERMINAL_STATUSES)
        # new-type: reachable from both active states.
        self.assertIn('rejected', MotorNewEntry.get_allowed_transitions('new'))
        self.assertIn('rejected', MotorNewEntry.get_allowed_transitions('in_progress'))
        # renewal-type: reachable from new.
        self.assertIn('rejected', MotorRenewalEntry.get_allowed_transitions('new'))
        # terminal → nowhere.
        self.assertEqual(MotorNewEntry.get_allowed_transitions('rejected'), [])

    def test_reject_new_type_via_api(self):
        entry = self._motor_new()
        resp = self.client.patch(
            f'/api/entries/motor-new/{entry.id}/update-status/',
            # TED-595: rejecting must confirm both counts.
            {'status': 'rejected', 'revisions': 2, 'quotes_compared': 3},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['status'], 'rejected')
        self.assertTrue(resp.data['is_terminal'])
        self.assertEqual(resp.data['allowed_transitions'], [])

        entry.refresh_from_db()
        self.assertEqual(entry.status, 'rejected')
        self.assertEqual(entry.revisions, 2)             # confirmed counts saved
        self.assertEqual(entry.quotes_compared, 3)
        self.assertIsNotNone(entry.status_changed_at)   # terminal → stamped
        self.assertEqual(entry.converted_premium, 0)     # zeroed like Lost
        # An audit transition row was written.
        self.assertTrue(
            entry.status_transitions.filter(to_status='rejected').exists()
        )

    def test_reject_renewal_type_from_new(self):
        entry = self._motor_renewal()
        resp = self.client.patch(
            f'/api/entries/motor-renewal/{entry.id}/update-status/',
            {'status': 'rejected', 'revisions': 1, 'quotes_compared': 1},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        entry.refresh_from_db()
        self.assertEqual(entry.status, 'rejected')

    # ── TED-595 comment: the two counts are required on reject ────────────
    def test_reject_requires_both_counts(self):
        entry = self._motor_new()
        resp = self.client.patch(
            f'/api/entries/motor-new/{entry.id}/update-status/',
            {'status': 'rejected'}, format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('revisions', resp.data)
        self.assertIn('quotes_compared', resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.status, 'new')            # unchanged

    def test_reject_with_only_one_count_is_rejected(self):
        # Both are required — supplying only one still 400s.
        entry = self._motor_new()
        resp = self.client.patch(
            f'/api/entries/motor-new/{entry.id}/update-status/',
            {'status': 'rejected', 'revisions': 1}, format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        self.assertIn('quotes_compared', resp.data)
        self.assertNotIn('revisions', resp.data)

    # ── frozen after rejection ───────────────────────────────────────────
    def test_rejected_entry_cannot_be_edited(self):
        entry = self._motor_new(status=MotorNewEntry.STATUS_REJECTED)
        # Well within the 30-min window, so only the rejected guard can block it.
        resp = self.client.patch(
            f'/api/entries/motor-new/{entry.id}/', {'client_name': 'Changed'}, format='json',
        )
        self.assertEqual(resp.status_code, 403, resp.content)
        entry.refresh_from_db()
        self.assertEqual(entry.client_name, 'C')

    def test_rejected_entry_cannot_be_deleted(self):
        entry = self._motor_new(status=MotorNewEntry.STATUS_REJECTED)
        resp = self.client.delete(f'/api/entries/motor-new/{entry.id}/')
        self.assertEqual(resp.status_code, 403, resp.content)
        self.assertTrue(MotorNewEntry.objects.filter(id=entry.id).exists())

    def test_rejected_entry_status_cannot_change(self):
        entry = self._motor_new(status=MotorNewEntry.STATUS_REJECTED)
        resp = self.client.patch(
            f'/api/entries/motor-new/{entry.id}/update-status/',
            {'status': 'new'}, format='json',
        )
        self.assertEqual(resp.status_code, 400, resp.content)
        entry.refresh_from_db()
        self.assertEqual(entry.status, 'rejected')

    def test_rejected_entry_can_still_be_voided(self):
        # Void stays available as an admin/creator escape hatch.
        entry = self._motor_new(status=MotorNewEntry.STATUS_REJECTED)
        resp = self.client.post(
            f'/api/entries/motor-new/{entry.id}/void/',
            {'void_reason': 'rejected in error'}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        entry.refresh_from_db()
        self.assertTrue(entry.is_voided)

    # ── non-rejected terminal rows keep their existing behaviour ──────────
    def test_lost_entry_is_not_locked_by_the_rejected_guard(self):
        # Lost is terminal but NOT rejected — deletion of one's own row is
        # still allowed (scope of TED-595 is the rejected value only).
        entry = self._motor_new(status=MotorNewEntry.STATUS_LOST)
        resp = self.client.delete(f'/api/entries/motor-new/{entry.id}/')
        self.assertEqual(resp.status_code, 204, resp.content)

    # ── stats ────────────────────────────────────────────────────────────
    def test_stats_reports_rejected_bucket(self):
        self._motor_new(status=MotorNewEntry.STATUS_NEW)
        self._motor_new(status=MotorNewEntry.STATUS_REJECTED)
        self._motor_new(status=MotorNewEntry.STATUS_REJECTED)
        resp = self.client.get('/api/entries/motor-new/stats/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['rejected'], 2)
        self.assertEqual(resp.data['total'], 3)          # rejected counted in total
        self.assertIn('rejected_premium', resp.data)
