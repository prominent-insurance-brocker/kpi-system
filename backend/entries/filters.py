import django_filters


class EntryFilter(django_filters.FilterSet):
    """Base filter for all entry types."""
    date_from = django_filters.DateFilter(field_name='date', lookup_expr='gte')
    date_to = django_filters.DateFilter(field_name='date', lookup_expr='lte')
    user_id = django_filters.NumberFilter(field_name='added_by_id')

    class Meta:
        fields = ['date_from', 'date_to', 'user_id']


class ClaimEntryFilter(EntryFilter):
    """Filter for claim entries — adds a status filter and customer-name search."""
    status = django_filters.CharFilter(field_name='status', lookup_expr='exact')
    customer_name = django_filters.CharFilter(field_name='customer_name', lookup_expr='icontains')

    class Meta:
        fields = ['date_from', 'date_to', 'user_id', 'status', 'customer_name']


class MotorEnquiryFilter(EntryFilter):
    """Filter for motor new / motor renewal enquiries — status, agent, and client-name search.

    Used by both MotorNewEntry and MotorRenewalEntry viewsets since their
    schemas are identical.
    """
    status = django_filters.CharFilter(field_name='status', lookup_expr='exact')
    agent_id = django_filters.NumberFilter(field_name='agent_id')
    client_name = django_filters.CharFilter(field_name='client_name', lookup_expr='icontains')

    class Meta:
        fields = ['date_from', 'date_to', 'user_id', 'status', 'agent_id', 'client_name']


# Backwards-compatible alias (kept short to make grepping easy if old code lingers).
MotorNewEntryFilter = MotorEnquiryFilter
