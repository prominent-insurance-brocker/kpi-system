"""List search: `?q=` on every entry module (EntrySearchMixin).

- Id terms are exact: '12', 'PIB-12', 'pib12' and 'pib 12' find PIB-12 only,
  never PIB-120 (and are still tried as text).
- Text-box modules (General, Motor x4, Motor Claim) search `client_name`;
  Deals (Sales KPI) and Medical Claim search `customer_name`.
- Marine New searches the linked client's name / @username, the policy number
  and the insurer reference values (not the insurer-id keys), never the legacy
  typed `client_name`; the export follows `q`.
- `q` ANDs with the other filters, the old client_name / customer_name params
  keep working, and RBAC "own" visibility still applies.
"""
import csv
from datetime import date
from io import StringIO

from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from audit.registry import PER_MODEL_IGNORED_FIELDS
from auth_app.models import CustomUser
from roles.models import Role, RoleModulePermission

from .models import (
    ClassOfInsurance,
    Client,
    GeneralNewEntry,
    GeneralRenewalEntry,
    InsuranceCompany,
    MarineNewEntry,
    MedicalClaimEntry,
    MotorClaimEntry,
    MotorFleetNewEntry,
    MotorFleetRenewalEntry,
    MotorNewEntry,
    MotorRenewalEntry,
    SalesKPIEntry,
    TypeOfAccident,
)

# (url slug, model, RBAC module key, searched name column)
TEXT_MODULES = [
    ('general-new', GeneralNewEntry, 'general_new', 'client_name'),
    ('general-renewal', GeneralRenewalEntry, 'general_renewal', 'client_name'),
    ('motor-new', MotorNewEntry, 'motor_new', 'client_name'),
    ('motor-renewal', MotorRenewalEntry, 'motor_renewal', 'client_name'),
    ('motor-fleet-new', MotorFleetNewEntry, 'motor_fleet_new', 'client_name'),
    ('motor-fleet-renewal', MotorFleetRenewalEntry, 'motor_fleet_renewal', 'client_name'),
    ('motor-claim', MotorClaimEntry, 'motor_claim', 'client_name'),
    ('sales-kpi', SalesKPIEntry, 'sales_kpi', 'customer_name'),
    ('medical-claim', MedicalClaimEntry, 'medical_claim', 'customer_name'),
]
ALL_MODULE_KEYS = [key for _, _, key, _ in TEXT_MODULES] + ['marine_new']


def parse_csv(resp):
    return list(csv.DictReader(StringIO(resp.content.decode('utf-8').lstrip('﻿'))))


class _Base(TestCase):
    @classmethod
    def setUpTestData(cls):
        all_role = Role.objects.create(name='Search All', data_visibility='all')
        own_role = Role.objects.create(name='Search Own', data_visibility='own')
        for key in ALL_MODULE_KEYS:
            RoleModulePermission.objects.create(role=all_role, module=key)
            RoleModulePermission.objects.create(role=own_role, module=key)
        cls.user = CustomUser.objects.create(
            email='all@x.com', full_name='Ann All', role=all_role,
        )
        cls.own_user = CustomUser.objects.create(
            email='own@x.com', full_name='Owen Own', role=own_role,
        )
        cls.accident = TypeOfAccident.objects.create(name='Search Test Accident')
        cls.acme = InsuranceCompany.objects.create(name='Search Test Acme')
        cls.blue = InsuranceCompany.objects.create(name='Search Test Blue')
        cls.cls_ins = ClassOfInsurance.objects.create(name='Search Test Class')

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.user)

    def tearDown(self):
        # Throttle counters live in the process-wide cache; keep them per test.
        cache.clear()
        super().tearDown()

    def _make(self, model, name, pib_id, added_by=None, **extra):
        """Create a row of `model` with the given name and explicit pib_id."""
        added_by = added_by or self.user
        kwargs = {'date': date(2026, 7, 1), 'added_by': added_by, 'pib_id': pib_id}
        if model is MotorClaimEntry:
            kwargs.update(
                client_name=name, vehicle_number='V1', claim_number='C1',
                source=self.user, type_of_accident=self.accident,
                insurance_company=self.acme, status='claims_opened',
            )
        elif model is SalesKPIEntry:
            kwargs.update(
                customer_name=name, entry_type='new',
                class_of_insurance=self.cls_ins, assignee=added_by,
            )
        elif model is MedicalClaimEntry:
            kwargs.update(customer_name=name, status='claims_opened')
        elif model is MarineNewEntry:
            kwargs.update(client_name=name, agent=self.user)
        else:
            kwargs.update(client_name=name, agent=self.user)
            if model in (MotorNewEntry, MotorRenewalEntry,
                         MotorFleetNewEntry, MotorFleetRenewalEntry):
                kwargs['chassis_no'] = 'CH1'
        kwargs.update(extra)
        return model.objects.create(**kwargs)

    def _ids(self, slug, **params):
        resp = self.api.get(f'/api/entries/{slug}/', params)
        self.assertEqual(resp.status_code, 200, resp.content)
        return {row['id'] for row in resp.data['results']}


