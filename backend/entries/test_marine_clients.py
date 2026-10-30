"""Saved client list (Client, categories as is_<category> columns) + the
Marine New client link.

- Models: category tags are boolean columns; generated usernames are
  `slug_` + 2 digits and 2 letters in random order, unique, capped at 200
  characters.
- /api/entries/clients/: permissions per role (admins, or the creator for
  edits), category isolation, notes, the 409 duplicate check (+ force),
  delete protection, pagination. A rename does not touch enquiries (they
  read the name from the client).
- Marine New: `client` is required on create (typed text alone is refused),
  client_name is saved '' and is read-only, `client_display` falls back to the
  legacy text, and the client_name filter / export read either.
- link-client: the creator links a legacy row (added before
  MARINE_CLIENT_LINK_CUTOFF) once, clearing the typed name in one audited
  save; everyone else, voided rows, linked rows and bad clients are refused.
"""
import csv
import re
from datetime import date, datetime, timedelta, timezone as dt_timezone
from io import StringIO
from unittest import mock

from django.db import connection
from django.core.cache import cache
from django.test import TestCase, override_settings
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework.test import APIClient

from audit.models import AuditLog
from auth_app.models import CustomUser
from roles.models import Role, RoleModulePermission

from .models import (
    CATEGORY_FIELDS,
    CATEGORY_MODULES,
    MODULE_CATEGORY,
    Client,
    MarineNewEntry,
    generate_client_username,
    marine_client_link_cutoff,
)

CLIENTS_URL = '/api/entries/clients/'
MARINE_URL = '/api/entries/marine-new/'
USERNAME_RE = re.compile(r'^@[a-z0-9_]+_[a-z0-9]{4}$')


def category_flags(categories):
    return {field: key in categories for key, field in CATEGORY_FIELDS.items()}


