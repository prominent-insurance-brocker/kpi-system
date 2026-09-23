"""Tests for Marine New's Compared Insurers / Converted Insurer split.

Marine New (TED-596) was built while TED-592 was being corrected and so missed
migration 0049: it had `compared_insurance_companies` but no `converted_insurer`,
and its Won modal wrote the purchased insurer into the legacy `insurance_company`
FK. The Enquiries table therefore showed a single "Insurance Company" column that
meant *compared insurers* before the close and *the purchased insurer* after it.

These tests pin the corrected behaviour, matching the other six enquiry modules:
the two concepts live in two fields, a Won writes only `converted_insurer`, and
the legacy `insurance_company` column is never overwritten.
"""
from datetime import date

from django.test import TestCase
from rest_framework.test import APIClient

from auth_app.models import CustomUser
from roles.models import Role, RoleModulePermission

from .models import InsuranceCompany, MarineNewEntry


class MarineConvertedInsurerTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.role = Role.objects.create(name='Enquiry', data_visibility='own')
        RoleModulePermission.objects.create(role=cls.role, module='marine_new')
        cls.creator = CustomUser.objects.create(
            email='creator@x.com', full_name='Cara Creator', role=cls.role,
        )
        cls.acme = InsuranceCompany.objects.create(name='Acme Marine')
        cls.blue = InsuranceCompany.objects.create(name='BlueShield Marine')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.creator)

    def _entry(self, status=MarineNewEntry.STATUS_NEW, **kwargs):
        entry = MarineNewEntry.objects.create(
            client_name='C', agent=self.creator, added_by=self.creator,
            status=status, date=date(2026, 7, 1), potential_premium='5000.00',
            **kwargs,
        )
        entry.compared_insurance_companies.set([self.acme, self.blue])
        return entry

    def test_model_has_converted_insurer(self):
        """The field the other six modules gained in 0049 now exists here too."""
        self.assertIsNone(self._entry().converted_insurer)

    def test_won_writes_converted_insurer_only(self):
        """A Won stores the purchased insurer in `converted_insurer` and leaves
        the legacy `insurance_company` column untouched — the whole point of the
        TED-592 correction."""
        entry = self._entry()
        resp = self.client.patch(
            f'/api/entries/marine-new/{entry.id}/update-status/',
            {
                'status': 'converted',
                'converted_insurer': self.acme.id,
                'converted_premium': '4000.00',
            },
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

        entry.refresh_from_db()
        self.assertEqual(entry.converted_insurer_id, self.acme.id)
        self.assertIsNone(entry.insurance_company_id)

    def test_compared_insurers_survive_the_close(self):
        """Closing must not disturb the compared list — the two columns are
        independent, so a Won row still shows everyone who was quoted."""
        entry = self._entry()
        self.client.patch(
            f'/api/entries/marine-new/{entry.id}/update-status/',
            {'status': 'converted', 'converted_insurer': self.blue.id,
             'converted_premium': '4000.00'},
            format='json',
        )
        entry.refresh_from_db()
        self.assertEqual(
            sorted(entry.compared_insurance_companies.values_list('name', flat=True)),
            ['Acme Marine', 'BlueShield Marine'],
        )
        self.assertEqual(entry.converted_insurer_id, self.blue.id)

    def test_lost_leaves_converted_insurer_null(self):
        """Lost never sends an insurer, so nothing is recorded as purchased."""
        entry = self._entry()
        resp = self.client.patch(
            f'/api/entries/marine-new/{entry.id}/update-status/',
            {'status': 'lost'}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        entry.refresh_from_db()
        self.assertIsNone(entry.converted_insurer_id)

    def test_serializer_exposes_both_columns(self):
        """Both table columns are fed by the list payload: the compared names
        and the converted insurer's name."""
        entry = self._entry()
        self.client.patch(
            f'/api/entries/marine-new/{entry.id}/update-status/',
            {'status': 'converted', 'converted_insurer': self.acme.id,
             'converted_premium': '4000.00'},
            format='json',
        )
        resp = self.client.get(f'/api/entries/marine-new/{entry.id}/')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['converted_insurer'], self.acme.id)
        self.assertEqual(resp.data['converted_insurer_name'], 'Acme Marine')
        self.assertEqual(
            sorted(resp.data['compared_insurance_companies_names']),
            ['Acme Marine', 'BlueShield Marine'],
        )

    def test_converted_insurer_is_read_only_on_the_entry_endpoint(self):
        """It is set by the Won modal alone; a plain PATCH must not move it."""
        entry = self._entry()
        self.client.patch(
            f'/api/entries/marine-new/{entry.id}/',
            {'converted_insurer': self.acme.id}, format='json',
        )
        entry.refresh_from_db()
        self.assertIsNone(entry.converted_insurer_id)
