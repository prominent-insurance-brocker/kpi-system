"""Marine New accepts a 0 Converted Premium on Won.

The premium may already have been paid as a minimum deposit, so a Won Marine
enquiry can be closed (and later corrected) at 0. Every other module keeps its
"must be greater than 0" rule on the post-close edit.
"""
from datetime import date
from decimal import Decimal

from django.test import TestCase
from rest_framework.test import APIClient

from auth_app.models import CustomUser
from roles.models import Role, RoleModulePermission

from .models import InsuranceCompany, MarineNewEntry, MotorNewEntry


class MarineZeroConvertedPremiumTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.role = Role.objects.create(name='Enquiry', data_visibility='own')
        RoleModulePermission.objects.create(role=cls.role, module='marine_new')
        RoleModulePermission.objects.create(role=cls.role, module='motor_new')
        cls.creator = CustomUser.objects.create(
            email='creator@x.com', full_name='Cara Creator', role=cls.role,
        )
        cls.acme = InsuranceCompany.objects.create(name='Acme Marine')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.creator)

    def _marine(self, status=MarineNewEntry.STATUS_NEW, **kwargs):
        entry = MarineNewEntry.objects.create(
            client_name='C', agent=self.creator, added_by=self.creator,
            status=status, date=date(2026, 7, 1), potential_premium='5000.00',
            **kwargs,
        )
        entry.compared_insurance_companies.set([self.acme])
        return entry

    def test_won_with_zero_converted_premium(self):
        entry = self._marine()
        resp = self.client.patch(
            f'/api/entries/marine-new/{entry.id}/update-status/',
            {'status': 'converted', 'converted_insurer': self.acme.id,
             'converted_premium': '0'},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.status, MarineNewEntry.STATUS_CONVERTED)
        self.assertEqual(entry.converted_premium, Decimal('0'))

    def test_post_close_edit_to_zero(self):
        entry = self._marine(
            status=MarineNewEntry.STATUS_CONVERTED, converted_premium='4000.00',
        )
        resp = self.client.patch(
            f'/api/entries/marine-new/{entry.id}/update-converted-premium/',
            {'converted_premium': '0'}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        entry.refresh_from_db()
        self.assertEqual(entry.converted_premium, Decimal('0'))

    def test_post_close_edit_rejects_negative(self):
        entry = self._marine(
            status=MarineNewEntry.STATUS_CONVERTED, converted_premium='4000.00',
        )
        resp = self.client.patch(
            f'/api/entries/marine-new/{entry.id}/update-converted-premium/',
            {'converted_premium': '-1'}, format='json',
        )
        self.assertEqual(resp.status_code, 400)
        entry.refresh_from_db()
        self.assertEqual(entry.converted_premium, Decimal('4000.00'))

    def test_other_modules_still_reject_zero(self):
        """The 0-allowance is Marine-only; Motor New keeps the > 0 rule."""
        entry = MotorNewEntry.objects.create(
            client_name='C', agent=self.creator, chassis_no='CH1',
            added_by=self.creator, status=MotorNewEntry.STATUS_CONVERTED,
            date=date(2026, 7, 1), potential_premium='5000.00',
            converted_premium='4000.00',
        )
        resp = self.client.patch(
            f'/api/entries/motor-new/{entry.id}/update-converted-premium/',
            {'converted_premium': '0'}, format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('converted_premium', resp.data)
