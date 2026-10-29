"""Saved client list (Client / ClientCategory) + the Marine New client link.

- Models: one tag per client and category; generated usernames are
  `slug_` + 2 digits and 3 letters, unique, capped at 200 characters.
- Backfill migration 0056: same normalised name -> one client (most common
  spelling, ties -> earliest entry), client_name / updated_at untouched, blank
  names unlinked, idempotent, reversible.
- /api/entries/clients/: permissions per role, category isolation, the 409
  duplicate check (+ force), rename propagation with audit rows, delete
  protection, pagination.
- Marine New: `client` keeps client_name in sync, text-only creates auto-link,
  wrong-category / inactive clients are refused, filters and export unchanged.
"""
import csv
import importlib
import re
from datetime import date
from io import StringIO
from unittest import mock

from django.apps import apps
from django.db import IntegrityError, connection, transaction
from django.test import TestCase
from django.test.utils import CaptureQueriesContext
from rest_framework.test import APIClient

from audit.models import AuditLog
from auth_app.models import CustomUser
from roles.models import Role, RoleModulePermission

from .models import (
    CATEGORY_MODULES,
    MODULE_CATEGORY,
    Client,
    ClientCategory,
    MarineNewEntry,
    generate_client_username,
)

CLIENTS_URL = '/api/entries/clients/'
MARINE_URL = '/api/entries/marine-new/'
USERNAME_RE = re.compile(r'^[a-z0-9_]+_[a-z0-9]{5}$')


def _backfill_module():
    return importlib.import_module('entries.migrations.0056_backfill_marine_clients')


def make_client(name, categories=('marine',), is_active=True, **kwargs):
    client = Client.objects.create(name=name, is_active=is_active, **kwargs)
    for key in categories:
        ClientCategory.objects.create(client=client, category=key)
    return client


class _Base(TestCase):
    @classmethod
    def setUpTestData(cls):
        marine_role = Role.objects.create(name='Marine', data_visibility='own')
        RoleModulePermission.objects.create(role=marine_role, module='marine_new')
        motor_role = Role.objects.create(name='Motor', data_visibility='all')
        RoleModulePermission.objects.create(role=motor_role, module='motor_new')
        hod_role = Role.objects.create(name='Marine HOD', data_visibility='all', is_hod=True)
        RoleModulePermission.objects.create(role=hod_role, module='marine_new')
        settings_role = Role.objects.create(name='Settings', data_visibility='own')
        RoleModulePermission.objects.create(role=settings_role, module='settings')

        cls.marine_user = CustomUser.objects.create(
            email='marine@x.com', full_name='Mara Marine', role=marine_role,
        )
        cls.motor_user = CustomUser.objects.create(
            email='motor@x.com', full_name='Moe Motor', role=motor_role,
        )
        cls.hod = CustomUser.objects.create(
            email='hod@x.com', full_name='Hank Hod', role=hod_role,
        )
        cls.settings_user = CustomUser.objects.create(
            email='settings@x.com', full_name='Sam Settings', role=settings_role,
        )
        cls.staff = CustomUser.objects.create(
            email='admin@x.com', full_name='Ada Admin', is_staff=True,
        )

    def setUp(self):
        self.api = APIClient()
        self.as_user(self.marine_user)

    def as_user(self, user):
        self.api.force_authenticate(user)

    def _entry(self, client_name='C', client=None, added_by=None):
        return MarineNewEntry.objects.create(
            client_name=client_name, client=client,
            agent=self.marine_user, added_by=added_by or self.marine_user,
            date=date(2026, 7, 1), potential_premium='5000.00',
        )

    def _list(self, **params):
        return self.api.get(CLIENTS_URL, params)

    def _names(self, resp):
        return [row['name'] for row in resp.data['results']]


# ─── Models + usernames ───────────────────────────────────────────────────────

class ModelTests(_Base):
    def test_tag_unique_per_client_and_category(self):
        client = make_client('ABC Ltd', categories=['marine'])
        with self.assertRaises(IntegrityError), transaction.atomic():
            ClientCategory.objects.create(client=client, category='marine')
        ClientCategory.objects.create(client=client, category='motor')
        self.assertEqual(client.category_keys, ['motor', 'marine'])

    def test_category_module_maps_follow_the_sidebar(self):
        self.assertEqual(MODULE_CATEGORY['marine_new'], 'marine')
        self.assertEqual(MODULE_CATEGORY['marine_renewal'], 'marine')
        self.assertEqual(MODULE_CATEGORY['motor_fleet_new'], 'motor')
        self.assertEqual(MODULE_CATEGORY['sales_kpi'], 'sales')
        self.assertEqual(MODULE_CATEGORY['medical_claim'], 'medical')
        self.assertEqual(MODULE_CATEGORY['general_renewal'], 'general')
        self.assertEqual(set(CATEGORY_MODULES), {'general', 'motor', 'sales', 'marine', 'medical'})

    def test_names_may_repeat(self):
        a = make_client('Same Name')
        b = make_client('Same Name')
        self.assertNotEqual(a.username, b.username)


