"""Sales Weekly Digest metrics (TED-567).

Pure, side-effect-free computation of the digest email's metrics for the most
recent completed Monday->Sunday week, compared with the week before. Reused by
both the dispatcher command and the ``send_test`` / ``send_now`` API actions.

Deals are bucketed by ``added_at`` local day (the active Django timezone,
``settings.TIME_ZONE`` = Asia/Dubai) — the same basis as the on-screen Sales
dashboard ``stats`` and the Team Daily Tracker, so the email agrees with the
app. ``added_at`` is a UTC ``DateTimeField``, so windows are timezone-aware
half-open ranges ``[lo, hi)`` built from local-midnight boundaries.

Key Metrics (each with a week-over-week delta), matching the design mockup:
  Total Enquiries, Pending (lead+awaiting_quote+shared_with_client), Won,
  Potential Premium, Converted Premium. Plus Conversion Rate (Won / Total),
  Top 5 Performers (by assignee, ranked by converted premium) and Inactive
  Users (sales team with entries on <= 1 weekday of Mon-Fri).
"""
from __future__ import annotations

from datetime import datetime, time, timedelta

from django.db.models import Count, Max, Sum
from django.db.models.functions import TruncDate
from django.utils import timezone

from auth_app.models import CustomUser
from entries.models import SalesKPIEntry

SALES_MODULE_KEY = 'sales_kpi'

OPEN_STATUSES = [
    SalesKPIEntry.STATUS_LEAD,
    SalesKPIEntry.STATUS_AWAITING_QUOTE,
    SalesKPIEntry.STATUS_SHARED_WITH_CLIENT,
]

# A user is "inactive" if they logged entries on at most this many weekdays of
# the Mon->Fri working week — i.e. zero entries on more than 3 of the 5 days.
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
    """Thousands-separated whole number (e.g. 1245 -> '1,245')."""
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
        # Most recent completed week (last Mon -> last Sun).
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

    @staticmethod
    def _sum(qs, field):
        total = qs.aggregate(s=Sum(field))['s']
        return float(total) if total is not None else 0.0

    # -- per-week figures (bucketed by added_at) ---------------------------
    def _week_figures(self, start_date, end_date):
        lo, hi = self._bounds(start_date, end_date)
        qs = SalesKPIEntry.objects.filter(added_at__gte=lo, added_at__lt=hi)
        counts = dict(qs.values_list('status').annotate(n=Count('id')))
        lead = counts.get(SalesKPIEntry.STATUS_LEAD, 0)
        awaiting = counts.get(SalesKPIEntry.STATUS_AWAITING_QUOTE, 0)
        shared = counts.get(SalesKPIEntry.STATUS_SHARED_WITH_CLIENT, 0)
        won = counts.get(SalesKPIEntry.STATUS_WON, 0)
        lost = counts.get(SalesKPIEntry.STATUS_LOST, 0)
        total = lead + awaiting + shared + won + lost
        pending = lead + awaiting + shared
        return {
            'total': total,
            'pending': pending,
            'won': won,
            'lost': lost,
            'potential_premium': self._sum(qs, 'potential_premium'),
            'converted_premium': self._sum(
                qs.filter(status=SalesKPIEntry.STATUS_WON), 'converted_premium',
            ),
            'conversion_rate': (won / total * 100) if total else 0.0,
        }

    def _top_performers(self):
        lo, hi = self._bounds(self.last_start, self.last_end)
        won_qs = SalesKPIEntry.objects.filter(
            added_at__gte=lo, added_at__lt=hi, status=SalesKPIEntry.STATUS_WON,
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

    def _inactive_users(self):
        """Sales users who logged entries on <= 1 weekday of last Mon->Fri."""
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
                added_by_id__in=team_ids, added_at__gte=lo, added_at__lt=hi,
            )
            .annotate(day=TruncDate('added_at', tzinfo=self.tz))
            .values('added_by_id', 'day')
            .order_by()
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

        last_used = {
            r['added_by_id']: r['last']
            for r in (
                SalesKPIEntry.objects.filter(added_by_id__in=inactive_ids)
                .annotate(day=TruncDate('added_at', tzinfo=self.tz))
                .values('added_by_id')
                .annotate(last=Max('day'))
                .order_by()
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
        result.sort(key=lambda r: (r['last_used'] is not None, r['last_used'] or ''), reverse=True)
        return result

    # -- public API ---------------------------------------------------------
    def build(self):
        last = self._week_figures(self.last_start, self.last_end)
        prior = self._week_figures(self.prior_start, self.prior_end)

        def card(label, key, formatter):
            return {
                'label': label,
                'value': last[key],
                'display': formatter(last[key]),
                'delta': _delta(last[key], prior[key]),
            }

        key_metrics = [
            card('Total Enquiries', 'total', _full_number),
            card('Pending', 'pending', _full_number),
            card('Won', 'won', _full_number),
            card('Potential Premium', 'potential_premium', _short_currency),
            card('Converted Premium', 'converted_premium', _short_currency),
        ]

        conv = round(last['conversion_rate'], 1)
        return {
            'week_start': self.last_start,
            'week_end': self.last_end,
            'week_label': self._range_label(self.last_start, self.last_end),
            'prior_week_label': self._range_label(self.prior_start, self.prior_end),
            'key_metrics': key_metrics,
            'conversion_rate': {
                'value': conv,
                'display': f"{conv:g}%",
                'delta': _delta(last['conversion_rate'], prior['conversion_rate']),
                'won_count': last['won'],
                'total': last['total'],
            },
            'top_performers': self._top_performers(),
            'inactive_users': self._inactive_users(),
            'generated_at': timezone.localtime().strftime('%b %d, %Y %H:%M'),
        }

    @staticmethod
    def _range_label(start_date, end_date):
        if start_date.year == end_date.year:
            return f"{start_date.strftime('%b %d')} – {end_date.strftime('%b %d, %Y')}"
        return f"{start_date.strftime('%b %d, %Y')} – {end_date.strftime('%b %d, %Y')}"
