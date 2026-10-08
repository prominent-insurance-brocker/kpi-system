"""Stored TAT / Accuracy columns + Marine New TAT ending at Shared With Client.

- Every per-enquiry table stores `tat_minutes` and `accuracy`, mirroring the
  values the Enquiries table shows (`get_tat()` / `accuracy_pct`), so they are
  queryable in the database.
- Marine New only: TAT runs from creation to the FIRST Shared With Client, is
  fixed as soon as the enquiry is shared, and falls back to the close time for
  enquiries closed without ever being shared.
- Migration 0053 backfills existing rows from status history.
"""
import importlib
from datetime import date, datetime, timedelta, timezone as dt_tz
from decimal import Decimal
from unittest import mock

from django.apps import apps
from django.test import TestCase
from rest_framework.test import APIClient

from auth_app.models import CustomUser
from roles.models import Role, RoleModulePermission

from .models import (
    GeneralNewEntry, GeneralRenewalEntry, MarineNewEntry,
    MarineNewStatusTransition, MotorFleetNewEntry, MotorFleetRenewalEntry,
    MotorNewEntry, MotorRenewalEntry,
)
from .views import _build_enquiry_stats

T0 = datetime(2026, 7, 1, 9, 0, tzinfo=dt_tz.utc)


class _Clock:
    """Patch timezone.now so auto_now_add / view stamps are deterministic."""

    def __init__(self, test):
        self.now = T0
        patcher = mock.patch('django.utils.timezone.now', lambda: self.now)
        patcher.start()
        test.addCleanup(patcher.stop)

    def advance(self, **kw):
        self.now = self.now + timedelta(**kw)


