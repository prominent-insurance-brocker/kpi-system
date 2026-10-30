"""Marine New enquiries export (CSV / .xlsx).

- One row per enquiry matching the list endpoint's filters, no pagination.
- Every column is asserted for both formats (golden rows), timestamps in the
  business timezone (Asia/Dubai).
- Restricted to admin / HOD / 'all' roles; 'own' roles and users without the
  module get 403.
- Free-text values cannot become spreadsheet formulas.
"""
import csv
from datetime import date, datetime
from datetime import timezone as dt_timezone
from decimal import Decimal
from io import BytesIO, StringIO

from django.test import TestCase
from openpyxl import load_workbook
from rest_framework.test import APIClient

from auth_app.models import CustomUser
from roles.models import Role, RoleModulePermission

from .enquiry_export import MARINE_NEW_COLUMNS
from .models import Client, InsuranceCompany, MarineClassOfInsurance, MarineNewEntry

URL = '/api/entries/marine-new/export/'

EXPECTED_HEADERS = [
    'ID', 'Client Name', 'Client Username', 'Status', 'Insurer Ref.', 'Potential Premium',
    'Converted Premium', 'Revisions', 'No. of Quotes Compared', 'TAT (minutes)',
    'Accuracy (%)', 'Added by', 'Agent Name', 'Class of Insurance',
    'Compared Insurers', 'Converted Insurer', 'Policy/Certificate No.',
    'Added on', 'Date', 'Shared With Client At', 'Closed At', 'Last Updated',
    'Voided', 'Voided At', 'Voided By', 'Void Reason',
]


def utc(y, mo, d, h, mi):
    return datetime(y, mo, d, h, mi, tzinfo=dt_timezone.utc)


def parse_csv(resp):
    text = resp.content.decode('utf-8')
    assert text.startswith('﻿'), 'CSV must start with a UTF-8 BOM'
    return list(csv.DictReader(StringIO(text[1:])))


def parse_xlsx(resp):
    ws = load_workbook(BytesIO(resp.content)).active
    rows = list(ws.iter_rows(values_only=True))
    headers = list(rows[0])
    return headers, [dict(zip(headers, row)) for row in rows[1:]], ws


class _Base(TestCase):
    @classmethod
    def setUpTestData(cls):
        cls.own_role = Role.objects.create(name='Marine Own', data_visibility='own')
        RoleModulePermission.objects.create(role=cls.own_role, module='marine_new')
        cls.all_role = Role.objects.create(name='Marine All', data_visibility='all')
        RoleModulePermission.objects.create(role=cls.all_role, module='marine_new')
        cls.hod_role = Role.objects.create(name='Marine HOD', data_visibility='all', is_hod=True)
        RoleModulePermission.objects.create(role=cls.hod_role, module='marine_new')
        cls.no_module_role = Role.objects.create(name='Motor Only', data_visibility='all')
        RoleModulePermission.objects.create(role=cls.no_module_role, module='motor_new')

        cls.creator = CustomUser.objects.create(
            email='creator@x.com', full_name='Cara Creator', role=cls.own_role,
        )
        cls.agent = CustomUser.objects.create(
            email='agent@x.com', full_name='Andy Agent', role=cls.own_role,
        )
        cls.admin = CustomUser.objects.create(
            email='admin@x.com', full_name='Ada Admin', is_staff=True,
        )
        cls.hod = CustomUser.objects.create(
            email='hod@x.com', full_name='Hank Hod', role=cls.hod_role,
        )
        cls.viewer = CustomUser.objects.create(
            email='viewer@x.com', full_name='Vera Viewer', role=cls.all_role,
        )
        cls.motor_user = CustomUser.objects.create(
            email='motor@x.com', full_name='Moe Motor', role=cls.no_module_role,
        )

        cls.acme = InsuranceCompany.objects.create(name='Acme Marine')
        cls.blue = InsuranceCompany.objects.create(name='BlueShield Marine')
        cls.zeta = InsuranceCompany.objects.create(name='Zeta Removed')
        cls.cargo = MarineClassOfInsurance.objects.create(name='Cargo')

    def setUp(self):
        self.client = APIClient()
        self.client.force_authenticate(self.admin)

    def _marine(self, client_name='C', status=MarineNewEntry.STATUS_NEW,
                compared=None, entry_date=date(2026, 7, 1), **kwargs):
        entry = MarineNewEntry.objects.create(
            client_name=client_name, agent=self.agent, added_by=self.creator,
            status=status, date=entry_date, potential_premium='5000.00',
            **kwargs,
        )
        entry.compared_insurance_companies.set(
            [self.blue, self.acme] if compared is None else compared
        )
        return entry

    def _pin(self, entry, **fields):
        # .update() bypasses auto_now / the stored-quality recompute so every
        # timestamp and stored value is deterministic.
        MarineNewEntry.objects.filter(pk=entry.pk).update(**fields)
        entry.refresh_from_db()
        return entry


