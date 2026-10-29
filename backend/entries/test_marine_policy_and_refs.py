"""Marine New Policy/Certificate Number + Insurer Reference IDs.

- Policy/Certificate Number is required (non-blank) when the enquiry is marked
  Won, saved stripped, ignored for every other target status, and can be
  corrected on the post-close Update Converted Premium edit (never cleared).
- Insurer Reference IDs are optional on Shared With Client, keyed by the ids of
  the entry's compared insurers; the cleaned dict replaces the stored one, an
  absent key keeps it, and other target statuses ignore it.
- Both are read-only on the plain entry PATCH. Other modules are untouched.
"""
from datetime import date
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from django.db import connection
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from auth_app.models import CustomUser
from roles.models import Role, RoleModulePermission

from .models import Client, ClientCategory, InsuranceCompany, MarineNewEntry, MotorNewEntry


class _Base(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.role = Role.objects.create(name='Enquiry', data_visibility='own')
        RoleModulePermission.objects.create(role=cls.role, module='marine_new')
        RoleModulePermission.objects.create(role=cls.role, module='motor_new')
        cls.creator = CustomUser.objects.create(
            email='creator@x.com', full_name='Cara Creator', role=cls.role,
        )
        cls.acme = InsuranceCompany.objects.create(name='Acme Marine')
        cls.blue = InsuranceCompany.objects.create(name='BlueShield Marine')
        cls.other = InsuranceCompany.objects.create(name='Zeta Not Compared')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.creator)

    def _marine(self, status=MarineNewEntry.STATUS_NEW, compared=None, **kwargs):
        entry = MarineNewEntry.objects.create(
            client_name='C', agent=self.creator, added_by=self.creator,
            status=status, date=date(2026, 7, 1), potential_premium='5000.00',
            **kwargs,
        )
        entry.compared_insurance_companies.set(
            [self.acme, self.blue] if compared is None else compared
        )
        return entry

    def _status(self, entry, payload):
        return self.client.patch(
            f'/api/entries/marine-new/{entry.id}/update-status/',
            payload, format='json',
        )

    def _won(self, **extra):
        return {
            'status': 'converted', 'converted_insurer': self.acme.id,
            'converted_premium': '4000.00', **extra,
        }


class PolicyNumberOnWonTests(_Base):
    def test_won_without_policy_number_rejected(self):
        entry = self._marine()
        resp = self._status(entry, self._won())
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(
            resp.data['policy_number'],
            ['Policy/Certificate Number is required when marking the enquiry as Won.'],
        )
        entry.refresh_from_db()
        self.assertEqual(entry.status, MarineNewEntry.STATUS_NEW)

    def test_won_with_blank_policy_number_rejected(self):
        entry = self._marine()
        resp = self._status(entry, self._won(policy_number='   '))
        self.assertEqual(resp.status_code, 400)
        self.assertIn('policy_number', resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.status, MarineNewEntry.STATUS_NEW)
        self.assertEqual(entry.policy_number, '')

    def test_won_saves_stripped_policy_number(self):
        entry = self._marine()
        resp = self._status(entry, self._won(policy_number='  POL-123/A  '))
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['policy_number'], 'POL-123/A')
        entry.refresh_from_db()
        self.assertEqual(entry.status, MarineNewEntry.STATUS_CONVERTED)
        self.assertEqual(entry.policy_number, 'POL-123/A')

    def test_won_policy_number_too_long_rejected(self):
        entry = self._marine()
        resp = self._status(entry, self._won(policy_number='X' * 101))
        self.assertEqual(resp.status_code, 400)
        self.assertIn('policy_number', resp.data)

    def test_won_from_shared_with_client_requires_policy_number(self):
        entry = self._marine(status=MarineNewEntry.STATUS_SHARED_WITH_CLIENT)
        self.assertEqual(self._status(entry, self._won()).status_code, 400)
        resp = self._status(entry, self._won(policy_number='CERT-9'))
        self.assertEqual(resp.status_code, 200, resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.policy_number, 'CERT-9')

    def test_policy_number_ignored_for_lost_and_rejected(self):
        for target in ('lost', 'rejected'):
            entry = self._marine()
            resp = self._status(entry, {'status': target, 'policy_number': 'POL-1'})
            self.assertEqual(resp.status_code, 200, resp.data)
            entry.refresh_from_db()
            self.assertEqual(entry.status, target)
            self.assertEqual(entry.policy_number, '')

    def test_lost_and_rejected_need_no_policy_number(self):
        for target in ('lost', 'rejected'):
            entry = self._marine()
            resp = self._status(entry, {'status': target})
            self.assertEqual(resp.status_code, 200, resp.data)

    def test_malformed_policy_number_ignored_on_other_statuses(self):
        # Ignored fields are dropped before field validation, so an oversized
        # or non-string value cannot 400 a non-Won move.
        for bad in ('X' * 500, ['a', 'b'], {'x': 1}):
            entry = self._marine()
            resp = self._status(entry, {'status': 'lost', 'policy_number': bad})
            self.assertEqual(resp.status_code, 200, (bad, resp.data))
            entry.refresh_from_db()
            self.assertEqual(entry.policy_number, '')

    def test_policy_number_ignored_on_shared_with_client(self):
        entry = self._marine()
        resp = self._status(
            entry, {'status': 'shared_with_client', 'policy_number': 'POL-1'},
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.policy_number, '')


