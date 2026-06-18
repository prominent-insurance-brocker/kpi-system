import django_filters


class EntryFilter(django_filters.FilterSet):
    """Base filter for all entry types."""
    date_from = django_filters.DateFilter(field_name='date', lookup_expr='gte')
    date_to = django_filters.DateFilter(field_name='date', lookup_expr='lte')
    # TED-551: filter by creation day (added_at) rather than the operational
    # `date` field. The daily trackers bucket entries by added_at, so they fetch
    # with these to avoid dropping deals whose `date` is in another month.
    created_from = django_filters.DateFilter(field_name='added_at', lookup_expr='date__gte')
    created_to = django_filters.DateFilter(field_name='added_at', lookup_expr='date__lte')
    user_id = django_filters.NumberFilter(field_name='added_by_id')

    class Meta:
        fields = ['date_from', 'date_to', 'created_from', 'created_to', 'user_id']


class ClaimEntryFilter(EntryFilter):
    """Filter for medical-claim entries — adds a status filter and customer-name search."""
    status = django_filters.CharFilter(field_name='status', lookup_expr='exact')
    customer_name = django_filters.CharFilter(field_name='customer_name', lookup_expr='icontains')

    class Meta:
        fields = ['date_from', 'date_to', 'user_id', 'status', 'customer_name']


class MotorClaimEntryFilter(EntryFilter):
    """Filter for motor-claim entries — status, source agent, client-name search,
    plus a secondary date range on next_call_date and lookup-FK filters for
    type_of_accident / insurance_company.
    """
    status = django_filters.CharFilter(field_name='status', lookup_expr='exact')
    client_name = django_filters.CharFilter(field_name='client_name', lookup_expr='icontains')
    agent_id = django_filters.NumberFilter(field_name='source_id')
    next_call_date_from = django_filters.DateFilter(field_name='next_call_date', lookup_expr='gte')
    next_call_date_to = django_filters.DateFilter(field_name='next_call_date', lookup_expr='lte')
    type_of_accident = django_filters.NumberFilter(field_name='type_of_accident_id')
    insurance_company = django_filters.NumberFilter(field_name='insurance_company_id')

    class Meta:
        fields = [
            'date_from', 'date_to', 'user_id', 'status', 'client_name',
            'agent_id', 'next_call_date_from', 'next_call_date_to',
            'type_of_accident', 'insurance_company',
        ]


class BaseEnquiryFilter(EntryFilter):
    """Common per-enquiry filters shared by the motor + general modules.

    All enquiry modules (motor new/renewal, motor fleet new/renewal, general
    new/renewal) share the same status state-machine, an agent FK, a
    client-name search, and an insurance_company FK. Module-specific class
    fields are added by the subclasses below — Motor uses `class_of_enquiry`
    (a char choice), General uses `class_of_insurance` (an FK).
    """
    status = django_filters.CharFilter(field_name='status', lookup_expr='exact')
    agent_id = django_filters.NumberFilter(field_name='agent_id')
    client_name = django_filters.CharFilter(field_name='client_name', lookup_expr='icontains')
    insurance_company = django_filters.NumberFilter(field_name='insurance_company_id')

    class Meta:
        fields = [
            'date_from', 'date_to', 'user_id', 'status', 'agent_id', 'client_name',
            'insurance_company',
        ]


class MotorEnquiryFilter(BaseEnquiryFilter):
    """Filter for motor new / motor renewal / motor fleet enquiries.

    Adds the motor-only `class_of_enquiry` char-choice filter (TED-527) on top
    of the shared enquiry filters. Used by all four motor enquiry viewsets
    since their schemas are identical.
    """
    class_of_enquiry = django_filters.CharFilter(field_name='class_of_enquiry', lookup_expr='exact')

    class Meta:
        fields = [
            'date_from', 'date_to', 'user_id', 'status', 'agent_id', 'client_name',
            'insurance_company', 'class_of_enquiry',
        ]


# Backwards-compatible alias (kept short to make grepping easy if old code lingers).
MotorNewEntryFilter = MotorEnquiryFilter


class GeneralEnquiryFilter(BaseEnquiryFilter):
    """Filter for general new / general renewal enquiries.

    Adds the general-only `class_of_insurance` FK lookup (TED-528) on top of
    the shared enquiry filters. General modules use an FK class field rather
    than the motor `class_of_enquiry` char choice.
    """
    class_of_insurance = django_filters.NumberFilter(field_name='class_of_insurance_id')

    class Meta:
        fields = [
            'date_from', 'date_to', 'user_id', 'status', 'agent_id', 'client_name',
            'insurance_company', 'class_of_insurance',
        ]


class SalesKPIEntryFilter(EntryFilter):
    """Per-ticket Sales KPI filter (TED-446).

    Supports filtering by status, assignee, entry type, class_of_insurance,
    plus a customer-name icontains search.
    """
    status = django_filters.CharFilter(field_name='status', lookup_expr='exact')
    assignee = django_filters.NumberFilter(field_name='assignee_id')
    entry_type = django_filters.CharFilter(field_name='entry_type', lookup_expr='exact')
    class_of_insurance = django_filters.NumberFilter(field_name='class_of_insurance_id')
    customer_name = django_filters.CharFilter(field_name='customer_name', lookup_expr='icontains')

    class Meta:
        fields = [
            'date_from', 'date_to', 'user_id',
            'status', 'assignee', 'entry_type', 'class_of_insurance', 'customer_name',
        ]
