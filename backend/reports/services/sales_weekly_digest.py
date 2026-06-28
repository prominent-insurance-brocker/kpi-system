"""Sales Weekly Digest metrics (TED-567).

Pure, side-effect-free computation of the five metrics shown in the weekly
digest email, for the most recent completed Monday→Sunday week, compared with
the week before. Reused by both the cron management command and the
``send_test`` API action.

All week windows are computed in the active Django timezone
(``settings.TIME_ZONE`` = Asia/Dubai). ``status_changed_at`` and ``added_at``
are UTC ``DateTimeField``s, so they are filtered with timezone-aware half-open
ranges ``[lo, hi)`` built from local midnight boundaries.

Key calculation choices (documented in the TED-567 plan; each is a one-line
change if the ticket owner intends otherwise):
  * "Won/Lost in the week" is recognised by ``status_changed_at`` (set on the
    terminal transition), with the ``SalesKPIStatusTransition`` audit row as a
    fallback for legacy rows whose ``status_changed_at`` is null.
  * Conversion Rate denominator "Total Deals" = deals *closed* in the week
    (won + lost), so numerator and denominator share one population.
  * Top-performer credit goes to the deal's ``assignee`` (the salesperson).
  * Inactive Users = active non-staff users holding the ``sales_kpi``
    permission, with activity bucketed by ``added_at`` local day (matching the
    Team Daily Tracker).
"""
from __future__ import annotations

from datetime import datetime, time, timedelta

from django.db.models import Count, Max, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone

from auth_app.models import CustomUser
from entries.models import SalesKPIEntry, SalesKPIStatusTransition

SALES_MODULE_KEY = 'sales_kpi'

OPEN_STATUSES = [
    SalesKPIEntry.STATUS_LEAD,
    SalesKPIEntry.STATUS_AWAITING_QUOTE,
    SalesKPIEntry.STATUS_SHARED_WITH_CLIENT,
]

# A user is "inactive" if they logged entries on at most this many weekdays of
# the Mon→Fri working week — i.e. zero entries on more than 3 of the 5 days.
MAX_ACTIVE_WEEKDAYS_FOR_INACTIVE = 1


def _short_currency(value):
    """Compact money label matching the design (e.g. 950000 -> '950K')."""
    value = float(value or 0)
    abs_v = abs(value)
    if abs_v >= 1_000_000:
        return f"{value / 1_000_000:.1f}M".replace('.0M', 'M')
    if abs_v >= 1_000:
        return f"{value / 1_000:.0f}K"
    return f"{value:.0f}"


def _full_number(value):
    """Thousands-separated whole number (e.g. 200000 -> '200,000')."""
    return f"{float(value or 0):,.0f}"


def _pct_change(curr, prior):
    """Signed % change with a divide-by-zero guard.

    Returns ``None`` when there is no prior-week baseline but current activity
    exists (rendered as "New"); ``0.0`` when both are zero.
    """
    curr = float(curr or 0)
    prior = float(prior or 0)
    if prior == 0:
        return None if curr > 0 else 0.0
    return (curr - prior) / prior * 100


def _delta(curr, prior):
    """Render-ready delta: value, display string, and direction flag."""
    pct = _pct_change(curr, prior)
    if pct is None:
        return {'pct': None, 'display': 'New', 'direction': 'new'}
    rounded = round(pct, 1)
    if rounded > 0:
        direction, sign = 'up', '+'
    elif rounded < 0:
        direction, sign = 'down', ''
    else:
        direction, sign = 'flat', ''
    return {'pct': rounded, 'display': f"{sign}{rounded:g}%", 'direction': direction}