class InsurerReferencesTests(_Base):
    def test_shared_saves_strips_and_drops_blanks(self):
        entry = self._marine()
        resp = self._status(entry, {
            'status': 'shared_with_client',
            'insurer_references': {
                str(self.acme.id): '  Q-ACME-1 ',
                str(self.blue.id): '   ',
            },
        })
        self.assertEqual(resp.status_code, 200, resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.status, MarineNewEntry.STATUS_SHARED_WITH_CLIENT)
        self.assertEqual(entry.insurer_references, {str(self.acme.id): 'Q-ACME-1'})

    def test_unknown_insurer_key_rejected(self):
        entry = self._marine()
        for bad_key in (str(self.other.id), '999999', 'abc'):
            resp = self._status(entry, {
                'status': 'shared_with_client',
                'insurer_references': {bad_key: 'REF'},
            })
            self.assertEqual(resp.status_code, 400, bad_key)
            self.assertIn('insurer_references', resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.status, MarineNewEntry.STATUS_NEW)
        self.assertEqual(entry.insurer_references, {})

    def test_unknown_insurer_key_list_is_capped(self):
        entry = self._marine()
        refs = {str(900000 + i): 'REF' for i in range(8)}
        resp = self._status(entry, {
            'status': 'shared_with_client', 'insurer_references': refs,
        })
        self.assertEqual(resp.status_code, 400)
        message = str(resp.data['insurer_references'][0])
        self.assertIn('900004', message)
        self.assertNotIn('900005', message)
        self.assertTrue(message.endswith(', ....'), message)

    def test_reference_too_long_rejected(self):
        entry = self._marine()
        resp = self._status(entry, {
            'status': 'shared_with_client',
            'insurer_references': {str(self.acme.id): 'X' * 101},
        })
        self.assertEqual(resp.status_code, 400)
        self.assertIn('insurer_references', resp.data)

    def test_reshare_replaces_stored_references(self):
        entry = self._marine()
        self._status(entry, {
            'status': 'shared_with_client',
            'insurer_references': {str(self.acme.id): 'A1', str(self.blue.id): 'B1'},
        })
        self.assertEqual(self._status(entry, {'status': 'new'}).status_code, 200)
        resp = self._status(entry, {
            'status': 'shared_with_client',
            'insurer_references': {str(self.blue.id): 'B2'},
        })
        self.assertEqual(resp.status_code, 200, resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.insurer_references, {str(self.blue.id): 'B2'})

    def test_reshare_with_all_blank_clears_references(self):
        entry = self._marine(insurer_references={str(self.acme.id): 'A1'})
        resp = self._status(entry, {
            'status': 'shared_with_client',
            'insurer_references': {str(self.acme.id): ''},
        })
        self.assertEqual(resp.status_code, 200, resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.insurer_references, {})

    def test_absent_key_keeps_stored_references(self):
        entry = self._marine(insurer_references={str(self.acme.id): 'A1'})
        resp = self._status(entry, {'status': 'shared_with_client'})
        self.assertEqual(resp.status_code, 200, resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.insurer_references, {str(self.acme.id): 'A1'})

    def test_references_ignored_on_other_statuses(self):
        stored = {str(self.acme.id): 'A1'}
        cases = [
            (MarineNewEntry.STATUS_SHARED_WITH_CLIENT, {'status': 'new'}),
            (MarineNewEntry.STATUS_NEW, {'status': 'lost'}),
            (MarineNewEntry.STATUS_NEW, {'status': 'rejected'}),
            (MarineNewEntry.STATUS_NEW, self._won(policy_number='POL-1')),
        ]
        for start, payload in cases:
            entry = self._marine(status=start, insurer_references=stored)
            # Even an unknown key is not validated when the refs are ignored.
            payload = {
                **payload,
                'insurer_references': {str(self.blue.id): 'NEW', str(self.other.id): 'X'},
            }
            resp = self._status(entry, payload)
            self.assertEqual(resp.status_code, 200, (payload['status'], resp.data))
            entry.refresh_from_db()
            self.assertEqual(entry.insurer_references, stored, payload['status'])

    def test_malformed_references_ignored_on_other_statuses(self):
        stored = {str(self.acme.id): 'A1'}
        for bad in ('not-a-dict', {str(self.acme.id): 'X' * 500}, {str(self.acme.id): ['x']}):
            entry = self._marine(insurer_references=stored)
            resp = self._status(entry, {'status': 'lost', 'insurer_references': bad})
            self.assertEqual(resp.status_code, 200, (bad, resp.data))
            entry.refresh_from_db()
            self.assertEqual(entry.insurer_references, stored)

    def test_shared_with_no_compared_insurers(self):
        entry = self._marine(compared=[])
        resp = self._status(entry, {
            'status': 'shared_with_client', 'insurer_references': {},
        })
        self.assertEqual(resp.status_code, 200, resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.insurer_references, {})