class TextModuleSearchTests(_Base):
    """Every module whose client / customer is a free-text box."""

    def _seed(self, model):
        return (
            self._make(model, 'Alpha Traders', 'PIB-12'),
            self._make(model, 'Beta Foods', 'PIB-120'),
            self._make(model, 'Gamma 12 Star', 'PIB-7'),
        )

    def test_id_terms_match_exactly(self):
        for slug, model, _, _ in TEXT_MODULES:
            with self.subTest(slug):
                twelve, hundred_twenty, star = self._seed(model)
                for term in ('12', 'PIB-12', 'pib-12', 'pib12', 'pib 12', 'PIB-012'):
                    found = self._ids(slug, q=term)
                    self.assertIn(twelve.id, found, term)
                    self.assertNotIn(hundred_twenty.id, found, term)
                # A bare number is also tried as text ("Gamma 12 Star").
                self.assertEqual(self._ids(slug, q='12'), {twelve.id, star.id})
                self.assertEqual(self._ids(slug, q='PIB-120'), {hundred_twenty.id})

    def test_partial_name_matches_case_insensitively(self):
        for slug, model, _, _ in TEXT_MODULES:
            with self.subTest(slug):
                alpha, beta, _ = self._seed(model)
                self.assertEqual(self._ids(slug, q='alph'), {alpha.id})
                self.assertEqual(self._ids(slug, q='FOODS'), {beta.id})
                self.assertEqual(self._ids(slug, q='nomatch'), set())

    def test_terms_are_anded(self):
        for slug, model, _, _ in TEXT_MODULES:
            with self.subTest(slug):
                alpha, _, _ = self._seed(model)
                self.assertEqual(self._ids(slug, q='alpha traders'), {alpha.id})
                self.assertEqual(self._ids(slug, q='alpha foods'), set())

    def test_blank_q_is_ignored(self):
        for slug, model, _, _ in TEXT_MODULES:
            with self.subTest(slug):
                rows = self._seed(model)
                self.assertEqual(self._ids(slug, q='   '), {r.id for r in rows})

    def test_q_ands_with_date_range(self):
        for slug, model, _, _ in TEXT_MODULES:
            with self.subTest(slug):
                july = self._make(model, 'Delta July', 'PIB-1')
                august = self._make(model, 'Delta August', 'PIB-2', date=date(2026, 8, 5))
                self.assertEqual(self._ids(slug, q='delta'), {july.id, august.id})
                self.assertEqual(
                    self._ids(slug, q='delta', date_from='2026-08-01', date_to='2026-08-31'),
                    {august.id},
                )

    def test_q_ands_with_status(self):
        cases = [
            ('motor-new', MotorNewEntry, 'converted'),
            ('motor-claim', MotorClaimEntry, 'claims_resolved'),
            ('sales-kpi', SalesKPIEntry, 'won'),
            ('medical-claim', MedicalClaimEntry, 'claims_resolved'),
        ]
        for slug, model, done in cases:
            with self.subTest(slug):
                open_ = self._make(model, 'Echo Open', 'PIB-1')
                closed = self._make(model, 'Echo Closed', 'PIB-2', status=done)
                self.assertEqual(self._ids(slug, q='echo'), {open_.id, closed.id})
                self.assertEqual(self._ids(slug, q='echo', status=done), {closed.id})

    def test_legacy_name_params_still_work(self):
        for slug, model, _, column in TEXT_MODULES:
            with self.subTest(slug):
                alpha, _, _ = self._seed(model)
                self.assertEqual(self._ids(slug, **{column: 'alpha'}), {alpha.id})

    def test_own_visibility_still_applies(self):
        self.api.force_authenticate(self.own_user)
        for slug, model, _, _ in TEXT_MODULES:
            with self.subTest(slug):
                mine = self._make(model, 'Foxtrot Mine', 'PIB-31', added_by=self.own_user)
                theirs = self._make(model, 'Foxtrot Theirs', 'PIB-32')
                self.assertEqual(self._ids(slug, q='foxtrot'), {mine.id})
                self.assertEqual(self._ids(slug, q='PIB-32'), set())
                self.assertNotIn(theirs.id, self._ids(slug))