class HeaderTests(_Base):
    def test_column_spec_matches_expected_headers(self):
        self.assertEqual([h for h, _, _ in MARINE_NEW_COLUMNS], EXPECTED_HEADERS)

    def test_csv_headers_and_content_type(self):
        resp = self.client.get(URL)
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(resp['Content-Type'], 'text/csv; charset=utf-8')
        self.assertRegex(
            resp['Content-Disposition'],
            r'^attachment; filename="marine_new_enquiries_\d{4}-\d{2}-\d{2}\.csv"$',
        )
        text = resp.content.decode('utf-8')
        self.assertTrue(text.startswith('﻿'))
        header = next(csv.reader(StringIO(text[1:])))
        self.assertEqual(header, EXPECTED_HEADERS)

    def test_xlsx_headers_and_content_type(self):
        resp = self.client.get(URL, {'file_format': 'xlsx'})
        self.assertEqual(resp.status_code, 200, resp.content)
        self.assertEqual(
            resp['Content-Type'],
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        )
        self.assertRegex(
            resp['Content-Disposition'],
            r'^attachment; filename="marine_new_enquiries_\d{4}-\d{2}-\d{2}\.xlsx"$',
        )
        headers, rows, ws = parse_xlsx(resp)
        self.assertEqual(headers, EXPECTED_HEADERS)
        self.assertEqual(rows, [])
        self.assertEqual(ws.title, 'Marine New Enquiries')
        self.assertEqual(ws.freeze_panes, 'A2')
        self.assertTrue(ws['A1'].font.bold)

    def test_unknown_file_format_is_400(self):
        resp = self.client.get(URL, {'file_format': 'pdf'})
        self.assertEqual(resp.status_code, 400)
        self.assertEqual(resp.json(), {'detail': 'file_format must be csv or xlsx'})

    def test_file_format_is_case_insensitive(self):
        resp = self.client.get(URL, {'file_format': 'XLSX'})
        self.assertEqual(resp.status_code, 200)
        self.assertTrue(resp['Content-Disposition'].endswith('.xlsx"'))