class UsernameTests(_Base):
    def _assert_format(self, username):
        self.assertRegex(username, USERNAME_RE)
        code = username.rsplit('_', 1)[1]
        self.assertEqual(sum(ch.isdigit() for ch in code), 2, username)
        self.assertEqual(sum(ch.isalpha() and ch.islower() for ch in code), 3, username)

    def test_format(self):
        client = make_client('ABC Ltd.')
        self.assertTrue(client.username.startswith('abc_ltd_'))
        self._assert_format(client.username)

    def test_symbols_and_non_latin_names_still_get_a_username(self):
        for name, prefix in (
            ('شركة الخليج', 'client_'), ('!!! ###', 'client_'),
            ('Café  Ltd', 'cafe_ltd_'), ('🚢 Ship Co', 'ship_co_'),
        ):
            username = make_client(name).username
            self.assertTrue(username.startswith(prefix), (name, username))
            self._assert_format(username)

    def test_length_capped_at_200(self):
        username = make_client('A' * 200).username
        self.assertEqual(len(username), 200)
        self._assert_format(username)
        # A cut that lands on a separator does not leave a double underscore.
        username = make_client('a' * 193 + ' bc').username
        self.assertLessEqual(len(username), 200)
        self._assert_format(username)

    def test_unique_across_10k(self):
        seen = set()
        for _ in range(10000):
            username = generate_client_username('Acme')
            self.assertNotIn(username, seen)
            seen.add(username)
            Client.objects.bulk_create([Client(name='Acme', username=username)])
        self.assertEqual(Client.objects.values('username').distinct().count(), 10000)

    def test_regenerated_on_clash_with_existing_username(self):
        with mock.patch(
            'entries.models._client_username_code',
            side_effect=['ab12c', 'ab12c', 'xy34z'],
        ):
            first = make_client('Acme')
            second = make_client('Acme')
        self.assertEqual(first.username, 'acme_ab12c')
        self.assertEqual(second.username, 'acme_xy34z')

    def test_save_retries_on_integrity_clash(self):
        taken = make_client('Acme').username
        with mock.patch(
            'entries.models.generate_client_username',
            side_effect=[taken, 'acme_zz99z'],
        ):
            client = Client.objects.create(name='Acme')
        self.assertEqual(client.username, 'acme_zz99z')

    def test_rename_keeps_username(self):
        client = make_client('Old Name')
        username = client.username
        client.name = 'New Name'
        client.save()
        client.refresh_from_db()
        self.assertEqual(client.username, username)


# ─── Clients API: permissions + categories ────────────────────────────────────

class PermissionMatrixTests(_Base):
    def setUp(self):
        super().setUp()
        self.target = make_client('Target Co', categories=['marine'])

    def _create(self, name='Brand New', **body):
        return self.api.post(CLIENTS_URL, {'name': name, **body}, format='json')

    def _patch(self, **body):
        return self.api.patch(f'{CLIENTS_URL}{self.target.pk}/', body, format='json')

    def _delete(self):
        return self.api.delete(f'{CLIENTS_URL}{self.target.pk}/')

    def test_marine_user(self):
        self.as_user(self.marine_user)
        self.assertEqual(self._list(category='marine').status_code, 200)
        self.assertEqual(self._list().status_code, 400)  # category required
        self.assertEqual(self._create().status_code, 201)
        self.assertEqual(self._patch(name='X').status_code, 403)
        self.assertEqual(self._delete().status_code, 403)
        self.assertEqual(self.api.get(f'{CLIENTS_URL}{self.target.pk}/').status_code, 200)

    def test_user_without_marine_access(self):
        self.as_user(self.motor_user)
        self.assertEqual(self._list(category='marine').status_code, 403)
        self.assertEqual(self._list(category='motor').status_code, 200)
        self.assertEqual(self._create(categories=['marine']).status_code, 403)
        self.assertEqual(self._create(categories=['motor']).status_code, 201)
        self.assertEqual(self._patch(name='X').status_code, 403)
        self.assertEqual(self._delete().status_code, 403)
        # A marine-only client is not reachable through retrieve either.
        self.assertEqual(self.api.get(f'{CLIENTS_URL}{self.target.pk}/').status_code, 404)

    def test_hod(self):
        self.as_user(self.hod)
        self.assertEqual(self._list(category='marine').status_code, 200)
        self.assertEqual(self._create().status_code, 403)
        self.assertEqual(self._patch(name='X').status_code, 403)
        self.assertEqual(self._delete().status_code, 403)

    def _assert_admin(self):
        resp = self._list()
        self.assertEqual(resp.status_code, 200)
        self.assertIn('Target Co', self._names(resp))
        self.assertEqual(self._create(categories=['medical']).status_code, 201)
        resp = self._patch(name='Renamed Co')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['name'], 'Renamed Co')
        self.assertEqual(self._delete().status_code, 204)

    def test_settings_user(self):
        self.as_user(self.settings_user)
        self._assert_admin()

    def test_staff(self):
        self.as_user(self.staff)
        self._assert_admin()

    def test_unauthenticated(self):
        self.api.force_authenticate(None)
        self.assertIn(self._list(category='marine').status_code, (401, 403))
        self.assertIn(self._create().status_code, (401, 403))

    def test_categories_endpoint(self):
        self.as_user(self.motor_user)
        resp = self.api.get(f'{CLIENTS_URL}categories/')
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, [
            {'value': 'general', 'label': 'General'},
            {'value': 'motor', 'label': 'Motor'},
            {'value': 'sales', 'label': 'Sales'},
            {'value': 'marine', 'label': 'Marine'},
            {'value': 'medical', 'label': 'Medical'},
        ])


