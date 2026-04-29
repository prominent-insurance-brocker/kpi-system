from rest_framework import viewsets, status, filters
from django.db.models import Count, Q
from rest_framework.decorators import action
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend

from roles.permissions import HasModulePermission
from .models import (
    GeneralNewEntry,
    GeneralRenewalEntry,
    MotorNewEntry,
    MotorRenewalEntry,
    MotorClaimEntry,
    MotorClaimStatusTransition,
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
    MotorRenewalEntrySerializer,
    MotorClaimEntrySerializer,
    MotorClaimStatusUpdateSerializer,
    SalesKPIEntrySerializer,
    SalesMonthlyTargetSerializer,
    MarineNewEntrySerializer,
    MarineRenewalEntrySerializer,
    MedicalClaimEntrySerializer,
    MedicalClaimStatusUpdateSerializer,
)
from .filters import EntryFilter, ClaimEntryFilter


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

    def _resolve_on_behalf_of(self):
        """If staff is creating on behalf of another user, return that user; else None."""
        request_user = self.request.user
        target = self.request.data.get('added_by')
        if not (request_user.is_staff and target):
            return None
        if str(target) == str(request_user.id):
            return None
        from django.contrib.auth import get_user_model
        User = get_user_model()
        try:
            return User.objects.get(id=target)
        except (User.DoesNotExist, ValueError, TypeError):
            return None

    def perform_create(self, serializer):
        """Record `added_by` = the actual creator; if a staff user is creating
        on behalf of another user, also set `on_behalf_of` to that target user."""
        on_behalf = self._resolve_on_behalf_of()
        if on_behalf is not None:
            serializer.save(added_by=self.request.user, on_behalf_of=on_behalf)
        else:
            serializer.save(added_by=self.request.user)

    def update(self, request, *args, **kwargs):
        """Check ownership and edit window before updating. Staff can edit any entry."""
        instance = self.get_object()

        if not request.user.is_staff:
            # Check ownership
            if instance.added_by != request.user:
                return Response(
                    {'error': 'You can only edit your own entries'},
                    status=status.HTTP_403_FORBIDDEN
                )

            # Check 30-minute edit window
            if not instance.is_editable():
                return Response(
                    {'error': 'Edit window has expired (30 minutes)'},
                    status=status.HTTP_403_FORBIDDEN
                )

        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        """Check ownership before deleting (staff can delete any)."""
        instance = self.get_object()

        # Check ownership for non-staff
        if instance.added_by != request.user and not request.user.is_staff:
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


class MotorNewEntryViewSet(BaseEntryViewSet):
    queryset = MotorNewEntry.objects.all()
    serializer_class = MotorNewEntrySerializer
    module_key = 'motor_new'


class MotorRenewalEntryViewSet(BaseEntryViewSet):
    queryset = MotorRenewalEntry.objects.all()
    serializer_class = MotorRenewalEntrySerializer
    module_key = 'motor_renewal'


class MotorClaimEntryViewSet(BaseEntryViewSet):
    queryset = MotorClaimEntry.objects.all()
    serializer_class = MotorClaimEntrySerializer
    module_key = 'motor_claim'
    filterset_class = ClaimEntryFilter

    def get_queryset(self):
        return super().get_queryset().prefetch_related('status_transitions')

    def perform_create(self, serializer):
        on_behalf = self._resolve_on_behalf_of()
        save_kwargs = {'added_by': self.request.user}
        if on_behalf is not None:
            save_kwargs['on_behalf_of'] = on_behalf
        instance = serializer.save(**save_kwargs)
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
        user = self.request.user
        queryset = SalesMonthlyTarget.objects.all() if user.is_staff else SalesMonthlyTarget.objects.filter(user=user)
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
        on_behalf = self._resolve_on_behalf_of()
        save_kwargs = {'added_by': self.request.user}
        if on_behalf is not None:
            save_kwargs['on_behalf_of'] = on_behalf
        instance = serializer.save(**save_kwargs)
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
            'claims_pending': 0,
            'claims_resolved': 0,
            'claims_rejected': 0,
        }
        for row in rows:
            if row['status'] in counts:
                counts[row['status']] = row['count']

        return Response(counts)
