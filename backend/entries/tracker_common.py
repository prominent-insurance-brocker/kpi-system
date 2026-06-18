"""Shared Team Daily Tracker aggregation.

Single source of truth for *which entries land on which day for which member*,
used by BOTH the JSON counts endpoint (``tracker_counts.py``, powering the
on-screen calendar) and the .xlsx export (``tracker_export.py``). Keeping the
aggregation here guarantees the live grid and the downloaded report can never
disagree — the historical bug was two independent implementations (one in the
browser bucketing by browser-tz, one server-side).

Days are bucketed by the local ``added_at`` date in the supplied timezone
(defaults to the active Django timezone, i.e. ``settings.TIME_ZONE`` =
Asia/Dubai). Counts are grouped by the creator (``added_by``).
"""
from __future__ import annotations

from datetime import datetime, timedelta
from zoneinfo import ZoneInfo

from django.db.models import Count, Q
from django.db.models.functions import TruncDate
from django.utils import timezone
from rest_framework.exceptions import PermissionDenied, ValidationError

from auth_app.models import CustomUser
from roles.permissions import user_is_hod

from .models import (
    GeneralNewEntry,
    GeneralRenewalEntry,
    MarineNewEntry,
    MarineRenewalEntry,
    MedicalClaimEntry,
    MotorClaimEntry,
    MotorFleetNewEntry,
    MotorFleetRenewalEntry,
    MotorNewEntry,
    MotorRenewalEntry,
    SalesKPIEntry,
)

# Module key -> entry model. Keys match the viewset ``module_key`` values.
MODULE_MODELS = {
    'general_new': GeneralNewEntry,
    'general_renewal': GeneralRenewalEntry,
    'motor_new': MotorNewEntry,
    'motor_renewal': MotorRenewalEntry,
    'motor_fleet_new': MotorFleetNewEntry,
    'motor_fleet_renewal': MotorFleetRenewalEntry,
    'motor_claim': MotorClaimEntry,
    'sales_kpi': SalesKPIEntry,
    'marine_new': MarineNewEntry,
    'marine_renewal': MarineRenewalEntry,
    'medical_claim': MedicalClaimEntry,
}

# Human labels for the sheet title / filename.
MODULE_LABELS = {
    'general_new': 'General New',
    'general_renewal': 'General Renewal',
    'motor_new': 'Motor New',
    'motor_renewal': 'Motor Renewal',
    'motor_fleet_new': 'Motor Fleet New',
    'motor_fleet_renewal': 'Motor Fleet Renewal',
    'motor_claim': 'Motor Claim',
    'sales_kpi': 'Deals',
    'marine_new': 'Marine New',
    'marine_renewal': 'Marine Renewal',
    'medical_claim': 'Medical Claim',
}

MAX_RANGE_DAYS = 366


def parse_date(value, field):
    try:
        return datetime.strptime(value, '%Y-%m-%d').date()
    except (TypeError, ValueError):
        raise ValidationError({field: 'Expected a date in YYYY-MM-DD format.'})


def parse_user_ids(raw):
    if not raw:
        return []
    return [int(p) for p in (s.strip() for s in raw.split(',')) if p.isdigit()]


def resolve_tz(tz_name):
    """IANA name -> ZoneInfo, falling back to the active Django timezone
    (settings.TIME_ZONE = Asia/Dubai)."""
    if tz_name:
        try:
            return ZoneInfo(tz_name)
        except Exception:
            pass
    return timezone.get_current_timezone()


def compute_can_see_all(user):
    """Mirror entries.views.BaseEntryViewSet.get_queryset data-visibility."""
    return bool(
        user.is_staff
        or user_is_hod(user)
        or (getattr(user, 'role', None) and user.role.data_visibility == 'all')
    )


def entry_counts(model, start, end, tz, user_ids, can_see_all, user):
    """Return ``{(user_id, date): count}`` grouped by the entry creator
    (``added_by``) and the local ``added_at`` day in ``tz``.

    Aggregated entirely in the database, so there is no pagination cap — the
    whole window is counted regardless of volume.
    """
    qs = model.objects.all()
    if not can_see_all:
        qs = qs.filter(Q(added_by=user) | Q(on_behalf_of=user))
    # Coarse UTC window (+/- 1 day) so the DB can use the added_at index;
    # the exact local-day filter happens on the annotation below.
    qs = qs.filter(
        added_at__date__gte=start - timedelta(days=1),
        added_at__date__lte=end + timedelta(days=1),
    )
    if user_ids:
        qs = qs.filter(added_by_id__in=user_ids)

    rows = (
        qs.annotate(day=TruncDate('added_at', tzinfo=tz))
        .filter(day__gte=start, day__lte=end)
        .values('added_by_id', 'day')
        .annotate(count=Count('id'))
    )
    return {(r['added_by_id'], r['day']): r['count'] for r in rows}


def members(module, user_ids, can_see_all, user):
    """Resolve the team member rows. The frontend usually sends explicit
    ``user_ids`` (the visible members, or the checked subset); the membership
    query is a fallback for direct API use."""
    if not can_see_all:
        return [user]
    qs = CustomUser.objects.filter(is_active=True).select_related('role')
    if user_ids:
        qs = qs.filter(id__in=user_ids)
    else:
        qs = qs.filter(Q(is_staff=True) | Q(role__permissions__module=module))
    return list(qs.distinct().order_by('full_name', 'email', 'id'))


def parse_tracker_request(request):
    """Shared param parsing + module-permission + visibility resolution for the
    tracker endpoints (export + counts). Returns
    ``(model, module, start, end, tz, user_ids, can_see_all)`` or raises
    ValidationError / PermissionDenied."""
    user = request.user
    params = request.query_params

    module = params.get('module')
    model = MODULE_MODELS.get(module)
    if model is None:
        raise ValidationError({'module': 'Unknown or unsupported module.'})

    # Module permission — mirror roles.permissions.HasModulePermission.
    if not user.is_staff:
        role = getattr(user, 'role', None)
        if not role or not role.permissions.filter(module=module).exists():
            raise PermissionDenied('You do not have access to this module.')

    start = parse_date(params.get('start'), 'start')
    end = parse_date(params.get('end'), 'end')
    if start > end:
        raise ValidationError({'start': 'start must be on or before end.'})
    if (end - start).days + 1 > MAX_RANGE_DAYS:
        raise ValidationError(
            {'end': f'Date range too large (max {MAX_RANGE_DAYS} days).'}
        )

    tz = resolve_tz(params.get('tz'))
    user_ids = parse_user_ids(params.get('user_ids'))
    can_see_all = compute_can_see_all(user)
    return model, module, start, end, tz, user_ids, can_see_all
