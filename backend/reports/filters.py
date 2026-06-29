import django_filters

from .models import ReportSendEvent


class ReportSendEventFilter(django_filters.FilterSet):
    """Filters for the module-wide send history (report / trigger / outcome)."""
    report = django_filters.NumberFilter(field_name='report_id')
    trigger = django_filters.CharFilter(field_name='trigger', lookup_expr='exact')
    status = django_filters.CharFilter(method='filter_status')

    class Meta:
        model = ReportSendEvent
        fields = ['report', 'trigger', 'status']

    def filter_status(self, queryset, name, value):
        if value == 'failed':
            return queryset.filter(failed_count__gt=0)
        if value == 'ok':
            return queryset.filter(failed_count=0)
        return queryset
