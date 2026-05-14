from decimal import Decimal

from rest_framework import viewsets, status, filters
from django.db.models import Avg, Count, Q
from django.utils import timezone
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend

from roles.permissions import HasModulePermission
from .models import (
    GeneralNewEntry,
    GeneralRenewalEntry,
    MotorNewEntry,
    MotorNewStatusTransition,
    MotorRenewalEntry,
    MotorRenewalStatusTransition,
    MotorRenewalMonthlyTarget,
    MotorClaimEntry,
    MotorClaimStatusTransition,
    TypeOfAccident,
    InsuranceCompany,
    SalesKPIEntry,
    SalesMonthlyTarget,
    MarineNewEntry,
    MarineRenewalEntry,
    MedicalClaimEntry,
    MedicalClaimStatusTransition,
)
from .serializers import (
    GeneralNewEntrySerializer,
    GeneralRenewalEntrySerializer,
    MotorNewEntrySerializer,
    MotorNewStatusUpdateSerializer,
    MotorNewRevisionsUpdateSerializer,
    MotorRenewalEntrySerializer,
    MotorRenewalStatusUpdateSerializer,
    MotorRenewalRevisionsUpdateSerializer,
    MotorRenewalMonthlyTargetSerializer,
    MotorClaimEntrySerializer,
    MotorClaimStatusUpdateSerializer,
    TypeOfAccidentSerializer,
    InsuranceCompanySerializer,
    SalesKPIEntrySerializer,
    SalesMonthlyTargetSerializer,
    MarineNewEntrySerializer,
    MarineRenewalEntrySerializer,
    MedicalClaimEntrySerializer,
    MedicalClaimStatusUpdateSerializer,
)
from .filters import EntryFilter, ClaimEntryFilter, MotorEnquiryFilter, MotorClaimEntryFilter
from roles.permissions import IsAdminUser


class BaseEntryViewSet(viewsets.ModelViewSet):
    """Base viewset for all entry types."""
    permission_classes = [IsAuthenticated, HasModulePermission]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = EntryFilter
    search_fields = ['added_by__email', 'added_by__full_name']
    ordering_fields = ['date', 'added_at']
    ordering = ['-date', '-added_at']
    module_key = None  # Override in subclasses for permission checking

    def get_queryset(self):
        """Filter based on user's data visibility permission.

        Records are visible to a user under "own" scope when the user is either
        the literal `added_by` OR the `on_behalf_of` (i.e. an admin entered for them).
        """
        queryset = super().get_queryset()
        user = self.request.user

        can_see_all = (
            user.is_staff or
            (hasattr(user, 'role') and user.role and user.role.data_visibility == 'all')
        )

        if not can_see_all:
            queryset = queryset.filter(Q(added_by=user) | Q(on_behalf_of=user))

        user_filter = self.request.query_params.get('user_id')
        if user_filter and can_see_all:
            # Filter to records where the target user is the effective owner.
            queryset = queryset.filter(
                Q(on_behalf_of_id=user_filter)
                | (Q(on_behalf_of__isnull=True) & Q(added_by_id=user_filter))
            )

        return queryset

    def perform_create(self, serializer):
        """Always create as the requesting user. Admins cannot create on behalf of others."""
        serializer.save(added_by=self.request.user)

    def update(self, request, *args, **kwargs):
        """Only the creator can edit, and only within the 30-minute window."""
        instance = self.get_object()

        if instance.added_by != request.user:
            return Response(
                {'error': 'You can only edit your own entries'},
                status=status.HTTP_403_FORBIDDEN
            )

        if not instance.is_editable():
            return Response(
                {'error': 'Edit window has expired (30 minutes)'},
                status=status.HTTP_403_FORBIDDEN
            )

        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        """Only the creator can delete."""
        instance = self.get_object()

        if instance.added_by != request.user:
            return Response(
                {'error': 'You can only delete your own entries'},
                status=status.HTTP_403_FORBIDDEN
            )

        return super().destroy(request, *args, **kwargs)


