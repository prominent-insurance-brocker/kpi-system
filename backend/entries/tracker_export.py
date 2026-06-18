"""Tracker export endpoint (TED-554).

Generates an .xlsx workbook that mirrors the Team Daily Tracker grid for a
single module: rows = team members, columns = calendar days, each cell the
number of entries that member *created* (bucketed by ``added_at``) on that day,
colored to match the on-screen tracker. Unlike the live grid (which hides the 0
on today/weekends for a clean glance), the export writes the count for *every day
that has occurred* — 0 included — so a downloaded report never has empty cells in
the past (otherwise a 0 on the last day looks like a blank):

    count > 0            -> green   (DCFCE7 / text 15803D), value = count
    past weekday, 0      -> red     (FEE2E2 / text B91C1C), value 0
    today, 0             -> blue    (EEF2FF), value 0
    weekend, 0           -> gray    (F3F4F6), value 0
    future               -> blank   (future weekends shaded gray)

Day-bucketing + member resolution live in ``tracker_common`` and are shared with
the JSON counts endpoint (``tracker_counts.py``) so the export and the live
calendar can never disagree. Days bucket in the supplied ``tz`` (default
Asia/Dubai); the frontend sends the business timezone.
"""
from __future__ import annotations

from datetime import timedelta
from io import BytesIO

from django.http import HttpResponse
from django.utils import timezone
from openpyxl import Workbook
from openpyxl.styles import Alignment, Border, Font, PatternFill, Side
from openpyxl.utils import get_column_letter
from rest_framework.permissions import IsAuthenticated
from rest_framework.views import APIView

from .tracker_common import (
    MODULE_LABELS,
    entry_counts,
    members,
    parse_tracker_request,
)

# Tracker palette (see KpiModulePage.tsx TrackerView).
FILL_GREEN = PatternFill('solid', fgColor='DCFCE7')
FILL_RED = PatternFill('solid', fgColor='FEE2E2')
FILL_BLUE = PatternFill('solid', fgColor='EEF2FF')
FILL_GRAY = PatternFill('solid', fgColor='F3F4F6')
FILL_HEADER = PatternFill('solid', fgColor='F9F9F9')
FONT_GREEN = Font(color='15803D', bold=True)
FONT_RED = Font(color='B91C1C', bold=True)
FONT_BOLD = Font(bold=True)
BORDER = Border(*([Side(style='thin', color='E4E4E4')] * 4))
CENTER = Alignment(horizontal='center', vertical='center')

# date.weekday(): Monday=0 .. Sunday=6.
SHORT_DAY = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']


class TrackerExportView(APIView):
    """GET /api/entries/tracker-export/

    Query params:
        module    (required) module key, e.g. ``sales_kpi``
        start     (required) range start, YYYY-MM-DD (local date)
        end       (required) range end, YYYY-MM-DD (local date, inclusive)
        user_ids  (optional) comma-separated member ids; omit for "all members"
        tz        (optional) IANA timezone for day-bucketing, e.g. ``Asia/Dubai``
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        model, module, start, end, tz, user_ids, can_see_all = parse_tracker_request(
            request
        )
        today_local = timezone.now().astimezone(tz).date()

        counts = entry_counts(model, start, end, tz, user_ids, can_see_all, request.user)
        member_rows = members(module, user_ids, can_see_all, request.user)

        wb = self._build_workbook(module, member_rows, start, end, today_local, counts)
        buf = BytesIO()
        wb.save(buf)

        filename = f'tracker_{module}_{start.isoformat()}_{end.isoformat()}.xlsx'
        response = HttpResponse(
            buf.getvalue(),
            content_type=(
                'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
            ),
        )
        response['Content-Disposition'] = f'attachment; filename="{filename}"'
        return response

    # ---- helpers ---------------------------------------------------------

    @staticmethod
    def _build_workbook(module, members, start, end, today_local, counts):
        days = []
        cursor = start
        while cursor <= end:
            days.append(cursor)
            cursor += timedelta(days=1)

        wb = Workbook()
        ws = wb.active
        ws.title = (MODULE_LABELS.get(module, module) or 'Tracker')[:31]

        # Header row: Member | <day columns> | Total
        head = ws.cell(row=1, column=1, value='Member')
        head.font = FONT_BOLD
        head.fill = FILL_HEADER
        head.border = BORDER
        for i, day in enumerate(days):
            c = ws.cell(row=1, column=2 + i, value=f'{SHORT_DAY[day.weekday()]} {day.day}')
            c.font = FONT_BOLD
            c.fill = FILL_HEADER
            c.alignment = CENTER
            c.border = BORDER
        total_col = 2 + len(days)
        tc = ws.cell(row=1, column=total_col, value='Total')
        tc.font = FONT_BOLD
        tc.fill = FILL_HEADER
        tc.alignment = CENTER
        tc.border = BORDER

        # Body rows.
        for r, member in enumerate(members, start=2):
            name_cell = ws.cell(
                row=r, column=1, value=member.get_full_name() or member.email
            )
            name_cell.border = BORDER
            row_total = 0
            for i, day in enumerate(days):
                count = counts.get((member.id, day), 0)
                cell = ws.cell(row=r, column=2 + i)
                cell.alignment = CENTER
                cell.border = BORDER
                is_weekend = day.weekday() >= 5
                if day > today_local:
                    # Future days have no value; keep weekends shaded for consistency.
                    if is_weekend:
                        cell.fill = FILL_GRAY
                    continue
                # The day has occurred (past or today) -> always write the count,
                # 0 included. The live grid hides 0 on today/weekends for a clean
                # glance, but a downloaded report should show every occurred day
                # (otherwise a 0 on the last day looks like an empty cell).
                cell.value = count
                if count > 0:
                    cell.fill = FILL_GREEN
                    cell.font = FONT_GREEN
                    row_total += count
                elif day == today_local:
                    cell.fill = FILL_BLUE
                elif is_weekend:
                    cell.fill = FILL_GRAY
                else:
                    cell.fill = FILL_RED
                    cell.font = FONT_RED
            total_cell = ws.cell(row=r, column=total_col, value=row_total)
            total_cell.alignment = CENTER
            total_cell.border = BORDER
            total_cell.font = FONT_BOLD

        # Column widths + freeze the member column and header row.
        ws.column_dimensions['A'].width = 26
        for i in range(len(days)):
            ws.column_dimensions[get_column_letter(2 + i)].width = 5
        ws.column_dimensions[get_column_letter(total_col)].width = 8
        ws.freeze_panes = 'B2'
        return wb
