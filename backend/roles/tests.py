from django.test import TestCase
from rest_framework.test import APIClient

from auth_app.models import CustomUser


class MarineModulePermissionTests(TestCase):
    """The role dialog lists Marine Dashboard alongside Marine New and Renewal."""

    def setUp(self):
        self.admin = CustomUser.objects.create(email='admin@x.com', full_name='A', is_staff=True)
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def test_modules_list_includes_all_marine_options(self):
        r = self.client.get('/api/roles/modules/')
        self.assertEqual(r.status_code, 200)
        marine = [m['key'] for m in r.data['modules'] if m['key'].startswith('marine_')]
        self.assertEqual(marine, ['marine_dashboard', 'marine_new', 'marine_renewal'])

    def test_role_saves_marine_dashboard_with_entry_modules(self):
        modules = ['marine_dashboard', 'marine_new', 'marine_renewal']
        r = self.client.post('/api/roles/', {
            'name': 'Marine team', 'data_visibility': 'own', 'module_permissions': modules,
        }, format='json')
        self.assertEqual(r.status_code, 201, r.content)
        self.assertCountEqual([p['module'] for p in r.data['permissions']], modules)