class GeneralNewEntryViewSet(BaseEntryViewSet):
    queryset = GeneralNewEntry.objects.all()
    serializer_class = GeneralNewEntrySerializer
    module_key = 'general_new'


class GeneralRenewalEntryViewSet(BaseEntryViewSet):
    queryset = GeneralRenewalEntry.objects.all()
    serializer_class = GeneralRenewalEntrySerializer
    module_key = 'general_renewal'


def _build_enquiry_stats(queryset, success_status='converted'):
    """Compute the dashboard metrics from a queryset of per-enquiry rows.

    Both modules share an identical schema (status / revisions / added_at /
    status_changed_at) but use different terminology for the positive outcome:
      - Motor New uses `converted`.
      - Motor Renewal uses `retained`.

    The response includes BOTH `converted` and `retained` keys so the frontend
    can read whichever applies; only one is non-zero for a given module.

    Reads via .values_list to avoid the FieldError caused by combining the
    viewset's select_related('agent') with .only(...) on a partial field set.
    """
    total = queryset.count()
    revised = queryset.filter(revisions__gt=0).count()
    success_count = queryset.filter(status=success_status).count()
    lost = queryset.filter(status='lost').count()

    terminal = queryset.filter(
        status__in=[success_status, 'lost']
    ).exclude(status_changed_at=None)

    avg_tat_seconds = None
    avg_accuracy = None

    rows = list(terminal.values_list('added_at', 'status_changed_at', 'revisions'))
    if rows:
        decay = Decimal('0.9')
        deltas = [
            (status_changed_at - added_at).total_seconds()
            for added_at, status_changed_at, _ in rows
        ]
        accuracies = [
            float(Decimal('100') * (decay ** revisions))
            for _, _, revisions in rows
        ]
        avg_tat_seconds = sum(deltas) / len(deltas)
        avg_accuracy = sum(accuracies) / len(accuracies)

    return {
        'total': total,
        'revised': revised,
        'converted': success_count if success_status == 'converted' else 0,
        'retained': success_count if success_status == 'retained' else 0,
        'lost': lost,
        'avg_tat_minutes': round(avg_tat_seconds / 60, 2) if avg_tat_seconds is not None else None,
        'avg_accuracy': round(avg_accuracy, 2) if avg_accuracy is not None else None,
    }


