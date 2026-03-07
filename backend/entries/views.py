from rest_framework import viewsets, status, filters
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
    SalesPremiumDataEntry,
    SalesKPIEntry,
    MarineNewEntry,
    MarineRenewalEntry,
)
from .serializers import (
    GeneralNewEntrySerializer,
    GeneralRenewalEntrySerializer,
    MotorNewEntrySerializer,
    MotorRenewalEntrySerializer,
    MotorClaimEntrySerializer,
    SalesPremiumDataEntrySerializer,
    SalesKPIEntrySerializer,
    MarineNewEntrySerializer,
    MarineRenewalEntrySerializer,
)
from .filters import EntryFilter


class BaseEntryViewSet(viewsets.ModelViewSet):
    """Base viewset for all entry types."""
    permission_classes = [IsAuthenticated, HasModulePermission]
    filter_backends = [DjangoFilterBackend, filters.SearchFilter, filters.OrderingFilter]
    filterset_class = EntryFilter
    search_fields = ['added_by__email', 'added_by__first_name', 'added_by__last_name']
    ordering_fields = ['date', 'added_at']
    ordering = ['-date', '-added_at']
    module_key = None  # Override in subclasses for permission checking

    def get_queryset(self):
        """Filter based on user's data visibility permission."""
        queryset = super().get_queryset()
        user = self.request.user

        # Check if user can see all data
        can_see_all = (
            user.is_staff or
            (hasattr(user, 'role') and user.role and user.role.data_visibility == 'all')
        )

        if not can_see_all:
            queryset = queryset.filter(added_by=user)

        # Apply user filter if provided and user has permission
        user_filter = self.request.query_params.get('user_id')
        if user_filter and can_see_all:
            queryset = queryset.filter(added_by_id=user_filter)

        return queryset

    def perform_create(self, serializer):
        """Set the added_by field to the current user."""
        serializer.save(added_by=self.request.user)

    def update(self, request, *args, **kwargs):
        """Check ownership and edit window before updating."""
        instance = self.get_object()

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


class SalesPremiumDataEntryViewSet(BaseEntryViewSet):
    queryset = SalesPremiumDataEntry.objects.all()
    serializer_class = SalesPremiumDataEntrySerializer
    module_key = 'sales_premium_data'


class SalesKPIEntryViewSet(BaseEntryViewSet):
    queryset = SalesKPIEntry.objects.all()
    serializer_class = SalesKPIEntrySerializer
    module_key = 'sales_kpi'


class MarineNewEntryViewSet(BaseEntryViewSet):
    queryset = MarineNewEntry.objects.all()
    serializer_class = MarineNewEntrySerializer
    module_key = 'marine_new'


class MarineRenewalEntryViewSet(BaseEntryViewSet):
    queryset = MarineRenewalEntry.objects.all()
    serializer_class = MarineRenewalEntrySerializer
    module_key = 'marine_renewal'