class CategoryIsolationTests(_Base):
    def test_lists_are_per_category(self):
        make_client('Motor Only', categories=['motor'])
        make_client('Both', categories=['marine', 'motor'])
        make_client('Marine Only', categories=['marine'])
        self.as_user(self.marine_user)
        self.assertEqual(self._names(self._list(category='marine')), ['Both', 'Marine Only'])
        self.as_user(self.motor_user)
        self.assertEqual(self._names(self._list(category='motor')), ['Both', 'Motor Only'])

    def test_payload_shape(self):
        client = make_client('Both', categories=['motor', 'marine'])
        row = self._list(category='marine').data['results'][0]
        self.assertEqual(set(row), {
            'id', 'name', 'username', 'categories', 'is_active', 'source',
            'created_at', 'updated_at',
        })
        self.assertEqual(row['categories'], ['motor', 'marine'])
        self.assertEqual(row['username'], client.username)

    def test_create_defaults_to_marine(self):
        resp = self.api.post(CLIENTS_URL, {'name': '  New Co  '}, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['name'], 'New Co')
        self.assertEqual(resp.data['categories'], ['marine'])
        self.assertEqual(resp.data['source'], 'user')
        self.assertEqual(Client.objects.get(pk=resp.data['id']).created_by, self.marine_user)

    def test_marine_user_can_also_tag_motor(self):
        resp = self.api.post(
            CLIENTS_URL, {'name': 'Dual', 'categories': ['motor', 'marine', 'motor']},
            format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['categories'], ['motor', 'marine'])

    def test_validation(self):
        for body in (
            {'name': 'X', 'categories': ['nope']},
            {'name': 'X', 'categories': []},
            {'name': '   '},
            {'name': 'x' * 201},
        ):
            resp = self.api.post(CLIENTS_URL, body, format='json')
            self.assertEqual(resp.status_code, 400, body)
        self.assertEqual(self._list(category='nope').status_code, 400)
        self.assertEqual(
            self.api.post(CLIENTS_URL, {'name': 'x' * 200}, format='json').status_code, 201,
        )

    def test_dropdown_lists_active_by_default(self):
        make_client('Live')
        make_client('Gone', is_active=False)
        self.assertEqual(self._names(self._list(category='marine')), ['Live'])
        self.assertEqual(self._names(self._list(category='marine', is_active='true')), ['Live'])
        self.as_user(self.settings_user)
        self.assertEqual(self._names(self._list(category='marine')), ['Gone', 'Live'])
        self.assertEqual(self._names(self._list(is_active='false')), ['Gone'])

    def test_search_name_or_username(self):
        acme = make_client('Acme Shipping')
        make_client('Blue Ocean')
        self.assertEqual(self._names(self._list(category='marine', search='ACME')), ['Acme Shipping'])
        code = acme.username.rsplit('_', 1)[1]
        self.assertEqual(self._names(self._list(category='marine', search=code)), ['Acme Shipping'])

    def test_include_counts(self):
        client = make_client('Counted')
        self._entry(client_name='Counted', client=client)
        self._entry(client_name='Counted', client=client)
        self.as_user(self.settings_user)
        row = self._list(include_counts='1').data['results'][0]
        self.assertEqual(row['linked_entries_count'], 2)
        self.assertNotIn('linked_entries_count', self._list().data['results'][0])


