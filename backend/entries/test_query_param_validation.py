"""Non-numeric `user_id` / `year` / `month` query params are a 400, never a 500.

- Entry lists (every module, via BaseEntryViewSet) and their `stats/` action.
- Monthly-target list and `current/` (HodAwareMonthlyTargetMixin).
- Valid values (including an empty `user_id`) behave exactly as before.
"""
from django.core.cache import cache
from django.test import TestCase
from rest_framework.test import APIClient

from auth_app.models import CustomUser
from roles.models import Role, RoleModulePermission

from .models import ClassOfInsurance, SalesKPIEntry, SalesMonthlyTarget


class QueryParamValidationTests(TestCase):
    @classmethod
    def setUpTestData(cls):
        all_role = Role.objects.create(name='Param All', data_visibility='all')
        for key in ('sales_kpi', 'motor_new'):
            RoleModulePermission.objects.create(role=all_role, module=key)
        cls.admin = CustomUser.objects.create(
            email='param-admin@x.com', full_name='Param Admin', is_staff=True,
        )
        cls.all_user = CustomUser.objects.create(
            email='param-all@x.com', full_name='Param All', role=all_role,
        )
        coi = ClassOfInsurance.objects.create(name='Param Test Class')
        for user in (cls.admin, cls.all_user):
            SalesKPIEntry.objects.create(
                date='2026-11-03', added_by=user, customer_name=f'Param {user.id}',
                entry_type='new', class_of_insurance=coi, assignee=user,
                status='won', converted_premium=1000,
            )
        SalesMonthlyTarget.objects.create(
            user=cls.all_user, year=2026, month=11,
            premium_target=30000, clients_assigned=20000,
        )

    def setUp(self):
        self.api = APIClient()
        self.api.force_authenticate(self.admin)

    def tearDown(self):
        cache.clear()
        super().tearDown()

    def assert_400(self, url, field):
        resp = self.api.get(url)
        self.assertEqual(resp.status_code, 400, url)
        self.assertIn(field, resp.json(), url)

    def test_entry_list_rejects_non_numeric_user_id(self):
        for url in (
            '/api/entries/sales-kpi/?user_id=abc',
            '/api/entries/sales-kpi/?user_id=5.0',
            '/api/entries/motor-new/?user_id=abc',
            '/api/entries/sales-kpi/stats/?user_id=abc',
        ):
            self.assert_400(url, 'user_id')

    def test_entry_list_rejects_for_all_visibility_role(self):
        self.api.force_authenticate(self.all_user)
        self.assert_400('/api/entries/sales-kpi/?user_id=abc', 'user_id')

    def test_monthly_targets_reject_non_numeric_params(self):
        base = '/api/entries/sales-kpi/monthly-targets/'
        self.assert_400(f'{base}?user_id=abc', 'user_id')
        self.assert_400(f'{base}?year=abc', 'year')
        self.assert_400(f'{base}?year=2026&month=x', 'month')
        self.assert_400(f'{base}current/?user_id=abc', 'user_id')

    def test_out_of_range_numbers_are_400(self):
        huge = '99999999999999999999'
        self.assert_400(f'/api/entries/sales-kpi/?user_id={huge}', 'user_id')
        self.assert_400(f'/api/entries/sales-kpi/monthly-targets/?user_id={huge}', 'user_id')
        self.assert_400('/api/entries/sales-kpi/monthly-targets/?year=3000000000', 'year')

    def test_own_user_stats_still_ignore_user_id(self):
        # "own" viewers never filter by user_id, so a junk value stays ignored.
        own_role = Role.objects.create(name='Param Own', data_visibility='own')
        RoleModulePermission.objects.create(role=own_role, module='sales_kpi')
        own = CustomUser.objects.create(
            email='param-own@x.com', full_name='Param Own', role=own_role,
        )
        self.api.force_authenticate(own)
        resp = self.api.get('/api/entries/sales-kpi/stats/?user_id=abc')
        self.assertEqual(resp.status_code, 200)

    def test_valid_user_id_still_filters(self):
        resp = self.api.get(f'/api/entries/sales-kpi/?user_id={self.all_user.id}')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(
            [r['customer_name'] for r in resp.json()['results']],
            [f'Param {self.all_user.id}'],
        )

    def test_empty_user_id_is_ignored(self):
        resp = self.api.get('/api/entries/sales-kpi/?user_id=')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.json()['count'], 2)

    def test_valid_monthly_target_params_unchanged(self):
        base = '/api/entries/sales-kpi/monthly-targets/'
        one = self.api.get(f'{base}?year=2026&month=11&user_id={self.all_user.id}')
        self.assertEqual(one.status_code, 200)
        self.assertEqual(len(one.json()['results']), 1)
        team = self.api.get(f'{base}?year=2026&month=11')
        self.assertEqual(team.status_code, 200)
        self.assertEqual(float(team.json()[0]['premium_target']), 30000)