class GoldenRowTests(_Base):
    """Every column, every status, both formats."""

    @classmethod
    def setUpTestData(cls):
        super().setUpTestData()

    def setUp(self):
        super().setUp()
        # Won: fully populated. added_at 20:30 UTC -> 00:30 next day in Dubai.
        self.won = self._marine(
            client_name='Won Co', status=MarineNewEntry.STATUS_CONVERTED,
            entry_date=date(2026, 7, 5),
            class_of_insurance=self.cargo, converted_insurer=self.acme,
            converted_premium='4500.00', policy_number='POL-123',
            revisions=2, quotes_compared=3,
            # zeta key is stale (not compared) and must be dropped.
            insurer_references={
                str(self.blue.id): 'B-2', str(self.acme.id): 'A-1', '999999': 'GONE',
            },
        )
        self._pin(
            self.won,
            added_at=utc(2026, 7, 4, 20, 30),
            shared_with_client_at=utc(2026, 7, 5, 6, 0),
            status_changed_at=utc(2026, 7, 6, 8, 15),
            updated_at=utc(2026, 7, 6, 8, 16),
            tat_minutes=Decimal('570.00'), accuracy=Decimal('81.00'),
        )
        self.shared = self._marine(
            client_name='Shared Co', status=MarineNewEntry.STATUS_SHARED_WITH_CLIENT,
            entry_date=date(2026, 7, 4),
        )
        self._pin(
            self.shared,
            added_at=utc(2026, 7, 3, 8, 0), shared_with_client_at=utc(2026, 7, 3, 9, 0),
            updated_at=utc(2026, 7, 3, 9, 0),
            tat_minutes=Decimal('60.00'), accuracy=None,
        )
        self.new = self._marine(
            client_name='New Co', entry_date=date(2026, 7, 3), compared=[],
        )
        self._pin(
            self.new, added_at=utc(2026, 7, 2, 8, 0), updated_at=utc(2026, 7, 2, 8, 0),
            tat_minutes=None, accuracy=None,
        )
        self.lost = self._marine(
            client_name='Lost Co', status=MarineNewEntry.STATUS_LOST,
            entry_date=date(2026, 7, 2), converted_premium='0.00',
        )
        self._pin(
            self.lost, added_at=utc(2026, 7, 1, 8, 0),
            status_changed_at=utc(2026, 7, 1, 10, 0), updated_at=utc(2026, 7, 1, 10, 0),
            tat_minutes=Decimal('120.00'), accuracy=Decimal('100.00'),
        )
        self.rejected = self._marine(
            client_name='Rejected Co', status=MarineNewEntry.STATUS_REJECTED,
            entry_date=date(2026, 7, 1), converted_premium='0.00',
        )
        self._pin(
            self.rejected, added_at=utc(2026, 6, 30, 8, 0),
            status_changed_at=utc(2026, 6, 30, 9, 0), updated_at=utc(2026, 6, 30, 9, 0),
            tat_minutes=Decimal('60.00'), accuracy=Decimal('100.00'),
        )
        # Legacy Won row: no policy number, no converted insurer.
        self.legacy = self._marine(
            client_name='Legacy Co', status=MarineNewEntry.STATUS_CONVERTED,
            entry_date=date(2026, 6, 30), converted_premium='0.00',
        )
        self._pin(self.legacy, added_at=utc(2026, 6, 29, 8, 0), updated_at=utc(2026, 6, 29, 8, 0))
        # Voided row.
        self.voided = self._marine(client_name='Void Co', entry_date=date(2026, 6, 29))
        self._pin(
            self.voided, added_at=utc(2026, 6, 28, 8, 0), updated_at=utc(2026, 6, 28, 8, 0),
            is_voided=True, voided_at=utc(2026, 6, 28, 12, 45), voided_by=self.admin,
            void_reason='Duplicate enquiry',
        )

    def _by_client(self, rows):
        return {row['Client Name']: row for row in rows}

    def test_csv_every_column(self):
        rows = parse_csv(self.client.get(URL))
        self.assertEqual(len(rows), 7)
        # Default ordering: -date, -added_at.
        self.assertEqual(
            [r['Client Name'] for r in rows],
            ['Won Co', 'Shared Co', 'New Co', 'Lost Co', 'Rejected Co', 'Legacy Co', 'Void Co'],
        )
        by = self._by_client(rows)

        self.assertEqual(by['Won Co'], {
            'ID': self.won.pib_id,
            'Client Name': 'Won Co',
            'Client Username': '',
            'Status': 'Won',
            'Insurer Ref.': 'Acme Marine: A-1; BlueShield Marine: B-2',
            'Potential Premium': '5000.00',
            'Converted Premium': '4500.00',
            'Revisions': '2',
            'No. of Quotes Compared': '3',
            'TAT (minutes)': '570.00',
            'Accuracy (%)': '81.00',
            'Added by': 'Cara Creator',
            'Agent Name': 'Andy Agent',
            'Class of Insurance': 'Cargo',
            'Compared Insurers': 'Acme Marine; BlueShield Marine',
            'Converted Insurer': 'Acme Marine',
            'Policy/Certificate No.': 'POL-123',
            'Added on': '2026-07-05 00:30',
            'Date': '2026-07-05',
            'Shared With Client At': '2026-07-05 10:00',
            'Closed At': '2026-07-06 12:15',
            'Last Updated': '2026-07-06 12:16',
            'Voided': 'No',
            'Voided At': '',
            'Voided By': '',
            'Void Reason': '',
        })
        self.assertTrue(self.won.pib_id.startswith('PIB-'))

        shared = by['Shared Co']
        self.assertEqual(shared['Status'], 'Shared With Client')
        self.assertEqual(shared['Insurer Ref.'], '')
        self.assertEqual(shared['Converted Premium'], '')
        self.assertEqual(shared['TAT (minutes)'], '60.00')
        self.assertEqual(shared['Accuracy (%)'], '')
        self.assertEqual(shared['Shared With Client At'], '2026-07-03 13:00')
        self.assertEqual(shared['Closed At'], '')
        self.assertEqual(shared['Class of Insurance'], '')
        self.assertEqual(shared['Converted Insurer'], '')

        new = by['New Co']
        self.assertEqual(new['Status'], 'New Enquiry')
        self.assertEqual(new['Compared Insurers'], '')
        self.assertEqual(new['TAT (minutes)'], '')
        self.assertEqual(new['Revisions'], '0')
        self.assertEqual(new['No. of Quotes Compared'], '0')

        self.assertEqual(by['Lost Co']['Status'], 'Lost')
        self.assertEqual(by['Lost Co']['Converted Premium'], '0.00')
        self.assertEqual(by['Lost Co']['Closed At'], '2026-07-01 14:00')
        self.assertEqual(by['Rejected Co']['Status'], 'Rejected')
        self.assertEqual(by['Rejected Co']['Converted Premium'], '0.00')

        self.assertEqual(by['Legacy Co']['Status'], 'Won')
        self.assertEqual(by['Legacy Co']['Policy/Certificate No.'], '')
        self.assertEqual(by['Legacy Co']['Converted Insurer'], '')

        void = by['Void Co']
        self.assertEqual(void['Voided'], 'Yes')
        self.assertEqual(void['Voided At'], '2026-06-28 16:45')
        self.assertEqual(void['Voided By'], 'Ada Admin')
        self.assertEqual(void['Void Reason'], 'Duplicate enquiry')
        self.assertEqual(void['Status'], 'New Enquiry')

    def test_linked_row_exports_client_name_and_username(self):
        client = Client.objects.create(name='Linked Shipping', is_marine=True)
        MarineNewEntry.objects.filter(pk=self.won.pk).update(client=client, client_name='')
        rows = parse_csv(self.client.get(URL))
        linked = next(r for r in rows if r['ID'] == self.won.pib_id)
        self.assertEqual(linked['Client Name'], 'Linked Shipping')
        # CSV escapes the leading '@' (Excel would read it as a formula).
        self.assertEqual(linked['Client Username'], "'" + client.username)
        self.assertTrue(client.username.startswith('@linked_shipping_'))
        # Unlinked legacy rows keep their typed name and no username.
        self.assertEqual(self._by_client(rows)['Shared Co']['Client Username'], '')
        # XLSX keeps the exact @username as a text cell.
        _, xrows, _ = parse_xlsx(self.client.get(URL, {'file_format': 'xlsx'}))
        xl = next(r for r in xrows if r['ID'] == self.won.pib_id)
        self.assertEqual(xl['Client Username'], client.username)

    def test_xlsx_every_column_typed(self):
        headers, rows, ws = parse_xlsx(self.client.get(URL, {'file_format': 'xlsx'}))
        self.assertEqual(len(rows), 7)
        by = self._by_client(rows)

        self.assertEqual(by['Won Co'], {
            'ID': self.won.pib_id,
            'Client Name': 'Won Co',
            'Client Username': None,
            'Status': 'Won',
            'Insurer Ref.': 'Acme Marine: A-1; BlueShield Marine: B-2',
            'Potential Premium': 5000,
            'Converted Premium': 4500,
            'Revisions': 2,
            'No. of Quotes Compared': 3,
            'TAT (minutes)': 570,
            'Accuracy (%)': 81,
            'Added by': 'Cara Creator',
            'Agent Name': 'Andy Agent',
            'Class of Insurance': 'Cargo',
            'Compared Insurers': 'Acme Marine; BlueShield Marine',
            'Converted Insurer': 'Acme Marine',
            'Policy/Certificate No.': 'POL-123',
            'Added on': datetime(2026, 7, 5, 0, 30),
            'Date': datetime(2026, 7, 5),
            'Shared With Client At': datetime(2026, 7, 5, 10, 0),
            'Closed At': datetime(2026, 7, 6, 12, 15),
            'Last Updated': datetime(2026, 7, 6, 12, 16),
            'Voided': 'No',
            'Voided At': None,
            'Voided By': None,
            'Void Reason': None,
        })

        # Typed cells + number formats on the Won row (row 2: first data row).
        col = {h: i + 1 for i, h in enumerate(headers)}
        self.assertEqual(ws.cell(2, col['Potential Premium']).data_type, 'n')
        self.assertEqual(ws.cell(2, col['Potential Premium']).number_format, '#,##0.00')
        self.assertEqual(ws.cell(2, col['Revisions']).data_type, 'n')
        self.assertEqual(ws.cell(2, col['Added on']).number_format, 'yyyy-mm-dd hh:mm')
        self.assertEqual(ws.cell(2, col['Date']).number_format, 'yyyy-mm-dd')
        self.assertEqual(ws.auto_filter.ref, f'A1:Z{len(rows) + 1}')

        self.assertEqual(by['Shared Co']['Converted Premium'], None)
        self.assertEqual(by['Shared Co']['Accuracy (%)'], None)
        self.assertEqual(by['Lost Co']['Converted Premium'], 0)
        self.assertEqual(by['Legacy Co']['Policy/Certificate No.'], None)
        self.assertEqual(by['Void Co']['Voided'], 'Yes')
        self.assertEqual(by['Void Co']['Voided At'], datetime(2026, 6, 28, 16, 45))
        self.assertEqual(by['Void Co']['Voided By'], 'Ada Admin')
        self.assertEqual(by['Void Co']['Void Reason'], 'Duplicate enquiry')


