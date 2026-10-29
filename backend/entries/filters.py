import re

import django_filters
from django.db.models import Q

# A search term that names an entry id: '12', 'PIB-12', 'pib12' (case-insensitive).
_PIB_ID_TERM = re.compile(r'^(?:pib-?)?(\d+)$', re.IGNORECASE)
# 'PIB 12' is joined into 'PIB-12' before splitting so it stays one id term.
_PIB_SPACED = re.compile(r'\bpib\s+(\d+)\b', re.IGNORECASE)


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
    # TED-594: optionally include/exclude voided entries (e.g. ?is_voided=false
    # to hide them). Declared filters are always active regardless of each
    # subclass's Meta.fields, so this is available on every entry list endpoint.
    is_voided = django_filters.BooleanFilter(field_name='is_voided')

    class Meta:
        fields = ['date_from', 'date_to', 'created_from', 'created_to', 'user_id']


class EntrySearchMixin(django_filters.FilterSet):
    """The list-page search box: `?q=`.

    The value is split on whitespace; every term must match (AND) and each term
    may match any searchable field (OR). A term that looks like an id ('12',
    'PIB-12', 'pib 12') matches that exact `pib_id` only (never PIB-120), and is
    also tried as text, so a client called "12 Star" is still found. Subclasses
    list the text columns to search (icontains) in `search_text_fields`.
    Separate from DRF's `?search=`, which already looks up added_by.
    """
    q = django_filters.CharFilter(method='filter_q')

    search_text_fields = ()

    def filter_q(self, queryset, name, value):
        value = _PIB_SPACED.sub(r'PIB-\1', (value or '').strip())
        for term in value.split():
            match = Q()
            id_match = _PIB_ID_TERM.match(term)
            if id_match:
                match |= Q(pib_id__iexact=f'PIB-{int(id_match.group(1))}')
            for field in self.search_text_fields:
                match |= Q(**{f'{field}__icontains': term})
            # Only local columns / forward FKs are searched, so no distinct().
            queryset = queryset.filter(match) if match else queryset.none()
        return queryset


class ClaimEntryFilter(EntrySearchMixin, EntryFilter):
    """Filter for medical-claim entries — adds a status filter and customer-name search."""
    search_text_fields = ('customer_name',)

    status = django_filters.CharFilter(field_name='status', lookup_expr='exact')
    customer_name = django_filters.CharFilter(field_name='customer_name', lookup_expr='icontains')

    class Meta:
        fields = ['date_from', 'date_to', 'user_id', 'status', 'customer_name', 'q']


class MotorClaimEntryFilter(EntrySearchMixin, EntryFilter):
    """Filter for motor-claim entries — status, source agent, client-name search,
    plus a secondary date range on next_call_date and lookup-FK filters for
    type_of_accident / insurance_company.
    """
    search_text_fields = ('client_name',)

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
            'type_of_accident', 'insurance_company', 'q',
        ]


class BaseEnquiryFilter(EntrySearchMixin, EntryFilter):
    """Common per-enquiry filters shared by the motor + general modules.

    All enquiry modules (motor new/renewal, motor fleet new/renewal, general
    new/renewal) share the same status state-machine, an agent FK, a
    client-name search, and an insurance_company FK. Module-specific class
    fields are added by the subclasses below — Motor uses `class_of_enquiry`
    (a char choice), General uses `class_of_insurance` (an FK).
    """
    search_text_fields = ('client_name',)

    status = django_filters.CharFilter(field_name='status', lookup_expr='exact')
    agent_id = django_filters.NumberFilter(field_name='agent_id')
    client_name = django_filters.CharFilter(field_name='client_name', lookup_expr='icontains')
    # TED-592: match any insurer that was compared on the enquiry (the create
    # modal's multi-select). The `insurance_company` FK now records only the Won
    # "purchased from" insurer, so filtering on it would drop open enquiries;
    # the compared M2M is what "filter by insurer" means here. distinct() dedups
    # the rows the M2M join would otherwise duplicate.
    insurance_company = django_filters.NumberFilter(
        field_name='compared_insurance_companies', distinct=True,
    )

    class Meta:
        fields = [
            'date_from', 'date_to', 'user_id', 'status', 'agent_id', 'client_name',
            'insurance_company', 'q',
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
            'insurance_company', 'class_of_enquiry', 'q',
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
            'insurance_company', 'class_of_insurance', 'q',
        ]


class MarineNewEnquiryFilter(GeneralEnquiryFilter):
    """Marine New enquiry filter: the general filters plus an exact
    saved-client id. `client_name` matches the linked client's name OR the
    legacy typed name (new and linked rows store client_name='').

    `q` searches the linked client (name / @username), the policy number and
    the insurer reference values, but not the legacy typed `client_name`: an
    unlinked legacy row is found by id or policy number until it is linked."""
    search_text_fields = (
        'client__name', 'client__username', 'policy_number', 'insurer_references_text',
    )

    client_name = django_filters.CharFilter(method='filter_client_name')
    client = django_filters.NumberFilter(field_name='client_id')

    def filter_client_name(self, queryset, name, value):
        value = (value or '').strip()
        if not value:
            return queryset
        return queryset.filter(
            Q(client__name__icontains=value) | Q(client_name__icontains=value)
        )

    class Meta:
        fields = [
            'date_from', 'date_to', 'user_id', 'status', 'agent_id', 'client_name',
            'insurance_company', 'class_of_insurance', 'client', 'q',
        ]


class SalesKPIEntryFilter(EntrySearchMixin, EntryFilter):
    """Per-ticket Sales KPI filter (TED-446).

    Supports filtering by status, assignee, entry type, class_of_insurance,
    plus a customer-name icontains search.
    """
    search_text_fields = ('customer_name',)

    status = django_filters.CharFilter(field_name='status', lookup_expr='exact')
    assignee = django_filters.NumberFilter(field_name='assignee_id')
    entry_type = django_filters.CharFilter(field_name='entry_type', lookup_expr='exact')
    class_of_insurance = django_filters.NumberFilter(field_name='class_of_insurance_id')
    customer_name = django_filters.CharFilter(field_name='customer_name', lookup_expr='icontains')

    class Meta:
        fields = [
            'date_from', 'date_to', 'user_id',
            'status', 'assignee', 'entry_type', 'class_of_insurance', 'customer_name', 'q',
        ]