class SalesWeeklyDigestService:
    """Compute the Sales Weekly Digest payload for a reference date."""

    def __init__(self, ref_date=None):
        self.tz = timezone.get_current_timezone()
        today = ref_date or timezone.localdate()
        this_monday = today - timedelta(days=today.weekday())
        # Most recent completed week (last Mon → last Sun).
        self.last_start = this_monday - timedelta(days=7)
        self.last_end = self.last_start + timedelta(days=6)
        self.last_friday = self.last_start + timedelta(days=4)
        # The week before that, for week-over-week comparison.
        self.prior_start = self.last_start - timedelta(days=7)
        self.prior_end = self.last_start - timedelta(days=1)

    # -- window helpers -----------------------------------------------------
    def _bounds(self, start_date, end_date):
        """Half-open aware datetime range covering local [start_date, end_date]."""
        lo = datetime.combine(start_date, time.min, tzinfo=self.tz)
        hi = datetime.combine(end_date + timedelta(days=1), time.min, tzinfo=self.tz)
        return lo, hi

    def _closed_in(self, statuses, start_date, end_date):
        """SalesKPIEntry rows whose terminal status was reached in the window.

        Primary signal: ``status_changed_at``. Legacy fallback: rows with a
        null ``status_changed_at`` matched through the status-transition audit
        table. The two subsets are disjoint (null vs not-null), so the union
        has no duplicates.
        """
        lo, hi = self._bounds(start_date, end_date)
        base = SalesKPIEntry.objects.filter(status__in=statuses)
        primary = base.filter(status_changed_at__gte=lo, status_changed_at__lt=hi)
        legacy_ids = SalesKPIStatusTransition.objects.filter(
            to_status__in=statuses,
            changed_at__gte=lo,
            changed_at__lt=hi,
            entry__status_changed_at__isnull=True,
        ).values_list('entry_id', flat=True)
        legacy = base.filter(status_changed_at__isnull=True, id__in=legacy_ids)
        return primary | legacy

    @staticmethod
    def _sum(qs, field):
        total = qs.aggregate(s=Sum(field))['s']
        return float(total) if total is not None else 0.0

    # -- per-metric windowed figures ---------------------------------------
    def _week_figures(self, start_date, end_date):
        won_qs = self._closed_in([SalesKPIEntry.STATUS_WON], start_date, end_date)
        lost_qs = self._closed_in([SalesKPIEntry.STATUS_LOST], start_date, end_date)
        won_count = won_qs.count()
        lost_count = lost_qs.count()
        closed_total = won_count + lost_count
        return {
            'converted_premium': self._sum(won_qs, 'converted_premium'),
            'won_count': won_count,
            'lost_count': lost_count,
            'closed_total': closed_total,
            'conversion_rate': (won_count / closed_total * 100) if closed_total else 0.0,
        }

    def _top_performers(self):
        won_qs = self._closed_in(
            [SalesKPIEntry.STATUS_WON], self.last_start, self.last_end,
        )
        rows = (
            won_qs
            .values('assignee_id', 'assignee__full_name', 'assignee__email')
            .annotate(premium=Sum('converted_premium'), won_count=Count('id'))
            .order_by('-premium', '-won_count')[:5]
        )
        performers = []
        for r in rows:
            name = r['assignee__full_name'] or r['assignee__email']
            premium = float(r['premium'] or 0)
            performers.append({
                'name': name,
                'premium': premium,
                'premium_display': _full_number(premium),
                'won_count': r['won_count'],
            })
        return performers

    def _pending_count(self):
        return SalesKPIEntry.objects.filter(status__in=OPEN_STATUSES).count()

    def _inactive_users(self):
        """Sales users who logged entries on <= 1 weekday of last Mon→Fri."""
        team = list(
            CustomUser.objects.filter(
                is_active=True,
                is_staff=False,
                role__permissions__module=SALES_MODULE_KEY,
            ).distinct()
        )
        if not team:
            return []
        team_ids = [u.id for u in team]

        lo, hi = self._bounds(self.last_start, self.last_friday)
        active_days = {}
        rows = (
            SalesKPIEntry.objects.filter(
                added_by_id__in=team_ids,
                added_at__gte=lo,
                added_at__lt=hi,
            )
            .annotate(day=TruncDate('added_at', tzinfo=self.tz))
            .values('added_by_id', 'day')
            .order_by()   # clear BaseEntry default ordering so DISTINCT groups cleanly
            .distinct()
        )
        for r in rows:
            active_days.setdefault(r['added_by_id'], set()).add(r['day'])

        inactive_ids = [
            uid for uid in team_ids
            if len(active_days.get(uid, ())) <= MAX_ACTIVE_WEEKDAYS_FOR_INACTIVE
        ]
        if not inactive_ids:
            return []

        # All-time "Last Used" = most recent local day they logged anything.
        last_used = {
            r['added_by_id']: r['last']
            for r in (
                SalesKPIEntry.objects.filter(added_by_id__in=inactive_ids)
                .annotate(day=TruncDate('added_at', tzinfo=self.tz))
                .values('added_by_id')
                .annotate(last=Max('day'))
                .order_by()   # clear BaseEntry default ordering from the GROUP BY
            )
        }

        by_id = {u.id: u for u in team}
        result = []
        for uid in inactive_ids:
            user = by_id[uid]
            day = last_used.get(uid)
            result.append({
                'name': user.full_name or user.email,
                'email': user.email,
                'last_used': day.isoformat() if day else None,
                'last_used_display': day.strftime('%b %d, %Y') if day else 'Never',
            })
        # Most-recently-active first; never-active users last.
        result.sort(key=lambda r: (r['last_used'] is not None, r['last_used'] or ''), reverse=True)
        return result

    # -- public API ---------------------------------------------------------
    def build(self):
        last = self._week_figures(self.last_start, self.last_end)
        prior = self._week_figures(self.prior_start, self.prior_end)

        converted = last['converted_premium']
        prior_converted = prior['converted_premium']
        conv_rate = round(last['conversion_rate'], 1)
        prior_conv_rate = round(prior['conversion_rate'], 1)

        return {
            'week_start': self.last_start,
            'week_end': self.last_end,
            'week_label': self._range_label(self.last_start, self.last_end),
            'prior_week_label': self._range_label(self.prior_start, self.prior_end),
            'converted_premium': {
                'value': round(converted, 2),
                'display': _short_currency(converted),
                'prior': round(prior_converted, 2),
                'delta': _delta(converted, prior_converted),
            },
            'pending_count': self._pending_count(),
            'top_performers': self._top_performers(),
            'conversion_rate': {
                'value': conv_rate,
                'display': f"{conv_rate:g}%",
                'prior': prior_conv_rate,
                'delta': _delta(last['conversion_rate'], prior['conversion_rate']),
                'won_count': last['won_count'],
                'closed_total': last['closed_total'],
            },
            'inactive_users': self._inactive_users(),
            'generated_at': timezone.localtime().strftime('%b %d, %Y %H:%M'),
        }

    @staticmethod
    def _range_label(start_date, end_date):
        if start_date.year == end_date.year:
            return f"{start_date.strftime('%b %d')} – {end_date.strftime('%b %d, %Y')}"
        return f"{start_date.strftime('%b %d, %Y')} – {end_date.strftime('%b %d, %Y')}"