class MarineNewSearchTests(_Base):
    """Marine New: the client is a saved-client picker (`client` FK)."""
    URL = '/api/entries/marine-new/'

    def setUp(self):
        super().setUp()
        # Fixed, digit-free usernames: a generated code could contain '12' and
        # make the bare-number ID test match a client by username.
        self.ocean = Client.objects.create(
            name='Ocean Shipping LLC', username='@ocean_shipping_llc_abcd', is_marine=True)
        self.harbor = Client.objects.create(
            name='Harbor Freight', username='@harbor_freight_wxyz', is_marine=True)

    def _marine(self, pib_id, client=None, client_name='', **extra):
        return self._make(
            MarineNewEntry, client_name, pib_id, client=client, **extra,
        )

    def test_id_terms_match_exactly(self):
        twelve = self._marine('PIB-12', client=self.ocean)
        hundred_twenty = self._marine('PIB-120', client=self.harbor)
        for term in ('12', 'PIB-12', 'pib 12'):
            self.assertEqual(self._ids('marine-new', q=term), {twelve.id}, term)
        self.assertEqual(self._ids('marine-new', q='PIB-120'), {hundred_twenty.id})

    def test_matches_linked_client_name_and_username(self):
        ocean = self._marine('PIB-1', client=self.ocean)
        self._marine('PIB-2', client=self.harbor)
        self.assertEqual(self._ids('marine-new', q='ocean ship'), {ocean.id})
        self.assertEqual(self._ids('marine-new', q=self.ocean.username), {ocean.id})

    def test_legacy_typed_client_name_is_not_searched(self):
        legacy = self._marine('PIB-5', client_name='Legacy Seaways')
        self.assertEqual(self._ids('marine-new', q='seaways'), set())
        # Still reachable by id, and by the old client_name param.
        self.assertEqual(self._ids('marine-new', q='PIB-5'), {legacy.id})
        self.assertEqual(self._ids('marine-new', client_name='seaways'), {legacy.id})

    def test_matches_policy_number(self):
        won = self._marine('PIB-1', client=self.ocean, policy_number='MAR/POL-7781')
        self._marine('PIB-2', client=self.harbor)
        self.assertEqual(self._ids('marine-new', q='pol-7781'), {won.id})

    def test_matches_insurer_ref_value_not_insurer_id(self):
        # A distinctive insurer id, so it cannot collide with a PIB id or the
        # 2 random digits of a generated client username.
        insurer = InsuranceCompany.objects.create(id=987654, name='Keyed Insurer')
        refs = {str(insurer.id): 'QREF-ABC', str(self.blue.id): 'ZZ-900'}
        shared = self._marine('PIB-1', client=self.ocean, insurer_references=refs)
        other = self._marine('PIB-2', client=self.harbor)
        self.assertEqual(shared.insurer_references_text, 'QREF-ABC ZZ-900')
        self.assertEqual(self._ids('marine-new', q='qref-abc'), {shared.id})
        self.assertEqual(self._ids('marine-new', q='zz-900'), {shared.id})
        self.assertNotIn(other.id, self._ids('marine-new', q='qref'))
        # The dict key (insurer id) is not searchable text.
        self.assertEqual(self._ids('marine-new', q='987654'), set())

    def test_partial_save_of_refs_keeps_search_text_in_sync(self):
        entry = self._marine('PIB-1', client=self.ocean)
        entry.insurer_references = {str(self.acme.id): 'NEW-REF-1'}
        entry.save(update_fields=['insurer_references'])
        entry.refresh_from_db()
        self.assertEqual(entry.insurer_references_text, 'NEW-REF-1')
        self.assertEqual(self._ids('marine-new', q='new-ref-1'), {entry.id})

    def test_update_status_shared_with_client_indexes_refs(self):
        entry = self._marine('PIB-1', client=self.ocean)
        entry.compared_insurance_companies.add(self.acme)
        resp = self.api.patch(
            f'{self.URL}{entry.id}/update-status/',
            {'status': 'shared_with_client',
             'insurer_references': {str(self.acme.id): 'VIA-API-9'}},
            format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(self._ids('marine-new', q='via-api-9'), {entry.id})
        # The derived column is not part of the API.
        self.assertNotIn('insurer_references_text', resp.data)

    def test_derived_column_is_excluded_from_audit_diffs(self):
        self.assertIn('insurer_references_text', PER_MODEL_IGNORED_FIELDS[MarineNewEntry])
        self.assertIn('tat_minutes', PER_MODEL_IGNORED_FIELDS[MarineNewEntry])

    def test_q_ands_with_status_and_client_filter(self):
        open_ = self._marine('PIB-1', client=self.ocean)
        won = self._marine('PIB-2', client=self.ocean, status='converted')
        harbor = self._marine('PIB-3', client=self.harbor)
        self.assertEqual(self._ids('marine-new', q='ocean'), {open_.id, won.id})
        self.assertEqual(self._ids('marine-new', q='ocean', status='converted'), {won.id})
        self.assertEqual(self._ids('marine-new', q='ocean', client=self.harbor.id), set())
        self.assertEqual(self._ids('marine-new', client=self.harbor.id), {harbor.id})

    def test_own_visibility_still_applies(self):
        self.api.force_authenticate(self.own_user)
        mine = self._marine('PIB-1', client=self.ocean, added_by=self.own_user)
        self._marine('PIB-2', client=self.ocean)
        self.assertEqual(self._ids('marine-new', q='ocean'), {mine.id})

    def test_export_follows_q(self):
        ocean = self._marine('PIB-1', client=self.ocean)
        self._marine('PIB-2', client=self.harbor)
        resp = self.api.get(f'{self.URL}export/', {'q': 'ocean'})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual([r['ID'] for r in parse_csv(resp)], [ocean.pib_id])