class RowSelectionTests(_Base):
    def test_not_paginated(self):
        for i in range(25):
            self._marine(client_name=f'Client {i}')
        self.assertEqual(len(parse_csv(self.client.get(URL))), 25)
        _, rows, _ = parse_xlsx(self.client.get(URL, {'file_format': 'xlsx'}))
        self.assertEqual(len(rows), 25)

    def test_status_filter(self):
        self._marine(client_name='Open')
        self._marine(client_name='Won', status=MarineNewEntry.STATUS_CONVERTED)
        rows = parse_csv(self.client.get(URL, {'status': 'converted'}))
        self.assertEqual([r['Client Name'] for r in rows], ['Won'])

    def test_date_range_filter(self):
        self._marine(client_name='June', entry_date=date(2026, 6, 15))
        self._marine(client_name='July', entry_date=date(2026, 7, 15))
        rows = parse_csv(self.client.get(URL, {'date_from': '2026-07-01', 'date_to': '2026-07-31'}))
        self.assertEqual([r['Client Name'] for r in rows], ['July'])

    def test_voided_filter(self):
        self._marine(client_name='Live')
        v = self._marine(client_name='Gone')
        self._pin(v, is_voided=True, void_reason='x')
        rows = parse_csv(self.client.get(URL, {'is_voided': 'true'}))
        self.assertEqual([r['Client Name'] for r in rows], ['Gone'])

    def test_client_name_insurer_and_class_filters(self):
        a = self._marine(client_name='Alpha Shipping', compared=[self.acme], class_of_insurance=self.cargo)
        self._marine(client_name='Beta Freight', compared=[self.blue])
        self.assertEqual(
            [r['Client Name'] for r in parse_csv(self.client.get(URL, {'client_name': 'alpha'}))],
            [a.client_name],
        )
        self.assertEqual(
            [r['Client Name'] for r in parse_csv(self.client.get(URL, {'insurance_company': self.acme.id}))],
            [a.client_name],
        )
        self.assertEqual(
            [r['Client Name'] for r in parse_csv(self.client.get(URL, {'class_of_insurance': self.cargo.id}))],
            [a.client_name],
        )

    def test_agent_and_user_filters(self):
        mine = self._marine(client_name='Mine')
        other = MarineNewEntry.objects.create(
            client_name='Theirs', agent=self.viewer, added_by=self.viewer,
            date=date(2026, 7, 1),
        )
        self.assertEqual(
            [r['Client Name'] for r in parse_csv(self.client.get(URL, {'agent_id': self.viewer.id}))],
            [other.client_name],
        )
        self.assertEqual(
            [r['Client Name'] for r in parse_csv(self.client.get(URL, {'user_id': self.creator.id}))],
            [mine.client_name],
        )