class MotorNewEntryViewSet(BaseEntryViewSet):
    queryset = MotorNewEntry.objects.all()
    serializer_class = MotorNewEntrySerializer
    module_key = 'motor_new'
    filterset_class = MotorEnquiryFilter

    def get_queryset(self):
        return super().get_queryset().select_related('agent').prefetch_related('status_transitions')

    def perform_create(self, serializer):
        instance = serializer.save(
            added_by=self.request.user,
            status=MotorNewEntry.STATUS_NEW,
            revisions=0,
        )
        MotorNewStatusTransition.objects.create(
            entry=instance,
            from_status='',
            to_status=instance.status,
            changed_by=self.request.user,
        )

    @action(detail=True, methods=['patch'], url_path='update-status')
    def update_status(self, request, pk=None):
        """Update status with transition validation. Bypasses 30-min window + ownership."""
        entry = self.get_object()

        if entry.is_terminal:
            return Response(
                {'error': 'Cannot change status of a converted or lost enquiry.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = MotorNewStatusUpdateSerializer(
            data=request.data,
            context={'entry': entry},
        )
        serializer.is_valid(raise_exception=True)

        old_status = entry.status
        new_status = serializer.validated_data['status']
        new_revisions = serializer.validated_data.get('revisions')

        entry.status = new_status
        update_fields = ['status', 'updated_at']

        if new_revisions is not None:
            entry.revisions = new_revisions
            update_fields.append('revisions')

        if new_status in MotorNewEntry.TERMINAL_STATUSES:
            entry.status_changed_at = timezone.now()
            update_fields.append('status_changed_at')

        entry.save(update_fields=update_fields)

        MotorNewStatusTransition.objects.create(
            entry=entry,
            from_status=old_status,
            to_status=new_status,
            changed_by=request.user,
        )

        return Response(
            MotorNewEntrySerializer(entry, context={'request': request}).data
        )

    @action(detail=True, methods=['patch'], url_path='update-revisions')
    def update_revisions(self, request, pk=None):
        """Update the revisions counter. Only allowed while status='new'."""
        entry = self.get_object()

        if entry.status != MotorNewEntry.STATUS_NEW:
            return Response(
                {'error': 'Revisions can only be edited while the enquiry status is New.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = MotorNewRevisionsUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        entry.revisions = serializer.validated_data['revisions']
        entry.save(update_fields=['revisions', 'updated_at'])

        return Response(
            MotorNewEntrySerializer(entry, context={'request': request}).data
        )

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Return the 6 dashboard metrics respecting RBAC + filters."""
        queryset = self.get_queryset()
        params = {
            k: v for k, v in request.query_params.items()
            if k in ('date_from', 'date_to', 'agent_id', 'status')
        }
        filterset = self.filterset_class(params, queryset=queryset)
        queryset = filterset.qs
        return Response(_build_enquiry_stats(queryset))


class MotorRenewalEntryViewSet(BaseEntryViewSet):
    queryset = MotorRenewalEntry.objects.all()
    serializer_class = MotorRenewalEntrySerializer
    module_key = 'motor_renewal'
    filterset_class = MotorEnquiryFilter

    def get_queryset(self):
        return super().get_queryset().select_related('agent').prefetch_related('status_transitions')

    def perform_create(self, serializer):
        instance = serializer.save(
            added_by=self.request.user,
            status=MotorRenewalEntry.STATUS_NEW,
            revisions=0,
        )
        MotorRenewalStatusTransition.objects.create(
            entry=instance,
            from_status='',
            to_status=instance.status,
            changed_by=self.request.user,
        )

    @action(detail=True, methods=['patch'], url_path='update-status')
    def update_status(self, request, pk=None):
        entry = self.get_object()

        if entry.is_terminal:
            return Response(
                {'error': 'Cannot change status of a retained or lost enquiry.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = MotorRenewalStatusUpdateSerializer(
            data=request.data,
            context={'entry': entry},
        )
        serializer.is_valid(raise_exception=True)

        old_status = entry.status
        new_status = serializer.validated_data['status']
        new_revisions = serializer.validated_data.get('revisions')

        entry.status = new_status
        update_fields = ['status', 'updated_at']

        if new_revisions is not None:
            entry.revisions = new_revisions
            update_fields.append('revisions')

        if new_status in MotorRenewalEntry.TERMINAL_STATUSES:
            entry.status_changed_at = timezone.now()
            update_fields.append('status_changed_at')

        entry.save(update_fields=update_fields)

        MotorRenewalStatusTransition.objects.create(
            entry=entry,
            from_status=old_status,
            to_status=new_status,
            changed_by=request.user,
        )

        return Response(
            MotorRenewalEntrySerializer(entry, context={'request': request}).data
        )

    @action(detail=True, methods=['patch'], url_path='update-revisions')
    def update_revisions(self, request, pk=None):
        entry = self.get_object()

        if entry.status != MotorRenewalEntry.STATUS_NEW:
            return Response(
                {'error': 'Revisions can only be edited while the enquiry status is New.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = MotorRenewalRevisionsUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        entry.revisions = serializer.validated_data['revisions']
        entry.save(update_fields=['revisions', 'updated_at'])

        return Response(
            MotorRenewalEntrySerializer(entry, context={'request': request}).data
        )

    @action(detail=False, methods=['get'])
    def stats(self, request):
        queryset = self.get_queryset()
        params = {
            k: v for k, v in request.query_params.items()
            if k in ('date_from', 'date_to', 'agent_id', 'status')
        }
        filterset = self.filterset_class(params, queryset=queryset)
        queryset = filterset.qs
        return Response(_build_enquiry_stats(queryset, success_status='retained'))


class MotorClaimEntryViewSet(BaseEntryViewSet):
    queryset = MotorClaimEntry.objects.all()
    serializer_class = MotorClaimEntrySerializer
    module_key = 'motor_claim'
    filterset_class = MotorClaimEntryFilter

    def get_queryset(self):
        return (
            super()
            .get_queryset()
            .select_related('source', 'type_of_accident', 'insurance_company')
            .prefetch_related('status_transitions')
        )

    def perform_create(self, serializer):
        instance = serializer.save(added_by=self.request.user)
        MotorClaimStatusTransition.objects.create(
            entry=instance,
            from_status='',
            to_status=instance.status,
            changed_by=self.request.user,
        )

    @action(detail=True, methods=['patch'], url_path='update-status')
    def update_status(self, request, pk=None):
        """Update status with transition validation. Bypasses 30-min window and ownership check."""
        entry = self.get_object()

        if entry.is_terminal:
            return Response(
                {'error': 'Cannot change status of a resolved or rejected claim.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = MotorClaimStatusUpdateSerializer(
            data=request.data,
            context={'entry': entry}
        )
        serializer.is_valid(raise_exception=True)

        old_status = entry.status
        new_status = serializer.validated_data['status']

        entry.status = new_status
        entry.save(update_fields=['status', 'updated_at'])

        MotorClaimStatusTransition.objects.create(
            entry=entry,
            from_status=old_status,
            to_status=new_status,
            changed_by=request.user,
        )

        return Response(
            MotorClaimEntrySerializer(entry, context={'request': request}).data
        )

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Return per-status counts respecting RBAC and date filters."""
        queryset = self.get_queryset()

        date_params = {k: v for k, v in request.query_params.items() if k in ('date_from', 'date_to')}
        filterset = self.filterset_class(date_params, queryset=queryset)
        queryset = filterset.qs

        rows = queryset.values('status').annotate(count=Count('id'))

        counts = {
            'claims_opened': 0,
            'claims_in_progress': 0,
            'claims_resolved': 0,
            'claims_rejected': 0,
        }
        for row in rows:
            if row['status'] in counts:
                counts[row['status']] = row['count']

        return Response(counts)


class SalesKPIEntryViewSet(BaseEntryViewSet):
    queryset = SalesKPIEntry.objects.all()
    serializer_class = SalesKPIEntrySerializer
    module_key = 'sales_kpi'


class SalesMonthlyTargetViewSet(viewsets.ModelViewSet):
    serializer_class = SalesMonthlyTargetSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        # Monthly targets are PER-USER. Admins are users too — they have their
        # own targets and must not see/edit other users' targets here. The
        # data_visibility='all' rule applies to entries, not personal targets.
        queryset = SalesMonthlyTarget.objects.filter(user=self.request.user)
        year = self.request.query_params.get('year')
        month = self.request.query_params.get('month')
        if year:
            queryset = queryset.filter(year=year)
        if month:
            queryset = queryset.filter(month=month)
        return queryset

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=False, methods=['get'], url_path='current')
    def current(self, request):
        from django.utils import timezone
        today = timezone.now().date()
        try:
            target = SalesMonthlyTarget.objects.get(
                user=request.user,
                year=today.year,
                month=today.month,
            )
            return Response(SalesMonthlyTargetSerializer(target).data)
        except SalesMonthlyTarget.DoesNotExist:
            return Response(None)


class MotorRenewalMonthlyTargetViewSet(viewsets.ModelViewSet):
    """Per-user retention target for the motor renewal module.

    Mirrors SalesMonthlyTargetViewSet — each user only sees/edits their own
    targets; admins included. The data_visibility='all' rule applies to entry
    data, not to personal targets.
    """
    serializer_class = MotorRenewalMonthlyTargetSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        queryset = MotorRenewalMonthlyTarget.objects.filter(user=self.request.user)
        year = self.request.query_params.get('year')
        month = self.request.query_params.get('month')
        if year:
            queryset = queryset.filter(year=year)
        if month:
            queryset = queryset.filter(month=month)
        return queryset

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=False, methods=['get'], url_path='current')
    def current(self, request):
        today = timezone.now().date()
        try:
            target = MotorRenewalMonthlyTarget.objects.get(
                user=request.user,
                year=today.year,
                month=today.month,
            )
            return Response(MotorRenewalMonthlyTargetSerializer(target).data)
        except MotorRenewalMonthlyTarget.DoesNotExist:
            return Response(None)


class MarineNewEntryViewSet(BaseEntryViewSet):
    queryset = MarineNewEntry.objects.all()
    serializer_class = MarineNewEntrySerializer
    module_key = 'marine_new'


class MarineRenewalEntryViewSet(BaseEntryViewSet):
    queryset = MarineRenewalEntry.objects.all()
    serializer_class = MarineRenewalEntrySerializer
    module_key = 'marine_renewal'


class MedicalClaimEntryViewSet(BaseEntryViewSet):
    queryset = MedicalClaimEntry.objects.all()
    serializer_class = MedicalClaimEntrySerializer
    module_key = 'medical_claim'
    filterset_class = ClaimEntryFilter

    def get_queryset(self):
        return super().get_queryset().prefetch_related('status_transitions')

    def perform_create(self, serializer):
        instance = serializer.save(added_by=self.request.user)
        MedicalClaimStatusTransition.objects.create(
            entry=instance,
            from_status='',
            to_status=instance.status,
            changed_by=self.request.user,
        )

    @action(detail=True, methods=['patch'], url_path='update-status')
    def update_status(self, request, pk=None):
        """Update status with transition validation. Bypasses 30-min window and ownership check."""
        entry = self.get_object()

        if entry.is_terminal:
            return Response(
                {'error': 'Cannot change status of a resolved or rejected claim.'},
                status=status.HTTP_400_BAD_REQUEST
            )

        serializer = MedicalClaimStatusUpdateSerializer(
            data=request.data,
            context={'entry': entry}
        )
        serializer.is_valid(raise_exception=True)

        old_status = entry.status
        new_status = serializer.validated_data['status']

        entry.status = new_status
        entry.save(update_fields=['status', 'updated_at'])

        MedicalClaimStatusTransition.objects.create(
            entry=entry,
            from_status=old_status,
            to_status=new_status,
            changed_by=request.user,
        )

        return Response(
            MedicalClaimEntrySerializer(entry, context={'request': request}).data
        )

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Return per-status counts respecting RBAC and date filters."""
        queryset = self.get_queryset()

        # Apply only date filters (user_id already handled by get_queryset RBAC logic)
        date_params = {k: v for k, v in request.query_params.items() if k in ('date_from', 'date_to')}
        filterset = self.filterset_class(date_params, queryset=queryset)
        queryset = filterset.qs

        rows = queryset.values('status').annotate(count=Count('id'))

        counts = {
            'claims_opened': 0,
            'claims_in_progress': 0,
            'claims_resolved': 0,
            'claims_rejected': 0,
        }
        for row in rows:
            if row['status'] in counts:
                counts[row['status']] = row['count']

        return Response(counts)


# Settings (admin-managed lookup tables for Motor Claim).
# Read is open to any authenticated user (claim form dropdowns need it).
# Write/delete is admin only.


class _LookupViewSet(viewsets.ModelViewSet):
    """Shared base for the TypeOfAccident / InsuranceCompany viewsets.

    GET/list/retrieve: any authenticated user (so the Motor Claim form can
        populate its dropdowns).
    POST/PATCH/PUT/DELETE: admins OR users with the 'settings' module
        permission.
    """
    module_key = 'settings'
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ['is_active']

    def get_permissions(self):
        if self.action in ('list', 'retrieve'):
            return [IsAuthenticated()]
        return [IsAuthenticated(), HasModulePermission()]


class TypeOfAccidentViewSet(_LookupViewSet):
    queryset = TypeOfAccident.objects.all()
    serializer_class = TypeOfAccidentSerializer


class InsuranceCompanyViewSet(_LookupViewSet):
    queryset = InsuranceCompany.objects.all()
    serializer_class = InsuranceCompanySerializer