def make_client(name, categories=('marine',), is_active=True, **kwargs):
    return Client.objects.create(
        name=name, is_active=is_active, **category_flags(categories), **kwargs,
    )


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
        cls.marine_other = CustomUser.objects.create(
            email='marine2@x.com', full_name='Otto Other', role=marine_role,
        )
        marine_all_role = Role.objects.create(name='Marine All', data_visibility='all')
        RoleModulePermission.objects.create(role=marine_all_role, module='marine_new')
        cls.marine_all = CustomUser.objects.create(
            email='marineall@x.com', full_name='Alice All', role=marine_all_role,
        )

    def setUp(self):
        self.api = APIClient()
        self.as_user(self.marine_user)

    def tearDown(self):
        # DRF throttle counters live in the (process-wide) default cache and
        # test user ids repeat across test classes; clear them so this module's
        # many requests never throttle later tests.
        cache.clear()
        super().tearDown()

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
    def test_categories_are_boolean_columns(self):
        self.assertEqual(CATEGORY_FIELDS, {
            'general': 'is_general', 'motor': 'is_motor', 'sales': 'is_sales',
            'marine': 'is_marine', 'medical': 'is_medical',
        })
        client = make_client('ABC Ltd', categories=['marine'])
        self.assertTrue(client.is_marine)
        self.assertFalse(client.is_motor)
        client.set_categories(['medical', 'motor', 'marine'])
        client.save()
        client.refresh_from_db()
        self.assertEqual(client.category_keys, ['motor', 'marine', 'medical'])
        self.assertEqual((client.is_general, client.is_sales), (False, False))

    def test_new_client_has_blank_notes_and_no_categories_by_default(self):
        client = Client.objects.create(name='Bare')
        self.assertEqual(client.notes, '')
        self.assertEqual(client.category_keys, [])

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
        self.assertEqual(sum(ch.isalpha() and ch.islower() for ch in code), 2, username)

    def test_code_order_is_random(self):
        patterns = {
            ''.join('d' if ch.isdigit() else 'l' for ch in generate_client_username('x').rsplit('_', 1)[1])
            for _ in range(300)
        }
        # 2 digits + 2 letters can sit in any of the 6 arrangements.
        self.assertGreater(len(patterns), 1)
        self.assertTrue(patterns <= {'ddll', 'dldl', 'dlld', 'lddl', 'ldld', 'lldd'})

    def test_format(self):
        client = make_client('ABC Ltd.')
        self.assertTrue(client.username.startswith('@abc_ltd_'))
        self._assert_format(client.username)

    def test_symbols_and_non_latin_names_still_get_a_username(self):
        for name, prefix in (
            ('شركة الخليج', '@client_'), ('!!! ###', '@client_'),
            ('Café  Ltd', '@cafe_ltd_'), ('🚢 Ship Co', '@ship_co_'),
        ):
            username = make_client(name).username
            self.assertTrue(username.startswith(prefix), (name, username))
            self._assert_format(username)

    def test_length_capped_at_200(self):
        username = make_client('A' * 200).username
        self.assertEqual(len(username), 200)
        self._assert_format(username)
        # A cut that lands on a separator does not leave a double underscore.
        username = make_client('a' * 194 + ' bc').username
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
            side_effect=['ab12', 'ab12', 'x3y4'],
        ):
            first = make_client('Acme')
            second = make_client('Acme')
        self.assertEqual(first.username, '@acme_ab12')
        self.assertEqual(second.username, '@acme_x3y4')

    def test_save_retries_on_integrity_clash(self):
        taken = make_client('Acme').username
        with mock.patch(
            'entries.models.generate_client_username',
            side_effect=[taken, 'acme_zz99'],
        ):
            client = Client.objects.create(name='Acme')
        self.assertEqual(client.username, 'acme_zz99')

    def test_suggest_username_endpoint(self):
        resp = self.api.get(CLIENTS_URL + 'suggest-username/', {'name': 'ABC Ltd'})
        self.assertEqual(resp.status_code, 200)
        self._assert_format(resp.data['username'])
        self.assertTrue(resp.data['username'].startswith('@abc_ltd_'))
        self.assertEqual(
            self.api.get(CLIENTS_URL + 'suggest-username/', {'name': '  '}).data,
            {'username': ''},
        )

    def test_create_keeps_previewed_username(self):
        preview = self.api.get(CLIENTS_URL + 'suggest-username/', {'name': 'ABC Ltd'}).data['username']
        resp = self.api.post(CLIENTS_URL, {'name': 'ABC Ltd', 'username': preview}, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['username'], preview)
        self.assertFalse(resp.data['username_changed'])

    def test_create_replaces_taken_or_foreign_username(self):
        taken = make_client('ABC Ltd').username
        for requested in (taken, '@other_name_ab12', 'abc_ltd_ab12', '@abc_ltd_abcd', '@abc_ltd_AB12'):
            resp = self.api.post(
                CLIENTS_URL, {'name': 'ABC Ltd', 'username': requested, 'force': True}, format='json',
            )
            self.assertEqual(resp.status_code, 201, resp.data)
            self.assertNotEqual(resp.data['username'], requested)
            self.assertTrue(resp.data['username_changed'])
            self._assert_format(resp.data['username'])

    def test_search_with_or_without_at(self):
        client = make_client('Zeta Marine')
        for term in (client.username, client.username.lstrip('@')):
            resp = self.api.get(CLIENTS_URL, {'category': 'marine', 'search': term})
            self.assertEqual([c['id'] for c in resp.data['results']], [client.id], term)

    def _create_own(self, name):
        resp = self.api.post(CLIENTS_URL, {'name': name}, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        return resp.data

    def test_api_rename_regenerates_username_with_preview(self):
        created = self._create_own('ABC Ltd')
        preview = self.api.get(
            CLIENTS_URL + 'suggest-username/', {'name': 'ABC Limited', 'client': created['id']},
        ).data['username']
        self.assertTrue(preview.startswith('@abc_limited_'))
        resp = self.api.patch(
            f"{CLIENTS_URL}{created['id']}/", {'name': 'ABC Limited', 'username': preview}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['username'], preview)
        self._assert_format(resp.data['username'])

    def test_api_rename_with_same_slug_keeps_username(self):
        created = self._create_own('ABC Ltd')
        preview = self.api.get(
            CLIENTS_URL + 'suggest-username/', {'name': 'ABC  Ltd.', 'client': created['id']},
        ).data['username']
        self.assertEqual(preview, created['username'])
        resp = self.api.patch(f"{CLIENTS_URL}{created['id']}/", {'name': 'ABC  Ltd.'}, format='json')
        self.assertEqual(resp.data['username'], created['username'])

    def test_api_rename_ignores_foreign_or_taken_username(self):
        created = self._create_own('ABC Ltd')
        taken = make_client('XYZ Co').username
        for requested in (taken, '@abc_ltd_ab12', '@xyz_limited_ab12', None):
            resp = self.api.patch(
                f"{CLIENTS_URL}{created['id']}/",
                {'name': 'XYZ Limited', **({'username': requested} if requested else {})},
                format='json',
            )
            self.assertEqual(resp.status_code, 200, resp.data)
            self.assertTrue(resp.data['username'].startswith('@xyz_limited_'), resp.data['username'])
            self.assertNotEqual(resp.data['username'], taken)
            created = resp.data

    def test_api_notes_only_edit_keeps_username(self):
        created = self._create_own('ABC Ltd')
        resp = self.api.patch(f"{CLIENTS_URL}{created['id']}/", {'notes': 'hi'}, format='json')
        self.assertEqual(resp.data['username'], created['username'])

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
        # Edits now reach the object check, so an invisible client is a 404.
        self.assertEqual(self._patch(name='X').status_code, 404)
        self.assertEqual(self._delete().status_code, 403)
        # A marine-only client is not reachable through retrieve either.
        self.assertEqual(self.api.get(f'{CLIENTS_URL}{self.target.pk}/').status_code, 404)

    def test_hod(self):
        self.as_user(self.hod)
        self.assertEqual(self._list(category='marine').status_code, 200)
        self.assertEqual(self._create().status_code, 403)
        self.assertEqual(self._patch(name='X').status_code, 403)
        self.assertEqual(self._delete().status_code, 403)

    def test_creator_can_edit_but_not_delete(self):
        self.as_user(self.marine_user)
        resp = self._create(name='Mine Co', notes='  first note  ')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['notes'], 'first note')
        mine = resp.data['id']
        url = f'{CLIENTS_URL}{mine}/'
        resp = self.api.patch(url, {
            'name': 'Mine Renamed', 'notes': 'updated', 'is_active': False,
            'categories': ['marine', 'medical'],
        }, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['name'], 'Mine Renamed')
        self.assertEqual(resp.data['notes'], 'updated')
        self.assertFalse(resp.data['is_active'])
        self.assertEqual(resp.data['categories'], ['marine', 'medical'])
        self.assertEqual(self.api.delete(url).status_code, 403)
        self.assertTrue(Client.objects.filter(pk=mine).exists())

    def test_creator_must_keep_an_accessible_category(self):
        self.as_user(self.marine_user)
        mine = self._create(name='Mine Co').data['id']
        url = f'{CLIENTS_URL}{mine}/'
        self.assertEqual(
            self.api.patch(url, {'categories': []}, format='json').status_code, 400,
        )
        self.assertEqual(
            self.api.patch(url, {'categories': ['motor']}, format='json').status_code, 403,
        )
        self.assertEqual(Client.objects.get(pk=mine).category_keys, ['marine'])

    def test_non_creator_cannot_edit(self):
        theirs = make_client('Theirs', created_by=self.marine_other)
        self.as_user(self.marine_user)
        resp = self.api.patch(f'{CLIENTS_URL}{theirs.pk}/', {'name': 'X'}, format='json')
        self.assertEqual(resp.status_code, 403)
        # A client with no creator is admin-only.
        self.assertEqual(self._patch(name='X').status_code, 403)
        self.assertEqual(Client.objects.get(pk=theirs.pk).name, 'Theirs')

    def test_hod_creator_cannot_edit(self):
        mine = make_client('Hod Owned', created_by=self.hod)
        self.as_user(self.hod)
        resp = self.api.patch(f'{CLIENTS_URL}{mine.pk}/', {'name': 'X'}, format='json')
        self.assertEqual(resp.status_code, 403)
        self.assertEqual(Client.objects.get(pk=mine.pk).name, 'Hod Owned')

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
            'id', 'name', 'username', 'categories', 'notes', 'is_active',
            'created_by', 'created_by_name', 'created_at', 'updated_at',
        })
        self.assertEqual(row['categories'], ['motor', 'marine'])
        self.assertEqual(row['username'], client.username)
        self.assertIsNone(row['created_by'])
        self.assertIsNone(row['created_by_name'])

    def test_created_by_name_survives_deactivation_and_clears_on_delete(self):
        creator = CustomUser.objects.create(
            email='temp@x.com', full_name='Tess Temp', role=self.marine_user.role,
        )
        client = make_client('Owned', created_by=creator)
        CustomUser.objects.filter(pk=creator.pk).update(is_active=False)
        row = self.api.get(f'{CLIENTS_URL}{client.pk}/').data
        self.assertEqual((row['created_by'], row['created_by_name']), (creator.pk, 'Tess Temp'))
        creator.delete()
        row = self.api.get(f'{CLIENTS_URL}{client.pk}/').data
        self.assertEqual((row['created_by'], row['created_by_name']), (None, None))

    def test_category_filter_uses_boolean_column(self):
        make_client('Flagged', categories=['marine'])
        Client.objects.create(name='Unflagged')
        self.assertEqual(self._names(self._list(category='marine')), ['Flagged'])

    def test_create_defaults_to_marine(self):
        resp = self.api.post(CLIENTS_URL, {'name': '  New Co  '}, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['name'], 'New Co')
        self.assertEqual(resp.data['categories'], ['marine'])
        self.assertNotIn('source', resp.data)
        self.assertEqual(resp.data['notes'], '')
        self.assertEqual(resp.data['created_by'], self.marine_user.pk)
        self.assertEqual(resp.data['created_by_name'], 'Mara Marine')
        client = Client.objects.get(pk=resp.data['id'])
        self.assertEqual(client.created_by, self.marine_user)
        self.assertTrue(client.is_marine)

    def test_notes_trimmed_and_length_limited(self):
        resp = self.api.post(
            CLIENTS_URL, {'name': 'Noted', 'notes': '  pays late  '}, format='json',
        )
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['notes'], 'pays late')
        resp = self.api.post(CLIENTS_URL, {'name': 'Blank', 'notes': '   '}, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['notes'], '')
        resp = self.api.post(CLIENTS_URL, {'name': 'Max', 'notes': 'n' * 1000}, format='json')
        self.assertEqual(resp.status_code, 201, resp.data)
        resp = self.api.post(CLIENTS_URL, {'name': 'Long', 'notes': 'n' * 1001}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertIn('notes', resp.data)

    def test_notes_edit_is_audited(self):
        client = make_client('Noted')
        self.as_user(self.staff)
        resp = self.api.patch(f'{CLIENTS_URL}{client.pk}/', {'notes': ' VIP '}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['notes'], 'VIP')
        log = AuditLog.objects.filter(category='clients', action='update').latest('timestamp')
        self.assertEqual(log.changes['notes'], {'old': '', 'new': 'VIP'})
        resp = self.api.patch(
            f'{CLIENTS_URL}{client.pk}/', {'notes': 'x' * 1001}, format='json',
        )
        self.assertEqual(resp.status_code, 400)

    def test_search_ignores_notes(self):
        make_client('Plain', notes='secretword')
        self.assertEqual(self._names(self._list(category='marine', search='secretword')), [])

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


# ─── Marine New enquiries: client required, display name, filter, export ────

class EnquiryClientTests(_Base):
    def _create(self, **body):
        payload = {'date': '2026-07-01', 'agent': self.marine_user.pk, **body}
        return self.api.post(MARINE_URL, payload, format='json')

    def test_client_required_on_create(self):
        resp = self._create()
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['client'], ['This field is required.'])
        self.assertFalse(MarineNewEntry.objects.exists())

    def test_text_only_create_rejected(self):
        make_client('Acme Shipping')
        resp = self._create(client_name='Acme Shipping')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.data['client'], ['This field is required.'])
        self.assertFalse(MarineNewEntry.objects.exists())
        self.assertEqual(Client.objects.count(), 1)  # no auto-created client

    def test_null_client_rejected(self):
        resp = self._create(client=None)
        self.assertEqual(resp.status_code, 400)
        self.assertIn('client', resp.data)

    def test_create_saves_blank_client_name(self):
        client = make_client('Acme Shipping')
        resp = self._create(client=client.pk, client_name='typed differently')
        self.assertEqual(resp.status_code, 201, resp.data)
        self.assertEqual(resp.data['client'], client.pk)
        self.assertEqual(resp.data['client_name'], '')
        self.assertEqual(resp.data['client_display'], 'Acme Shipping')
        self.assertEqual(resp.data['client_detail'], {
            'id': client.pk, 'name': 'Acme Shipping', 'username': client.username,
        })
        self.assertFalse(resp.data['can_link_client'])  # already linked
        entry = MarineNewEntry.objects.get(pk=resp.data['id'])
        self.assertEqual(entry.client_name, '')
        self.assertEqual(str(entry), 'Marine New Enquiry - Acme Shipping (new)')

    def test_wrong_category_rejected(self):
        motor = make_client('Motor Co', categories=['motor'])
        resp = self._create(client=motor.pk)
        self.assertEqual(resp.status_code, 400)
        self.assertIn('client', resp.data)

    def test_inactive_rejected_for_new_enquiry(self):
        gone = make_client('Gone', is_active=False)
        resp = self._create(client=gone.pk)
        self.assertEqual(resp.status_code, 400)
        self.assertIn('client', resp.data)

    def test_unknown_client_rejected(self):
        resp = self._create(client=999999)
        self.assertEqual(resp.status_code, 400)
        self.assertIn('client', resp.data)

    def test_edit_changes_client(self):
        first = make_client('First Co')
        second = make_client('Second Co')
        entry_id = self._create(client=first.pk).data['id']
        resp = self.api.patch(f'{MARINE_URL}{entry_id}/', {'client': second.pk}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['client_display'], 'Second Co')
        entry = MarineNewEntry.objects.get(pk=entry_id)
        self.assertEqual((entry.client_id, entry.client_name), (second.pk, ''))

    def test_edit_cannot_unlink(self):
        client = make_client('Linked Co')
        entry_id = self._create(client=client.pk).data['id']
        resp = self.api.patch(f'{MARINE_URL}{entry_id}/', {'client': None}, format='json')
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(MarineNewEntry.objects.get(pk=entry_id).client_id, client.pk)

    def test_client_name_is_read_only(self):
        client = make_client('Linked Co')
        entry_id = self._create(client=client.pk).data['id']
        resp = self.api.patch(f'{MARINE_URL}{entry_id}/', {'client_name': 'Typo'}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        entry = MarineNewEntry.objects.get(pk=entry_id)
        self.assertEqual((entry.client_id, entry.client_name), (client.pk, ''))

    def test_edit_keeps_inactive_client_already_linked(self):
        client = make_client('Was Live')
        entry_id = self._create(client=client.pk).data['id']
        Client.objects.filter(pk=client.pk).update(is_active=False)
        resp = self.api.patch(
            f'{MARINE_URL}{entry_id}/', {'client': client.pk, 'revisions': 0}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)

    def test_edit_keeps_client_that_lost_its_marine_tag(self):
        client = make_client('Retagged')
        entry_id = self._create(client=client.pk).data['id']
        Client.objects.filter(pk=client.pk).update(is_marine=False, is_motor=True)
        resp = self.api.patch(
            f'{MARINE_URL}{entry_id}/', {'client': client.pk, 'revisions': 0}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        # Switching another enquiry to it is still refused.
        other_id = self._create(client=make_client('Other').pk).data['id']
        resp = self.api.patch(f'{MARINE_URL}{other_id}/', {'client': client.pk}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_legacy_row_display_falls_back_to_typed_name(self):
        entry = self._entry(client_name='Legacy Text')
        resp = self.api.get(f'{MARINE_URL}{entry.pk}/')
        self.assertIsNone(resp.data['client'])
        self.assertIsNone(resp.data['client_detail'])
        self.assertEqual(resp.data['client_name'], 'Legacy Text')
        self.assertEqual(resp.data['client_display'], 'Legacy Text')
        self.assertEqual(str(entry), 'Marine New Enquiry - Legacy Text (new)')

    def test_display_prefers_linked_client(self):
        client = make_client('Saved Co')
        entry = self._entry(client_name='old text', client=client)
        resp = self.api.get(f'{MARINE_URL}{entry.pk}/')
        self.assertEqual(resp.data['client_display'], 'Saved Co')


class RenameAndDeleteTests(_Base):
    def test_rename_does_not_touch_enquiries(self):
        client = make_client('Old Name')
        linked = self._entry(client_name='', client=client)
        legacy = self._entry(client_name='Old Name')
        linked_before = MarineNewEntry.objects.filter(pk=linked.pk).values().get()
        legacy_before = MarineNewEntry.objects.filter(pk=legacy.pk).values().get()
        audit_before = AuditLog.objects.filter(category='marine_new').count()

        self.as_user(self.settings_user)
        resp = self.api.patch(f'{CLIENTS_URL}{client.pk}/', {'name': ' New Name '}, format='json')
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['name'], 'New Name')

        self.assertEqual(MarineNewEntry.objects.filter(pk=linked.pk).values().get(), linked_before)
        self.assertEqual(MarineNewEntry.objects.filter(pk=legacy.pk).values().get(), legacy_before)
        self.assertEqual(AuditLog.objects.filter(category='marine_new').count(), audit_before)
        # The linked row now reads the new name from its client.
        self.as_user(self.marine_user)
        self.assertEqual(
            self.api.get(f'{MARINE_URL}{linked.pk}/').data['client_display'], 'New Name',
        )
        client_log = AuditLog.objects.filter(category='clients', action='update').latest('timestamp')
        self.assertEqual(client_log.changes['name'], {'old': 'Old Name', 'new': 'New Name'})

    def test_update_tags_and_deactivate(self):
        client = make_client('Tagged', categories=['marine'])
        self.as_user(self.staff)
        resp = self.api.patch(
            f'{CLIENTS_URL}{client.pk}/',
            {'categories': ['motor', 'general'], 'is_active': False}, format='json',
        )
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['categories'], ['general', 'motor'])
        self.assertFalse(resp.data['is_active'])
        client.refresh_from_db()
        self.assertEqual(client.category_keys, ['general', 'motor'])
        resp = self.api.patch(f'{CLIENTS_URL}{client.pk}/', {'categories': []}, format='json')
        self.assertEqual(resp.status_code, 400)

    def test_delete_refused_while_linked(self):
        client = make_client('Linked')
        self._entry(client_name='', client=client)
        self.as_user(self.staff)
        resp = self.api.delete(f'{CLIENTS_URL}{client.pk}/')
        self.assertEqual(resp.status_code, 409)
        self.assertIn('detail', resp.data)
        self.assertTrue(Client.objects.filter(pk=client.pk).exists())

    def test_delete_racing_a_new_link_returns_409(self):
        client = make_client('Racing')
        self._entry(client_name='', client=client)
        self.as_user(self.staff)
        # The count runs before the link exists; the delete then hits PROTECT.
        with mock.patch('django.db.models.QuerySet.count', return_value=0):
            resp = self.api.delete(f'{CLIENTS_URL}{client.pk}/')
        self.assertEqual(resp.status_code, 409)
        self.assertIn('detail', resp.data)
        self.assertTrue(Client.objects.filter(pk=client.pk).exists())

    def test_delete_unlinked(self):
        client = make_client('Unlinked', categories=['marine', 'motor'])
        self.as_user(self.staff)
        self.assertEqual(self.api.delete(f'{CLIENTS_URL}{client.pk}/').status_code, 204)
        self.assertFalse(Client.objects.filter(pk=client.pk).exists())


class FilterAndExportTests(_Base):
    def test_client_filter(self):
        acme = make_client('Acme Shipping')
        blue = make_client('Blue Ocean')
        a = self._entry(client_name='', client=acme)
        b = self._entry(client_name='', client=blue)
        resp = self.api.get(MARINE_URL, {'client': acme.pk})
        self.assertEqual([row['id'] for row in resp.data['results']], [a.pk])
        resp = self.api.get(MARINE_URL, {'client': blue.pk, 'client_name': 'ocean'})
        self.assertEqual([row['id'] for row in resp.data['results']], [b.pk])

    def test_client_name_filter_matches_client_name_or_legacy_text(self):
        acme = make_client('Acme Shipping')
        linked = self._entry(client_name='', client=acme)
        legacy = self._entry(client_name='acme legacy')
        self._entry(client_name='Other Legacy')
        self._entry(client_name='', client=make_client('Blue Ocean'))

        resp = self.api.get(MARINE_URL, {'client_name': 'ACME'})
        self.assertEqual(
            sorted(row['id'] for row in resp.data['results']), sorted([linked.pk, legacy.pk]),
        )
        self.assertEqual(resp.data['count'], 2)  # no duplicate rows from the join
        resp = self.api.get(MARINE_URL, {'client_name': 'shipping'})
        self.assertEqual([row['id'] for row in resp.data['results']], [linked.pk])
        resp = self.api.get(MARINE_URL, {'client_name': 'legacy'})
        self.assertEqual(resp.data['count'], 2)

    def _export_names(self, **params):
        self.as_user(self.staff)
        resp = self.api.get(f'{MARINE_URL}export/', {'file_format': 'csv', **params})
        self.assertEqual(resp.status_code, 200)
        text = resp.content.decode('utf-8').lstrip('﻿')
        return sorted(row['Client Name'] for row in csv.DictReader(StringIO(text)))

    def test_export_client_name_uses_client_or_legacy_text(self):
        acme = make_client('Acme Shipping')
        self._entry(client_name='', client=acme)
        self._entry(client_name='Legacy Text')
        self.assertEqual(self._export_names(), ['Acme Shipping', 'Legacy Text'])

    def test_export_filtered_by_client_name(self):
        acme = make_client('Acme Shipping')
        self._entry(client_name='', client=acme)
        self._entry(client_name='Legacy Text')
        self.assertEqual(self._export_names(client_name='acme'), ['Acme Shipping'])


# ─── Link a legacy enquiry to a saved client ─────────────────────────────────

# Far-future cutoff so rows added "now" count as legacy in these tests,
# whatever the real date is.
@override_settings(MARINE_CLIENT_LINK_CUTOFF='2100-01-01')
class LinkClientTests(_Base):
    def setUp(self):
        super().setUp()
        self.acme = make_client('Acme Shipping')
        self.legacy = self._legacy()

    def _legacy(self, added_by=None, client=None):
        entry = self._entry(client_name='acme shpping (typo)', client=client, added_by=added_by)
        # Old row: well outside the 30-minute edit window.
        MarineNewEntry.objects.filter(pk=entry.pk).update(
            added_at=timezone.now() - timedelta(days=2),
        )
        entry.refresh_from_db()
        return entry

    def _link(self, entry=None, client=None):
        entry = entry or self.legacy
        body = {} if client is False else {'client': (client or self.acme).pk}
        return self.api.post(f'{MARINE_URL}{entry.pk}/link-client/', body, format='json')

    def test_creator_links_and_clears_typed_name(self):
        self.assertFalse(self.legacy.is_editable())  # 2 days old
        logs = AuditLog.objects.filter(
            category='marine_new', action='update', object_id=self.legacy.pk,
        )
        before = logs.count()
        resp = self._link()
        self.assertEqual(resp.status_code, 200, resp.data)
        self.assertEqual(resp.data['client'], self.acme.pk)
        self.assertEqual(resp.data['client_name'], '')
        self.assertEqual(resp.data['client_display'], 'Acme Shipping')
        self.assertFalse(resp.data['can_link_client'])
        self.legacy.refresh_from_db()
        self.assertEqual((self.legacy.client_id, self.legacy.client_name), (self.acme.pk, ''))

        self.assertEqual(logs.count() - before, 1)
        changes = logs.latest('timestamp').changes
        self.assertEqual(changes['client_name'], {'old': 'acme shpping (typo)', 'new': ''})
        self.assertIsNone(changes['client']['old'])
        self.assertIn('Acme Shipping', changes['client']['new'])

    def test_non_creator_forbidden(self):
        self.as_user(self.marine_all)
        self.assertEqual(self._link().status_code, 403)
        self.legacy.refresh_from_db()
        self.assertIsNone(self.legacy.client_id)

    def test_other_own_scope_user_cannot_see_row(self):
        self.as_user(self.marine_other)
        self.assertEqual(self._link().status_code, 404)

    def test_hod_forbidden(self):
        self.as_user(self.hod)
        self.assertEqual(self._link().status_code, 403)
        hod_row = self._legacy(added_by=self.hod)
        self.assertEqual(self._link(hod_row).status_code, 403)
        hod_row.refresh_from_db()
        self.assertIsNone(hod_row.client_id)

    def test_staff_non_creator_forbidden(self):
        self.as_user(self.staff)
        self.assertEqual(self._link().status_code, 403)
        self.legacy.refresh_from_db()
        self.assertIsNone(self.legacy.client_id)

    def test_staff_creator_allowed(self):
        own = self._legacy(added_by=self.staff)
        self.as_user(self.staff)
        self.assertEqual(self._link(own).status_code, 200)

    def test_after_cutoff_rejected(self):
        with override_settings(MARINE_CLIENT_LINK_CUTOFF='2000-01-01'):
            resp = self._link()
        self.assertEqual(resp.status_code, 400)
        self.assertIn('detail', resp.data)
        self.legacy.refresh_from_db()
        self.assertIsNone(self.legacy.client_id)

    def test_malformed_cutoff_falls_back_to_default(self):
        with override_settings(MARINE_CLIENT_LINK_CUTOFF='01/11/2026', TIME_ZONE='Asia/Dubai'):
            self.assertEqual(
                marine_client_link_cutoff(),
                datetime(2026, 10, 31, 20, 0, tzinfo=dt_timezone.utc),
            )

    def test_cutoff_is_midnight_dubai(self):
        with override_settings(MARINE_CLIENT_LINK_CUTOFF='2026-11-01', TIME_ZONE='Asia/Dubai'):
            cutoff = marine_client_link_cutoff()
            self.assertEqual(cutoff, datetime(2026, 10, 31, 20, 0, tzinfo=dt_timezone.utc))
            MarineNewEntry.objects.filter(pk=self.legacy.pk).update(added_at=cutoff)
            self.assertEqual(self._link().status_code, 400)
            MarineNewEntry.objects.filter(pk=self.legacy.pk).update(
                added_at=cutoff - timedelta(seconds=1),
            )
            self.assertEqual(self._link().status_code, 200)

    def test_already_linked_409(self):
        self.assertEqual(self._link().status_code, 200)
        resp = self._link(client=make_client('Other Co'))
        self.assertEqual(resp.status_code, 409)
        self.assertEqual(resp.data['detail'], 'This enquiry is already linked to a client.')
        self.legacy.refresh_from_db()
        self.assertEqual(self.legacy.client_id, self.acme.pk)

    def test_row_created_linked_is_409(self):
        row = self._legacy(client=self.acme)
        self.assertEqual(self._link(row).status_code, 409)

    def test_double_link_race_second_gets_409(self):
        # The second request loaded the row before the first one saved; the
        # locked re-read inside the transaction sees the link and refuses.
        stale = MarineNewEntry.objects.get(pk=self.legacy.pk)
        self.assertEqual(self._link().status_code, 200)
        with mock.patch(
            'entries.views.MarineNewEntryViewSet.get_object', return_value=stale,
        ):
            resp = self._link(client=make_client('Other Co'))
        self.assertEqual(resp.status_code, 409)
        self.legacy.refresh_from_db()
        self.assertEqual(self.legacy.client_id, self.acme.pk)

    def test_voided_rejected(self):
        MarineNewEntry.objects.filter(pk=self.legacy.pk).update(is_voided=True)
        self.assertEqual(self._link().status_code, 403)
        self.legacy.refresh_from_db()
        self.assertIsNone(self.legacy.client_id)

    def test_inactive_client_rejected(self):
        resp = self._link(client=make_client('Gone', is_active=False))
        self.assertEqual(resp.status_code, 400)
        self.assertIn('client', resp.data)
        self.legacy.refresh_from_db()
        self.assertEqual(
            (self.legacy.client_id, self.legacy.client_name), (None, 'acme shpping (typo)'),
        )

    def test_non_marine_client_rejected(self):
        resp = self._link(client=make_client('Motor Co', categories=['motor']))
        self.assertEqual(resp.status_code, 400)
        self.assertIn('client', resp.data)
        self.legacy.refresh_from_db()
        self.assertIsNone(self.legacy.client_id)

    def test_missing_or_unknown_client_rejected(self):
        self.assertEqual(self._link(client=False).status_code, 400)
        resp = self.api.post(
            f'{MARINE_URL}{self.legacy.pk}/link-client/', {'client': 999999}, format='json',
        )
        self.assertEqual(resp.status_code, 400)
        self.assertIn('client', resp.data)


@override_settings(MARINE_CLIENT_LINK_CUTOFF='2100-01-01')
class CanLinkClientTests(_Base):
    def _flag(self, entry):
        return self.api.get(f'{MARINE_URL}{entry.pk}/').data['can_link_client']

    def test_true_for_creator_of_unlinked_legacy_row(self):
        entry = self._entry(client_name='Legacy')
        self.assertTrue(self._flag(entry))
        row = self.api.get(MARINE_URL).data['results'][0]  # list payload too
        self.assertTrue(row['can_link_client'])

    def test_false_when_linked(self):
        entry = self._entry(client_name='', client=make_client('Saved'))
        self.assertFalse(self._flag(entry))

    def test_false_for_non_creator_staff_and_hod(self):
        entry = self._entry(client_name='Legacy')
        for user in (self.marine_all, self.staff, self.hod):
            self.as_user(user)
            self.assertFalse(self._flag(entry), user.email)

    def test_false_when_voided(self):
        entry = self._entry(client_name='Legacy')
        MarineNewEntry.objects.filter(pk=entry.pk).update(is_voided=True)
        self.assertFalse(self._flag(entry))

    def test_false_after_cutoff(self):
        entry = self._entry(client_name='Legacy')
        with override_settings(MARINE_CLIENT_LINK_CUTOFF='2000-01-01'):
            self.assertFalse(self._flag(entry))

# ─── Pagination ──────────────────────────────────────────────────────────────

class PaginationTests(_Base):
    def _bulk(self, count, prefix='Client', categories=('marine',)):
        Client.objects.bulk_create([
            Client(
                name=f'{prefix} {i:03d}', username=f'{prefix.lower()}_{i:03d}_ab12',
                **category_flags(categories),
            )
            for i in range(count)
        ])
        return list(Client.objects.filter(name__startswith=f'{prefix} '))

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