class SerializerTests(_Base):
    def test_display_list_resolved_and_ordered_by_name(self):
        entry = self._marine(insurer_references={
            str(self.blue.id): 'B-REF',
            str(self.acme.id): 'A-REF',
            # No longer a compared insurer → skipped in the display list.
            str(self.other.id): 'GONE',
        })
        resp = self.client.get(f'/api/entries/marine-new/{entry.id}/')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['policy_number'], '')
        self.assertEqual(resp.data['insurer_references'][str(self.acme.id)], 'A-REF')
        self.assertEqual(resp.data['insurer_references_display'], [
            {'insurer_id': self.acme.id, 'insurer_name': 'Acme Marine', 'reference': 'A-REF'},
            {'insurer_id': self.blue.id, 'insurer_name': 'BlueShield Marine', 'reference': 'B-REF'},
        ])

    def test_display_list_empty_by_default(self):
        entry = self._marine()
        resp = self.client.get('/api/entries/marine-new/')
        self.assertEqual(resp.status_code, 200, resp.data)
        rows = resp.data['results'] if isinstance(resp.data, dict) else resp.data
        row = next(r for r in rows if r['id'] == entry.id)
        self.assertEqual(row['insurer_references'], {})
        self.assertEqual(row['insurer_references_display'], [])

    def test_references_add_no_per_row_list_queries(self):
        # compared_insurance_companies is prefetched, so storing references on
        # rows adds no per-row query for insurer_references_display.
        entries = [self._marine() for _ in range(3)]
        without_refs = self._list_queries()
        for entry in entries:
            entry.insurer_references = {str(self.blue.id): 'B1'}
            entry.save(update_fields=['insurer_references'])
        self.assertEqual(self._list_queries(), without_refs)

    def _list_queries(self):
        with CaptureQueriesContext(connection) as ctx:
            resp = self.client.get('/api/entries/marine-new/')
        self.assertEqual(resp.status_code, 200, resp.data)
        return len(ctx.captured_queries)

    def test_fields_read_only_on_plain_patch(self):
        linked = Client.objects.create(name='C')
        ClientCategory.objects.create(client=linked, category='marine')
        entry = self._marine(
            policy_number='POL-1', insurer_references={str(self.acme.id): 'A1'},
            client=linked,
        )
        resp = self.client.patch(
            f'/api/entries/marine-new/{entry.id}/',
            {
                'client_name': 'Renamed',
                'policy_number': 'HACKED',
                'insurer_references': {str(self.blue.id): 'HACKED'},
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.client_name, 'Renamed')
        # A plain client_name edit (no `client`) keeps the current link.
        self.assertEqual(entry.client_id, linked.id)
        self.assertEqual(entry.policy_number, 'POL-1')
        self.assertEqual(entry.insurer_references, {str(self.acme.id): 'A1'})


class PostCloseEditTests(_Base):
    def _won_entry(self, policy_number=''):
        return self._marine(
            status=MarineNewEntry.STATUS_CONVERTED, converted_premium='4000.00',
            policy_number=policy_number,
        )

    def _edit(self, entry, payload):
        return self.client.patch(
            f'/api/entries/marine-new/{entry.id}/update-converted-premium/',
            payload, format='json',
        )

    def test_updates_policy_number_stripped(self):
        entry = self._won_entry(policy_number='OLD-1')
        resp = self._edit(entry, {'converted_premium': '4500', 'policy_number': ' NEW-2 '})
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['policy_number'], 'NEW-2')
        entry.refresh_from_db()
        self.assertEqual(entry.policy_number, 'NEW-2')
        self.assertEqual(entry.converted_premium, Decimal('4500'))

    def test_legacy_row_can_gain_policy_number(self):
        entry = self._won_entry()
        resp = self._edit(entry, {'converted_premium': '4000', 'policy_number': 'POL-9'})
        self.assertEqual(resp.status_code, 200, resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.policy_number, 'POL-9')

    def test_blank_policy_number_rejected_when_key_present(self):
        entry = self._won_entry(policy_number='OLD-1')
        for blank in ('', '   '):
            resp = self._edit(entry, {'converted_premium': '4500', 'policy_number': blank})
            self.assertEqual(resp.status_code, 400)
            self.assertIn('policy_number', resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.policy_number, 'OLD-1')
        self.assertEqual(entry.converted_premium, Decimal('4000.00'))

    def test_premium_only_edit_keeps_policy_number(self):
        entry = self._won_entry(policy_number='OLD-1')
        resp = self._edit(entry, {'converted_premium': '0'})
        self.assertEqual(resp.status_code, 200, resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.converted_premium, Decimal('0'))
        self.assertEqual(entry.policy_number, 'OLD-1')

    def test_premium_only_edit_on_legacy_row(self):
        entry = self._won_entry()
        resp = self._edit(entry, {'converted_premium': '4200'})
        self.assertEqual(resp.status_code, 200, resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.policy_number, '')

    def test_converted_premium_still_required(self):
        entry = self._won_entry(policy_number='OLD-1')
        resp = self._edit(entry, {'policy_number': 'NEW-2'})
        self.assertEqual(resp.status_code, 400)
        self.assertIn('converted_premium', resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.policy_number, 'OLD-1')

    def test_motor_new_post_close_edit_unchanged(self):
        """Motor New uses the shared helper without extra fields: the policy
        key is simply not a field there, and its > 0 rule still applies."""
        entry = MotorNewEntry.objects.create(
            client_name='C', agent=self.creator, chassis_no='CH1',
            added_by=self.creator, status=MotorNewEntry.STATUS_CONVERTED,
            date=date(2026, 7, 1), potential_premium='5000.00',
            converted_premium='4000.00',
        )
        resp = self.client.patch(
            f'/api/entries/motor-new/{entry.id}/update-converted-premium/',
            {'converted_premium': '4500', 'policy_number': 'POL-1'}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertNotIn('policy_number', resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.converted_premium, Decimal('4500'))

        resp = self.client.patch(
            f'/api/entries/motor-new/{entry.id}/update-converted-premium/',
            {'converted_premium': '0'}, format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('converted_premium', resp.data)


class MigrationStateTests(TestCase):
    def test_no_missing_migrations(self):
        out = StringIO()
        try:
            call_command(
                'makemigrations', 'entries', check=True, dry_run=True,
                stdout=out, stderr=out,
            )
        except SystemExit:  # pragma: no cover - only on drift
            self.fail(f'Missing migrations for entries:\n{out.getvalue()}')
