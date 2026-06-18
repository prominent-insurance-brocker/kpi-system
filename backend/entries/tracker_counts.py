"""Team Daily Tracker counts endpoint.

JSON sibling of ``tracker_export.py`` — same aggregation (``tracker_common``),
but returns the per-(member, day) counts that drive the on-screen calendar
instead of an .xlsx. Computing the counts server-side removes the old
client-side pagination cap (the browser used to bucket a ``page_size``-capped
array, silently undercounting busy months) and shares one day-bucketing
implementation with the export, so the live grid and the download can never
disagree.
"""
from __future__ import annotations

from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from .tracker_common import entry_counts, parse_tracker_request


class TrackerCountsView(APIView):
    """GET /api/entries/tracker-counts/

    Query params:
        module    (required) module key, e.g. ``sales_kpi``
        start     (required) range start, YYYY-MM-DD (local date)
        end       (required) range end, YYYY-MM-DD (local date, inclusive)
        user_ids  (optional) comma-separated member ids; omit for "all members"
        tz        (optional) IANA timezone for day-bucketing (default Asia/Dubai)

    Returns only the non-zero (member, day) pairs::

        {"counts": [{"user_id": 12, "date": "2026-06-11", "count": 3}, ...]}

    The frontend renders 0 for every other (member, day) from its member list.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        model, _module, start, end, tz, user_ids, can_see_all = parse_tracker_request(
            request
        )
        counts = entry_counts(model, start, end, tz, user_ids, can_see_all, request.user)
        data = [
            {'user_id': uid, 'date': day.isoformat(), 'count': count}
            for (uid, day), count in counts.items()
        ]
        return Response({'counts': data})