class DuplicateTests(_Base):
    def _post(self, name, **body):
        return self.api.post(CLIENTS_URL, {'name': name, **body}, format='json')

    def test_same_name_returns_409_with_matches(self):
        existing = make_client('ABC Ltd')
        for variant in ('ABC Ltd', 'abc ltd', '  ABC   LTD '):
            resp = self._post(variant)
            self.assertEqual(resp.status_code, 409, variant)
            self.assertEqual(resp.data['detail'], 'Client already exists')
            self.assertEqual(resp.data['matches'], [{
                'id': existing.id, 'name': 'ABC Ltd',
                'username': existing.username, 'categories': ['marine'],
            }])
        self.assertEqual(Client.objects.count(), 1)

    def test_force_creates_with_a_new_username(self):
        existing = make_client('ABC Ltd')
        resp = self._post('abc ltd', force=True)
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertNotEqual(resp.data['username'], existing.username)
        self.assertEqual(Client.objects.count(), 2)

    def test_not_across_categories_or_inactive_or_near_names(self):
        make_client('Motor Co', categories=['motor'])
        make_client('Old Co', is_active=False)
        make_client('ABC Ltd')
        self.assertEqual(self._post('motor co').status_code, 201)
        self.assertEqual(self._post('old co').status_code, 201)
        self.assertEqual(self._post('ABC Ltd.').status_code, 201)
        self.assertEqual(self._post('ABCLtd').status_code, 201)

    def test_regex_special_characters_are_literal(self):
        make_client('A+B (Pvt) Ltd.*')
        self.assertEqual(self._post('a+b (pvt) ltd.*').status_code, 409)
        self.assertEqual(self._post('aab (pvt) ltdx').status_code, 201)


__ENQUIRY_TESTS__

# ─── Pagination ──────────────────────────────────────────────────────────────

class PaginationTests(_Base):
    def _bulk(self, count, prefix='Client', categories=('marine',)):
        clients = Client.objects.bulk_create([
            Client(name=f'{prefix} {i:03d}', username=f'{prefix.lower()}_{i:03d}_ab12c')
            for i in range(count)
        ])
        clients = list(Client.objects.filter(name__startswith=f'{prefix} '))
        ClientCategory.objects.bulk_create([
            ClientCategory(client=c, category=key) for c in clients for key in categories
        ])
        return clients

    def test_default_and_capped_page_size(self):
        self._bulk(130)
        resp = self._list(category='marine')
        self.assertEqual(resp.data['count'], 130)
        self.assertEqual(len(resp.data['results']), 20)
        self.assertIsNotNone(resp.data['next'])
        self.assertEqual(len(self._list(category='marine', page_size=100).data['results']), 100)
        self.assertEqual(len(self._list(category='marine', page_size=101).data['results']), 100)

    def test_walk_returns_each_client_once(self):
        clients = self._bulk(45)
        # Same-name clients sort by id so they never swap across pages.
        dupes = [make_client('Client 010') for _ in range(3)]
        expected = {c.pk for c in clients} | {c.pk for c in dupes}
        seen = []
        page = 1
        while True:
            resp = self._list(category='marine', page=page, page_size=7)
            self.assertEqual(resp.status_code, 200)
            seen.extend(row['id'] for row in resp.data['results'])
            if not resp.data['next']:
                break
            page += 1
        self.assertEqual(len(seen), len(expected))
        self.assertEqual(set(seen), expected)

    def test_search_with_pagination(self):
        self._bulk(30, prefix='Alpha')
        self._bulk(30, prefix='Beta')
        resp = self._list(category='marine', search='alpha', page_size=10, page=3)
        self.assertEqual(resp.data['count'], 30)
        self.assertEqual(len(resp.data['results']), 10)
        self.assertTrue(all(name.startswith('Alpha') for name in self._names(resp)))
        self.assertIsNone(resp.data['next'])

    def test_out_of_range_page_is_404(self):
        self._bulk(5)
        self.assertEqual(self._list(category='marine', page=2).status_code, 404)

    def _count_queries(self, **params):
        with CaptureQueriesContext(connection) as ctx:
            resp = self._list(category='marine', page_size=100, **params)
        self.assertEqual(resp.status_code, 200)
        return len(ctx.captured_queries)

    def test_query_count_constant(self):
        self._bulk(5, prefix='Small', categories=('marine', 'motor'))
        small = self._count_queries()
        self._bulk(60, prefix='Large', categories=('marine', 'motor'))
        self.assertEqual(self._count_queries(), small)
        self.as_user(self.settings_user)
        with_counts = self._count_queries(include_counts='1')
        self._bulk(10, prefix='More')
        self.assertEqual(self._count_queries(include_counts='1'), with_counts)
