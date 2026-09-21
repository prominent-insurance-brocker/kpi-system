"""Tests for the dashboard Avg. TAT and Avg. Accuracy cards.

Both come from `_build_enquiry_stats`, which every enquiry module shares. The
population behind them is the model's own TERMINAL_STATUSES, which is also what
drives the per-row `get_tat_display()` / `accuracy_pct` properties rendered in
the Enquiries table — so the cards and the columns must always agree.

Three things these tests pin down, none of which had any coverage before:
  - Rejected entries count toward both averages (they are closed enquiries).
  - Accuracy does NOT require a closing timestamp; only TAT does.
  - The decay comes from the model, not a hardcoded literal.
"""
from datetime import date, timedelta

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from auth_app.models import CustomUser
from roles.models import Role, RoleModulePermission

from .models import MarineNewEntry, MotorNewEntry, MotorRenewalEntry
from .views import _build_enquiry_stats


class EnquiryQualityStatsTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.role = Role.objects.create(name='Enquiry', data_visibility='all')
        RoleModulePermission.objects.create(role=cls.role, module='motor_new')
        cls.user = CustomUser.objects.create(
            email='agent@x.com', full_name='Ann Agent', role=cls.role,
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)

    def _entry(self, status, revisions=0, tat=timedelta(minutes=10), stamped=True):
        """Create a row whose TAT is exactly `tat` when `stamped`."""
        entry = MotorNewEntry.objects.create(
            client_name='C', agent=self.user, chassis_no='CH1',
            added_by=self.user, status=status, date=date(2026, 7, 1),
            revisions=revisions,
        )
        # added_at is auto_now_add, so set the close time relative to it.
        if stamped:
            MotorNewEntry.objects.filter(pk=entry.pk).update(
                status_changed_at=entry.added_at + tat
            )
        entry.refresh_from_db()
        return entry

    def _stats(self):
        return _build_enquiry_stats(MotorNewEntry.objects.all())

    # ── population: rejected counts as a closed enquiry ───────────────────
    def test_rejected_entries_count_toward_avg_accuracy(self):
        # Two revisions -> 81%, rejected with none -> 100%. Mean must be 90.5,
        # not 81 (which is what excluding the rejected row would give).
        self._entry(MotorNewEntry.STATUS_CONVERTED, revisions=2)
        self._entry(MotorNewEntry.STATUS_REJECTED, revisions=0)
        self.assertAlmostEqual(self._stats()['avg_accuracy'], 90.5, places=2)

    def test_rejected_entries_count_toward_avg_tat(self):
        self._entry(MotorNewEntry.STATUS_CONVERTED, tat=timedelta(minutes=10))
        self._entry(MotorNewEntry.STATUS_REJECTED, tat=timedelta(minutes=20))
        self.assertAlmostEqual(self._stats()['avg_tat_minutes'], 15.0, places=2)

    def test_card_population_matches_the_per_row_table_columns(self):
        # Whatever the table renders an Accuracy for, the card must average.
        self._entry(MotorNewEntry.STATUS_CONVERTED, revisions=1)
        self._entry(MotorNewEntry.STATUS_LOST, revisions=2)
        self._entry(MotorNewEntry.STATUS_REJECTED, revisions=3)
        self._entry(MotorNewEntry.STATUS_NEW)          # open: no column value
        self._entry(MotorNewEntry.STATUS_IN_PROGRESS)  # open: no column value

        shown = [e.accuracy_pct for e in MotorNewEntry.objects.all()
                 if e.accuracy_pct is not None]
        self.assertEqual(len(shown), 3)
        self.assertAlmostEqual(
            self._stats()['avg_accuracy'], sum(shown) / len(shown), places=6
        )

    def test_open_entries_are_excluded_from_both_averages(self):
        self._entry(MotorNewEntry.STATUS_CONVERTED, revisions=0)
        self._entry(MotorNewEntry.STATUS_NEW, revisions=5, stamped=False)
        self._entry(MotorNewEntry.STATUS_IN_PROGRESS, revisions=5, stamped=False)
        # Only the converted row counts: 100%, not the 59%-ish a 3-row mean gives.
        self.assertAlmostEqual(self._stats()['avg_accuracy'], 100.0, places=2)

    def test_voided_entries_are_excluded_from_both_averages(self):
        self._entry(MotorNewEntry.STATUS_CONVERTED, revisions=0)
        voided = self._entry(MotorNewEntry.STATUS_LOST, revisions=4)
        voided.is_voided = True
        voided.voided_at = timezone.now()
        voided.save(update_fields=['is_voided', 'voided_at'])
        stats = self._stats()
        self.assertEqual(stats['voided'], 1)
        self.assertAlmostEqual(stats['avg_accuracy'], 100.0, places=2)

    # ── accuracy must not inherit TAT's timestamp requirement ─────────────
    def test_accuracy_counts_closed_rows_with_no_closing_timestamp(self):
        # A row closed through a path that never stamped status_changed_at (e.g.
        # django-admin) still has a well-defined accuracy and must be averaged.
        self._entry(MotorNewEntry.STATUS_CONVERTED, revisions=0)
        self._entry(MotorNewEntry.STATUS_LOST, revisions=2, stamped=False)
        # 100 and 81 -> 90.5. Dropping the unstamped row would give 100.
        self.assertAlmostEqual(self._stats()['avg_accuracy'], 90.5, places=2)

    def test_tat_skips_rows_with_no_closing_timestamp(self):
        self._entry(MotorNewEntry.STATUS_CONVERTED, tat=timedelta(minutes=10))
        self._entry(MotorNewEntry.STATUS_LOST, stamped=False)
        # Only the stamped row has a measurable TAT.
        self.assertAlmostEqual(self._stats()['avg_tat_minutes'], 10.0, places=2)

    def test_tat_is_none_when_no_closed_row_has_a_timestamp(self):
        self._entry(MotorNewEntry.STATUS_CONVERTED, revisions=1, stamped=False)
        stats = self._stats()
        self.assertIsNone(stats['avg_tat_minutes'])
        # ...but accuracy is still reportable.
        self.assertAlmostEqual(stats['avg_accuracy'], 90.0, places=2)

    # ── the population is per-model, not hardcoded ───────────────────────
    def test_renewal_module_counts_retained_lost_and_rejected(self):
        # Renewal modules close as 'retained', not 'converted'. All three
        # terminal states must count, and 'new' must not.
        for status, revisions in (
            (MotorRenewalEntry.STATUS_RETAINED, 0),
            (MotorRenewalEntry.STATUS_LOST, 2),
            (MotorRenewalEntry.STATUS_REJECTED, 2),
            (MotorRenewalEntry.STATUS_NEW, 9),
        ):
            MotorRenewalEntry.objects.create(
                client_name='C', agent=self.user, chassis_no='CH1',
                added_by=self.user, status=status, date=date(2026, 7, 1),
                revisions=revisions,
            )
        stats = _build_enquiry_stats(
            MotorRenewalEntry.objects.all(), success_status='retained'
        )
        # (100 + 81 + 81) / 3 — the 'new' row is excluded.
        self.assertAlmostEqual(stats['avg_accuracy'], 87.33, places=2)

    def test_marine_shared_with_client_is_not_treated_as_closed(self):
        # 'shared_with_client' is a working stage, not a terminal one. It must
        # stay out of both averages even though it is a post-'new' status.
        for status, revisions in (
            (MarineNewEntry.STATUS_CONVERTED, 0),
            (MarineNewEntry.STATUS_SHARED_WITH_CLIENT, 9),
        ):
            MarineNewEntry.objects.create(
                client_name='C', agent=self.user, added_by=self.user,
                status=status, date=date(2026, 7, 1), revisions=revisions,
            )
        stats = _build_enquiry_stats(MarineNewEntry.objects.all())
        self.assertEqual(stats['shared_with_client'], 1)
        # Only the converted row counts; including the shared row would drop
        # this well below 100.
        self.assertAlmostEqual(stats['avg_accuracy'], 100.0, places=2)

    # ── formula ──────────────────────────────────────────────────────────
    def test_accuracy_uses_the_models_decay_constant(self):
        self._entry(MotorNewEntry.STATUS_CONVERTED, revisions=3)
        expected = float(100 * (MotorNewEntry.ACCURACY_DECAY ** 3))
        self.assertAlmostEqual(self._stats()['avg_accuracy'], expected, places=6)

    def test_empty_queryset_reports_none_for_both(self):
        stats = self._stats()
        self.assertIsNone(stats['avg_tat_minutes'])
        self.assertIsNone(stats['avg_accuracy'])

    # ── end to end through the API ───────────────────────────────────────
    def test_stats_endpoint_exposes_the_corrected_averages(self):
        self._entry(MotorNewEntry.STATUS_CONVERTED, revisions=0,
                    tat=timedelta(minutes=10))
        self._entry(MotorNewEntry.STATUS_REJECTED, revisions=2,
                    tat=timedelta(minutes=20))
        resp = self.client.get('/api/entries/motor-new/stats/')
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp.data['rejected'], 1)
        self.assertAlmostEqual(resp.data['avg_tat_minutes'], 15.0, places=2)
        self.assertAlmostEqual(resp.data['avg_accuracy'], 90.5, places=2)