class FormulaInjectionTests(_Base):
    def test_csv_neutralises_formula_prefixes(self):
        for name in ('=HYPERLINK("http://evil","x")', '+1+1', '-2', '@SUM(A1)'):
            self._marine(client_name=name)
        names = sorted(r['Client Name'] for r in parse_csv(self.client.get(URL)))
        self.assertEqual(
            names,
            sorted(["'=HYPERLINK(\"http://evil\",\"x\")", "'+1+1", "'-2", "'@SUM(A1)"]),
        )

    def test_xlsx_keeps_formula_text_literal(self):
        self._marine(client_name='=HYPERLINK("http://evil","x")')
        headers, rows, ws = parse_xlsx(self.client.get(URL, {'file_format': 'xlsx'}))
        cell = ws.cell(2, headers.index('Client Name') + 1)
        self.assertEqual(cell.data_type, 's')
        self.assertEqual(cell.value, '=HYPERLINK("http://evil","x")')


class ControlCharacterTests(_Base):
    def test_xlsx_strips_xml_illegal_characters(self):
        entry = self._marine(client_name='AcmeTrading')
        self._pin(entry, void_reason='Duplicate', is_voided=True)
        resp = self.client.get(URL, {'file_format': 'xlsx'})
        self.assertEqual(resp.status_code, 200)
        _, rows, _ = parse_xlsx(resp)
        self.assertEqual(rows[0]['Client Name'], 'AcmeTrading')
        self.assertEqual(rows[0]['Void Reason'], 'Duplicate')

    def test_csv_keeps_text_unchanged(self):
        self._marine(client_name='AcmeTrading')
        self.assertEqual(parse_csv(self.client.get(URL))[0]['Client Name'], 'AcmeTrading')


class AccessTests(_Base):
    def setUp(self):
        self.client = APIClient()
        self._marine(client_name='Row')

    def test_staff_hod_and_all_role_allowed(self):
        for user in (self.admin, self.hod, self.viewer):
            self.client.force_authenticate(user)
            for fmt in ('csv', 'xlsx'):
                resp = self.client.get(URL, {'file_format': fmt})
                self.assertEqual(resp.status_code, 200, (user.email, fmt, resp.content[:200]))

    def test_own_role_forbidden(self):
        self.client.force_authenticate(self.creator)
        resp = self.client.get(URL)
        self.assertEqual(resp.status_code, 403)

    def test_user_without_module_forbidden(self):
        self.client.force_authenticate(self.motor_user)
        self.assertEqual(self.client.get(URL).status_code, 403)

    def test_unauthenticated(self):
        self.assertEqual(self.client.get(URL).status_code, 401)
