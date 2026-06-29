"""Tests for the agent/source/assignee picker visibility (TED-578)."""
from django.test import TestCase
from rest_framework.test import APIClient

from roles.models import Role, RoleModulePermission

from .models import CustomUser


class ShowInDropdownTests(TestCase):
    def setUp(self):
        self.role = Role.objects.create(name='Sales', data_visibility='own')
        RoleModulePermission.objects.create(role=self.role, module='sales_kpi')
        self.admin = CustomUser.objects.create(
            email='admin@x.com', full_name='Admin', is_staff=True,
        )
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _mk(self, email, **kw):
        return CustomUser.objects.create(
            email=email, full_name=email.split('@')[0], role=self.role, **kw,
        )

    def test_active_endpoint_excludes_hidden_and_inactive(self):
        self._mk('vis@x.com')                            # active + shown
        self._mk('hid@x.com', show_in_dropdown=False)    # active but hidden
        self._mk('ina@x.com', is_active=False)           # deactivated
        emails = {u['email'] for u in self.client.get('/api/auth/users/active/').data['results']}
        self.assertIn('vis@x.com', emails)
        self.assertNotIn('hid@x.com', emails)
        self.assertNotIn('ina@x.com', emails)

    def test_module_members_excludes_hidden_and_inactive(self):
        self._mk('vis2@x.com')
        self._mk('hid2@x.com', show_in_dropdown=False)
        self._mk('ina2@x.com', is_active=False)
        resp = self.client.get('/api/auth/users/module-members/?module=sales_kpi')
        emails = {u['email'] for u in resp.data['results']}
        self.assertIn('vis2@x.com', emails)
        self.assertNotIn('hid2@x.com', emails)
        self.assertNotIn('ina2@x.com', emails)

    def test_admin_serializer_roundtrips_show_in_dropdown(self):
        # Defaults to True on create; togglable via PATCH.
        r = self.client.post(
            '/api/auth/users/', {'email': 'new@x.com', 'full_name': 'New'}, format='json',
        )
        self.assertEqual(r.status_code, 201, r.content)
        self.assertTrue(r.data['show_in_dropdown'])
        uid = r.data['id']
        r = self.client.patch(
            f'/api/auth/users/{uid}/', {'show_in_dropdown': False}, format='json',
        )
        self.assertEqual(r.status_code, 200, r.content)
        self.assertFalse(CustomUser.objects.get(id=uid).show_in_dropdown)
