import django_filters


class EntryFilter(django_filters.FilterSet):
    """Base filter for all entry types."""
    date_from = django_filters.DateFilter(field_name='date', lookup_expr='gte')
    date_to = django_filters.DateFilter(field_name='date', lookup_expr='lte')
    user_id = django_filters.NumberFilter(field_name='added_by_id')

    class Meta:
        fields = ['date_from', 'date_to', 'user_id']


class ClaimEntryFilter(EntryFilter):
    """Filter for claim entries — adds a status filter."""
    status = django_filters.CharFilter(field_name='status', lookup_expr='exact')

    class Meta:
        fields = ['date_from', 'date_to', 'user_id', 'status']
