import django_filters
from rest_framework import viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from roles.permissions import IsAdminUser

from .models import AuditLog
from .registry import CATEGORY_LABELS, CATEGORY_ORDER, MODEL_TO_CATEGORY
from .serializers import AuditLogSerializer


class AuditLogFilter(django_filters.FilterSet):
    category = django_filters.CharFilter(field_name='category', lookup_expr='exact')
    action = django_filters.CharFilter(field_name='action', lookup_expr='exact')
    actor_id = django_filters.NumberFilter(field_name='actor_id')
    # Date-only range over the timestamp (inclusive of the whole `date_to` day).
    date_from = django_filters.DateFilter(field_name='timestamp__date', lookup_expr='gte')
    date_to = django_filters.DateFilter(field_name='timestamp__date', lookup_expr='lte')

    class Meta:
        model = AuditLog
        fields = ['category', 'action', 'actor_id', 'date_from', 'date_to']


class AuditLogViewSet(viewsets.ReadOnlyModelViewSet):
    """Admin-only, read-only audit trail.

    Defaults to newest-first across all users; the frontend narrows by
    ``category`` (one per Audit sidebar link) plus optional action/user/date
    filters. Uses the global StandardPagination + filter backends.
    """
    queryset = AuditLog.objects.select_related('actor', 'content_type').all()
    serializer_class = AuditLogSerializer
    permission_classes = [IsAdminUser]
    filterset_class = AuditLogFilter
    search_fields = ['object_label', 'actor__email', 'actor__full_name']
    ordering_fields = ['timestamp']
    ordering = ['-timestamp']

    @action(detail=False, methods=['get'])
    def categories(self, request):
        """List the audited categories (key + label) in display order.

        Mirrors ``/api/roles/modules/`` so the frontend can render the Audit
        menu from the backend instead of hardcoding it.
        """
        audited = set(MODEL_TO_CATEGORY.values())
        data = [
            {'key': key, 'label': CATEGORY_LABELS.get(key, key)}
            for key in CATEGORY_ORDER
            if key in audited
        ]
        return Response({'categories': data})