class _Base(TestCase):
    modules = ('marine_new', 'motor_new', 'general_new')

    @classmethod
    def setUpTestData(cls):
        cls.role = Role.objects.create(name='Enquiry', data_visibility='all')
        for m in cls.modules:
            RoleModulePermission.objects.create(role=cls.role, module=m)
        cls.user = CustomUser.objects.create(
            email='agent@x.com', full_name='Ann Agent', role=cls.role,
        )

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.clock = _Clock(self)

    def _marine(self, **kw):
        return MarineNewEntry.objects.create(
            client_name='C', agent=self.user, added_by=self.user,
            date=date(2026, 7, 1), potential_premium='5000.00', **kw,
        )

    def _status(self, entry, status, **extra):
        slug = {MarineNewEntry: 'marine-new', MotorNewEntry: 'motor-new'}[type(entry)]
        resp = self.client.patch(
            f'/api/entries/{slug}/{entry.id}/update-status/',
            {'status': status, **extra}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        entry.refresh_from_db()
        return resp


class MarineTatTests(_Base):
    def test_tat_ends_at_shared_and_shows_while_open(self):
        entry = self._marine()
        self.assertIsNone(entry.tat_minutes)
        self.clock.advance(minutes=30)
        resp = self._status(entry, 'shared_with_client')
        self.assertEqual(entry.shared_with_client_at, T0 + timedelta(minutes=30))
        self.assertEqual(entry.tat_minutes, Decimal('30.00'))
        self.assertEqual(resp.data['tat_display'], '30m 0s')
        self.assertEqual(resp.data['tat_minutes'], '30.00')
        # Accuracy stays closed-only.
        self.assertIsNone(entry.accuracy)
        self.assertIsNone(resp.data['accuracy_pct'])

    def test_closing_after_share_does_not_move_tat(self):
        entry = self._marine()
        self.clock.advance(minutes=30)
        self._status(entry, 'shared_with_client')
        self.clock.advance(days=2)
        self._status(entry, 'converted', converted_premium='4000.00')
        self.assertEqual(entry.tat_minutes, Decimal('30.00'))
        self.assertEqual(entry.get_tat_display(), '30m 0s')
        self.assertEqual(entry.accuracy, Decimal('100.00'))

    def test_reshare_keeps_first_share(self):
        entry = self._marine()
        self.clock.advance(minutes=10)
        self._status(entry, 'shared_with_client')
        self.clock.advance(minutes=50)
        self._status(entry, 'new')
        self.clock.advance(minutes=60)
        self._status(entry, 'shared_with_client')
        self.assertEqual(entry.shared_with_client_at, T0 + timedelta(minutes=10))
        self.assertEqual(entry.tat_minutes, Decimal('10.00'))

    def test_back_to_new_keeps_tat(self):
        entry = self._marine()
        self.clock.advance(minutes=10)
        self._status(entry, 'shared_with_client')
        self.clock.advance(minutes=5)
        self._status(entry, 'new')
        self.assertEqual(entry.tat_minutes, Decimal('10.00'))

    def test_never_shared_falls_back_to_close(self):
        entry = self._marine()
        self.clock.advance(hours=2)
        self._status(entry, 'lost')
        self.assertIsNone(entry.shared_with_client_at)
        self.assertEqual(entry.tat_minutes, Decimal('120.00'))
        self.assertEqual(entry.get_tat_display(), '2h 0m')

    def test_open_unshared_has_no_tat(self):
        entry = self._marine()
        self.assertEqual(entry.get_tat_display(), '—')
        self.assertIsNone(entry.tat_minutes)

    def test_stats_average_matches_rows(self):
        a = self._marine()                     # shared at +10, still open
        b = self._marine()                     # shared at +10 then won
        c = self._marine()                     # lost at +40, never shared
        self._marine()                         # open, never shared → excluded
        self.clock.advance(minutes=10)
        self._status(a, 'shared_with_client')
        self._status(b, 'shared_with_client')
        self.clock.advance(minutes=30)
        self._status(b, 'converted', converted_premium='0')
        self._status(c, 'lost')
        stats = _build_enquiry_stats(MarineNewEntry.objects.all())
        # (10 + 10 + 40) / 3
        self.assertAlmostEqual(stats['avg_tat_minutes'], 20.0, places=2)
        # Accuracy: only the two closed rows.
        self.assertAlmostEqual(stats['avg_accuracy'], 100.0, places=2)
        stored = [e.tat_minutes for e in MarineNewEntry.objects.all()
                  if e.tat_minutes is not None]
        self.assertAlmostEqual(float(sum(stored) / len(stored)), 20.0, places=2)

    def test_voided_rows_excluded_from_avg_tat(self):
        a = self._marine()
        v = self._marine()
        self.clock.advance(minutes=10)
        self._status(a, 'shared_with_client')
        self.clock.advance(minutes=50)
        self._status(v, 'shared_with_client')
        MarineNewEntry.objects.filter(pk=v.pk).update(is_voided=True)
        stats = _build_enquiry_stats(MarineNewEntry.objects.all())
        self.assertAlmostEqual(stats['avg_tat_minutes'], 10.0, places=2)

    def test_shared_with_client_at_is_read_only(self):
        entry = self._marine()
        self.client.patch(
            f'/api/entries/marine-new/{entry.id}/',
            {'shared_with_client_at': '2026-01-01T00:00:00Z',
             'tat_minutes': '1.00', 'accuracy': '1.00'},
            format='json',
        )
        entry.refresh_from_db()
        self.assertIsNone(entry.shared_with_client_at)
        self.assertIsNone(entry.tat_minutes)
        self.assertIsNone(entry.accuracy)


class StoredQualityOtherModulesTests(_Base):
    def test_motor_new_tat_unchanged_and_stored(self):
        entry = MotorNewEntry.objects.create(
            client_name='C', agent=self.user, chassis_no='CH1',
            added_by=self.user, date=date(2026, 7, 1), potential_premium='1',
        )
        self.assertIsNone(entry.tat_minutes)
        self.clock.advance(minutes=45)
        self._status(entry, 'in_progress')
        self.assertIsNone(entry.tat_minutes)  # still open → no TAT
        self.clock.advance(minutes=15)
        self._status(entry, 'converted', revisions=2, converted_premium='10')
        self.assertEqual(entry.tat_minutes, Decimal('60.00'))
        self.assertEqual(entry.accuracy, Decimal('81.00'))
        self.assertEqual(entry.get_tat_display(), '1h 0m')

    def test_revisions_edit_on_open_row_keeps_accuracy_null(self):
        entry = MotorNewEntry.objects.create(
            client_name='C', agent=self.user, chassis_no='CH1',
            added_by=self.user, date=date(2026, 7, 1),
        )
        resp = self.client.patch(
            f'/api/entries/motor-new/{entry.id}/update-revisions/',
            {'revisions': 3}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        entry.refresh_from_db()
        self.assertIsNone(entry.accuracy)

    def test_every_enquiry_model_has_the_columns(self):
        for model in (GeneralNewEntry, GeneralRenewalEntry, MotorNewEntry,
                      MotorRenewalEntry, MotorFleetNewEntry,
                      MotorFleetRenewalEntry, MarineNewEntry):
            names = {f.name for f in model._meta.get_fields()}
            self.assertTrue({'tat_minutes', 'accuracy'} <= names, model)

    def test_save_with_update_fields_still_syncs(self):
        entry = MotorNewEntry.objects.create(
            client_name='C', agent=self.user, chassis_no='CH1',
            added_by=self.user, date=date(2026, 7, 1),
        )
        entry.status = MotorNewEntry.STATUS_LOST
        entry.status_changed_at = T0 + timedelta(minutes=5)
        entry.revisions = 1
        entry.save(update_fields=['status', 'status_changed_at', 'revisions'])
        entry.refresh_from_db()
        self.assertEqual(entry.tat_minutes, Decimal('5.00'))
        self.assertEqual(entry.accuracy, Decimal('90.00'))


class StoredQualityRobustnessTests(_Base):
    def _motor(self, **kw):
        return MotorNewEntry.objects.create(
            client_name='C', agent=self.user, chassis_no='CH1',
            added_by=self.user, date=date(2026, 7, 1), **kw,
        )

    def test_stale_instance_save_stores_row_truth(self):
        """A revisions write from a stale (pre-close) instance must leave the
        stored accuracy matching the row, not the stale instance."""
        stale = self._motor()
        live = MotorNewEntry.objects.get(pk=stale.pk)
        live.status = MotorNewEntry.STATUS_CONVERTED
        live.status_changed_at = T0 + timedelta(minutes=5)
        live.save()
        stale.revisions = 3
        stale.save(update_fields=['revisions', 'updated_at'])
        row = MotorNewEntry.objects.get(pk=stale.pk)
        self.assertEqual(row.accuracy, Decimal(row.accuracy_pct).quantize(Decimal('0.01')))
        self.assertEqual(row.accuracy, Decimal('72.90'))
        self.assertEqual(row.tat_minutes, Decimal('5.00'))

    def test_audit_ignores_derived_columns(self):
        from audit.models import AuditLog
        entry = self._motor()
        self.clock.advance(minutes=10)
        self._status(entry, 'converted', revisions=1, converted_premium='10')
        logs = list(AuditLog.objects.filter(category='motor_new'))
        self.assertTrue(logs)
        for log in logs:
            self.assertNotIn('tat_minutes', log.changes)
            self.assertNotIn('accuracy', log.changes)


class BackfillMigrationTests(_Base):
    def _backfill(self):
        mod = importlib.import_module(
            'entries.migrations.0053_backfill_stored_tat_accuracy'
        )
        mod.backfill(apps, None)

    def _wipe(self, model):
        model.objects.update(tat_minutes=None, accuracy=None)

    def test_marine_first_share_including_legacy_in_progress(self):
        legacy = self._marine(status=MarineNewEntry.STATUS_CONVERTED)
        modern = self._marine(status=MarineNewEntry.STATUS_SHARED_WITH_CLIENT)
        never = self._marine(status=MarineNewEntry.STATUS_LOST)
        MarineNewEntry.objects.filter(pk=never.pk).update(
            status_changed_at=T0 + timedelta(minutes=90),
        )
        MarineNewEntry.objects.filter(pk=legacy.pk).update(
            status_changed_at=T0 + timedelta(days=1),
        )
        for entry, to_status, minutes in (
            (legacy, 'in_progress', 20),
            (modern, 'shared_with_client', 15), (modern, 'new', 30),
            (modern, 'shared_with_client', 45),
        ):
            t = MarineNewStatusTransition.objects.create(
                entry=entry, from_status='new', to_status=to_status,
                changed_by=self.user,
            )
            MarineNewStatusTransition.objects.filter(pk=t.pk).update(
                changed_at=T0 + timedelta(minutes=minutes),
            )
        MarineNewEntry.objects.update(
            shared_with_client_at=None, tat_minutes=None, accuracy=None,
        )

        self._backfill()

        legacy.refresh_from_db(); modern.refresh_from_db(); never.refresh_from_db()
        self.assertEqual(legacy.shared_with_client_at, T0 + timedelta(minutes=20))
        self.assertEqual(legacy.tat_minutes, Decimal('20.00'))
        self.assertEqual(legacy.accuracy, Decimal('100.00'))
        self.assertEqual(modern.shared_with_client_at, T0 + timedelta(minutes=15))
        self.assertEqual(modern.tat_minutes, Decimal('15.00'))
        self.assertIsNone(modern.accuracy)
        self.assertIsNone(never.shared_with_client_at)
        self.assertEqual(never.tat_minutes, Decimal('90.00'))
        # Backfilled values agree with the live model logic.
        for e in (legacy, modern, never):
            self.assertEqual((e.tat_minutes, e.accuracy), e.compute_stored_quality())

    def test_other_modules_backfilled_and_updated_at_untouched(self):
        closed = MotorRenewalEntry.objects.create(
            client_name='C', agent=self.user, chassis_no='CH1',
            added_by=self.user, date=date(2026, 7, 1),
            status=MotorRenewalEntry.STATUS_RETAINED, revisions=1,
        )
        open_ = MotorRenewalEntry.objects.create(
            client_name='C', agent=self.user, chassis_no='CH2',
            added_by=self.user, date=date(2026, 7, 1), revisions=4,
        )
        MotorRenewalEntry.objects.filter(pk=closed.pk).update(
            status_changed_at=T0 + timedelta(hours=3),
        )
        self._wipe(MotorRenewalEntry)
        before = dict(MotorRenewalEntry.objects.values_list('pk', 'updated_at'))

        self._backfill()

        closed.refresh_from_db(); open_.refresh_from_db()
        self.assertEqual(closed.tat_minutes, Decimal('180.00'))
        self.assertEqual(closed.accuracy, Decimal('90.00'))
        self.assertIsNone(open_.tat_minutes)
        self.assertIsNone(open_.accuracy)
        after = dict(MotorRenewalEntry.objects.values_list('pk', 'updated_at'))
        self.assertEqual(before, after)

    def test_real_share_beats_earlier_in_progress(self):
        """0048–0050 had in_progress AND shared_with_client as separate stages;
        a real share transition wins over an earlier in_progress one."""
        entry = self._marine(status=MarineNewEntry.STATUS_CONVERTED)
        for to_status, minutes in (('in_progress', 60), ('shared_with_client', 300)):
            t = MarineNewStatusTransition.objects.create(
                entry=entry, from_status='new', to_status=to_status,
                changed_by=self.user,
            )
            MarineNewStatusTransition.objects.filter(pk=t.pk).update(
                changed_at=T0 + timedelta(minutes=minutes),
            )
        MarineNewEntry.objects.update(shared_with_client_at=None)
        self._backfill()
        entry.refresh_from_db()
        self.assertEqual(entry.shared_with_client_at, T0 + timedelta(minutes=300))
        self.assertEqual(entry.tat_minutes, Decimal('300.00'))

    def test_backfill_is_idempotent(self):
        self._marine(status=MarineNewEntry.STATUS_LOST)
        self._backfill()
        first = list(MarineNewEntry.objects.values_list('tat_minutes', 'accuracy'))
        self._backfill()
        self.assertEqual(
            first, list(MarineNewEntry.objects.values_list('tat_minutes', 'accuracy')),
        )


class StoredQualityApiExposureTests(_Base):
    """Every enquiry module's API returns the stored tat_minutes / accuracy
    (read-only), matching the row's tat_display / accuracy_pct."""
    modules = (
        'general_new', 'general_renewal', 'motor_new', 'motor_renewal',
        'motor_fleet_new', 'motor_fleet_renewal', 'marine_new',
    )
    CASES = (
        ('general-new', GeneralNewEntry, 'converted', {}),
        ('general-renewal', GeneralRenewalEntry, 'retained', {}),
        ('motor-new', MotorNewEntry, 'converted', {'chassis_no': 'CH1'}),
        ('motor-renewal', MotorRenewalEntry, 'retained', {'chassis_no': 'CH1'}),
        ('motor-fleet-new', MotorFleetNewEntry, 'converted', {'chassis_no': 'CH1'}),
        ('motor-fleet-renewal', MotorFleetRenewalEntry, 'retained', {'chassis_no': 'CH1'}),
        ('marine-new', MarineNewEntry, 'converted', {}),
    )

    def test_list_and_detail_expose_stored_values(self):
        for slug, model, closed, extra in self.CASES:
            with self.subTest(slug):
                entry = model.objects.create(
                    client_name='C', agent=self.user, added_by=self.user,
                    date=date(2026, 7, 1), status=closed, revisions=1,
                    status_changed_at=T0 + timedelta(minutes=90), **extra,
                )
                detail = self.client.get(f'/api/entries/{slug}/{entry.id}/')
                self.assertEqual(detail.status_code, 200, detail.data)
                self.assertEqual(detail.data['tat_minutes'], '90.00')
                self.assertEqual(detail.data['accuracy'], '90.00')
                self.assertEqual(detail.data['tat_display'], '1h 30m')
                listing = self.client.get(f'/api/entries/{slug}/')
                rows = listing.data.get('results', listing.data)
                row = next(r for r in rows if r['id'] == entry.id)
                self.assertEqual((row['tat_minutes'], row['accuracy']), ('90.00', '90.00'))

    def test_open_rows_return_null_and_fields_are_read_only(self):
        for slug, model, _closed, extra in self.CASES:
            with self.subTest(slug):
                entry = model.objects.create(
                    client_name='C', agent=self.user, added_by=self.user,
                    date=date(2026, 7, 1), **extra,
                )
                self.client.patch(
                    f'/api/entries/{slug}/{entry.id}/',
                    {'tat_minutes': '5.00', 'accuracy': '50.00'}, format='json',
                )
                resp = self.client.get(f'/api/entries/{slug}/{entry.id}/')
                self.assertIsNone(resp.data['tat_minutes'])
                self.assertIsNone(resp.data['accuracy'])
