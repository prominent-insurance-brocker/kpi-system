from decimal import Decimal

from rest_framework import viewsets, status, filters, serializers as drf_serializers
from django.contrib.contenttypes.models import ContentType
from django.db.models import Avg, Count, Q, Sum
from django.db.models.functions import Coalesce
from django.utils import timezone
from rest_framework.decorators import action, api_view, permission_classes
from rest_framework.exceptions import PermissionDenied
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated
from django_filters.rest_framework import DjangoFilterBackend

from roles.permissions import HasModulePermission
from .models import (
    EntryRemark,
    GeneralNewEntry,
    GeneralNewStatusTransition,
    GeneralRenewalEntry,
    GeneralRenewalStatusTransition,
    GeneralRenewalMonthlyTarget,
    MotorNewEntry,
    MotorNewStatusTransition,
    MotorRenewalEntry,
    MotorRenewalStatusTransition,
    MotorRenewalMonthlyTarget,
    MotorFleetNewEntry,
    MotorFleetNewStatusTransition,
    MotorFleetRenewalEntry,
    MotorFleetRenewalStatusTransition,
    MotorFleetRenewalMonthlyTarget,
    MotorClaimEntry,
    MotorClaimStatusTransition,
    TypeOfAccident,
    InsuranceCompany,
    ClassOfInsurance,
    SalesKPIEntry,
    SalesKPIStatusTransition,
    SalesMonthlyTarget,
    MarineNewEntry,
    MarineRenewalEntry,
    MedicalClaimEntry,
    MedicalClaimStatusTransition,
)
from .serializers import (
    EntryRemarkSerializer,
    GeneralNewEntrySerializer,
    GeneralNewStatusUpdateSerializer,
    GeneralNewRevisionsUpdateSerializer,
    GeneralRenewalEntrySerializer,
    GeneralRenewalStatusUpdateSerializer,
    GeneralRenewalRevisionsUpdateSerializer,
    GeneralRenewalMonthlyTargetSerializer,
    MotorNewEntrySerializer,
    MotorNewStatusUpdateSerializer,
    MotorNewRevisionsUpdateSerializer,
    MotorRenewalEntrySerializer,
    MotorRenewalStatusUpdateSerializer,
    MotorRenewalRevisionsUpdateSerializer,
    MotorRenewalMonthlyTargetSerializer,
    MotorFleetNewEntrySerializer,
    MotorFleetNewStatusUpdateSerializer,
    MotorFleetNewRevisionsUpdateSerializer,
    MotorFleetRenewalEntrySerializer,
    MotorFleetRenewalStatusUpdateSerializer,
    MotorFleetRenewalRevisionsUpdateSerializer,
    MotorFleetRenewalMonthlyTargetSerializer,
    MotorClaimEntrySerializer,
    MotorClaimStatusUpdateSerializer,
    TypeOfAccidentSerializer,
    InsuranceCompanySerializer,
    ClassOfInsuranceSerializer,
    SalesKPIEntrySerializer,
    SalesKPIStatusUpdateSerializer,
    SalesMonthlyTargetSerializer,
    MarineNewEntrySerializer,
    MarineRenewalEntrySerializer,
    MedicalClaimEntrySerializer,
    MedicalClaimStatusUpdateSerializer,
)
from .filters import (
    EntryFilter, ClaimEntryFilter, MotorEnquiryFilter, MotorClaimEntryFilter,
    SalesKPIEntryFilter,
)
from roles.permissions import IsAdminUser, user_is_hod


_WRITE_METHODS = {'POST', 'PUT', 'PATCH', 'DELETE'}


def _user_can_aggregate(user):
    """HOD + super admin both get the team / individual switcher (TED-464).

    Regular users always see only their own targets.
    """
    return bool(user and (user.is_staff or user_is_hod(user)))


class HodAwareMonthlyTargetMixin:
    """Shared HOD / admin behavior for monthly-target viewsets.

    Used by General Renewal, Motor Renewal, Motor Fleet Renewal, and Sales KPI
    targets.

    Aggregators (HOD or super admin) can pass a `user_id` query param to scope
    the response to that specific user's per-user rows (TED-464 individual
    toggle). When omitted, the response is team-summed across all users.

    Writes (POST/PATCH/DELETE) always save under `request.user` and are
    blocked entirely for HOD via check_permissions.

    Subclasses must set:
      * `model_class` — concrete *MonthlyTarget Django model
      * `serializer_class` — concrete *MonthlyTargetSerializer
      * `aggregate_fields` (optional) — list of numeric field names to sum for
        team aggregation. Defaults to `['clients_assigned']`; Sales KPI also
        carries `premium_target`.
    """
    model_class = None
    aggregate_fields: list[str] = ['clients_assigned']

    def check_permissions(self, request):
        super().check_permissions(request)
        if request.method in _WRITE_METHODS and user_is_hod(request.user):
            raise PermissionDenied('HOD users cannot modify monthly targets.')

    def get_queryset(self):
        # Aggregator viewers (HOD / admin) can either drill into one user
        # (`?user_id=N`) or fall through to the team-aggregated `list`.
        if _user_can_aggregate(self.request.user):
            user_id = self.request.query_params.get('user_id')
            if user_id:
                qs = self.model_class.objects.filter(user_id=user_id)
            else:
                qs = self.model_class.objects.all()
        else:
            qs = self.model_class.objects.filter(user=self.request.user)
        year = self.request.query_params.get('year')
        month = self.request.query_params.get('month')
        if year:
            qs = qs.filter(year=year)
        if month:
            qs = qs.filter(month=month)
        return qs

    def list(self, request, *args, **kwargs):
        # Per-user views (regular user, or aggregator scoped to one user_id)
        # fall through to the standard serializer-driven response.
        if not _user_can_aggregate(request.user) or request.query_params.get('user_id'):
            return super().list(request, *args, **kwargs)
        qs = self.filter_queryset(self.get_queryset())
        annotations = {f: Sum(f) for f in self.aggregate_fields}
        rows = (
            qs.values('year', 'month')
            .annotate(**annotations)
            .order_by('year', 'month')
        )
        return Response([
            {
                'id': None,
                'user': None,
                'year': r['year'],
                'month': r['month'],
                'calculated_date': f"{r['year']:04d}-{r['month']:02d}-01",
                **{f: r[f] or 0 for f in self.aggregate_fields},
                'created_at': None,
                'updated_at': None,
                'aggregated': True,
            }
            for r in rows
        ])

    def perform_create(self, serializer):
        serializer.save(user=self.request.user)

    @action(detail=False, methods=['get'], url_path='current')
    def current(self, request):
        today = timezone.now().date()
        Model = self.model_class

        if _user_can_aggregate(request.user):
            user_id = request.query_params.get('user_id')
            if user_id:
                # Drill into a specific user (TED-464 individual toggle).
                # Returns the real per-user row if it exists; null otherwise.
                try:
                    target = Model.objects.get(
                        user_id=user_id, year=today.year, month=today.month,
                    )
                    return Response(self.get_serializer(target).data)
                except Model.DoesNotExist:
                    return Response(None)
            # Default for aggregators: team-summed across all users.
            agg = (
                Model.objects
                .filter(year=today.year, month=today.month)
                .aggregate(**{f: Sum(f) for f in self.aggregate_fields})
            )
            # If every aggregated field is None there are no rows at all for
            # the month — return null so the frontend's "no current target"
            # gate can trip as usual.
            if all(agg[f] is None for f in self.aggregate_fields):
                return Response(None)
            return Response({
                'id': None,
                'user': None,
                'year': today.year,
                'month': today.month,
                'calculated_date': today.replace(day=1).isoformat(),
                **{f: agg[f] or 0 for f in self.aggregate_fields},
                'created_at': None,
                'updated_at': None,
                'aggregated': True,
            })

        try:
            target = Model.objects.get(
                user=request.user, year=today.year, month=today.month,
            )
            return Response(self.get_serializer(target).data)
        except Model.DoesNotExist:
            return Response(None)


def _seed_initial_remark(text, instance, user):
    """If the request included a non-empty `initial_remark`, persist it as the
    entry's first EntryRemark. Back-dated to the entry's `added_at` so the
    seed comment timestamp matches the enquiry's creation.
    """
    if not text:
        return
    ct = ContentType.objects.get_for_model(type(instance))
    remark = EntryRemark.objects.create(
        content_type=ct, object_id=instance.id, text=text, author=user,
    )
    EntryRemark.objects.filter(pk=remark.pk).update(created_at=instance.added_at)


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
            user_is_hod(user) or
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

    def check_permissions(self, request):
        """Reject writes from HOD users before any view dispatch.

        Covers POST (create), PATCH/PUT (update + custom @action mutations like
        update-status, update-revisions, update-next-call-date), and DELETE.
        Reads pass through to the normal HasModulePermission flow.
        """
        super().check_permissions(request)
        if request.method in _WRITE_METHODS and user_is_hod(request.user):
            raise PermissionDenied('HOD users cannot create, modify, or delete entries.')

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
    filterset_class = MotorEnquiryFilter

    def get_queryset(self):
        return super().get_queryset().select_related('agent').prefetch_related('status_transitions')

    def perform_create(self, serializer):
        initial_remark = serializer.validated_data.pop('initial_remark', '').strip()
        instance = serializer.save(
            added_by=self.request.user,
            status=GeneralNewEntry.STATUS_NEW,
            revisions=0,
        )
        GeneralNewStatusTransition.objects.create(
            entry=instance,
            from_status='',
            to_status=instance.status,
            changed_by=self.request.user,
        )
        _seed_initial_remark(initial_remark, instance, self.request.user)

    @action(detail=True, methods=['patch'], url_path='update-status')
    def update_status(self, request, pk=None):
        entry = self.get_object()

        if entry.is_terminal:
            return Response(
                {'error': 'Cannot change status of a converted or lost enquiry.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = GeneralNewStatusUpdateSerializer(
            data=request.data,
            context={'entry': entry},
        )
        serializer.is_valid(raise_exception=True)

        old_status = entry.status
        new_status = serializer.validated_data['status']
        new_revisions = serializer.validated_data.get('revisions')
        new_converted_premium = serializer.validated_data.get('converted_premium')

        entry.status = new_status
        update_fields = ['status', 'updated_at']

        if new_revisions is not None:
            entry.revisions = new_revisions
            update_fields.append('revisions')

        # TED-440: persist the converted-premium amount captured by the
        # StatusTransitionModal. Only meaningful on the success transition;
        # ignored for Lost even if the client sent a value.
        if new_converted_premium is not None and new_status != 'lost':
            entry.converted_premium = new_converted_premium
            update_fields.append('converted_premium')

        if new_status in GeneralNewEntry.TERMINAL_STATUSES:
            entry.status_changed_at = timezone.now()
            update_fields.append('status_changed_at')

        entry.save(update_fields=update_fields)

        GeneralNewStatusTransition.objects.create(
            entry=entry,
            from_status=old_status,
            to_status=new_status,
            changed_by=request.user,
        )

        return Response(
            GeneralNewEntrySerializer(entry, context={'request': request}).data
        )

    @action(detail=True, methods=['patch'], url_path='update-revisions')
    def update_revisions(self, request, pk=None):
        entry = self.get_object()

        if entry.status != GeneralNewEntry.STATUS_NEW:
            return Response(
                {'error': 'Revisions can only be edited while the enquiry status is New.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = GeneralNewRevisionsUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        entry.revisions = serializer.validated_data['revisions']
        entry.save(update_fields=['revisions', 'updated_at'])

        return Response(
            GeneralNewEntrySerializer(entry, context={'request': request}).data
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
        return Response(_build_enquiry_stats(queryset, success_status='converted'))


class GeneralRenewalEntryViewSet(BaseEntryViewSet):
    queryset = GeneralRenewalEntry.objects.all()
    serializer_class = GeneralRenewalEntrySerializer
    module_key = 'general_renewal'
    filterset_class = MotorEnquiryFilter

    def get_queryset(self):
        return super().get_queryset().select_related('agent').prefetch_related('status_transitions')

    def perform_create(self, serializer):
        initial_remark = serializer.validated_data.pop('initial_remark', '').strip()
        instance = serializer.save(
            added_by=self.request.user,
            status=GeneralRenewalEntry.STATUS_NEW,
            revisions=0,
        )
        GeneralRenewalStatusTransition.objects.create(
            entry=instance,
            from_status='',
            to_status=instance.status,
            changed_by=self.request.user,
        )
        _seed_initial_remark(initial_remark, instance, self.request.user)

    @action(detail=True, methods=['patch'], url_path='update-status')
    def update_status(self, request, pk=None):
        entry = self.get_object()

        if entry.is_terminal:
            return Response(
                {'error': 'Cannot change status of a retained or lost enquiry.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = GeneralRenewalStatusUpdateSerializer(
            data=request.data,
            context={'entry': entry},
        )
        serializer.is_valid(raise_exception=True)

        old_status = entry.status
        new_status = serializer.validated_data['status']
        new_revisions = serializer.validated_data.get('revisions')
        new_converted_premium = serializer.validated_data.get('converted_premium')

        entry.status = new_status
        update_fields = ['status', 'updated_at']

        if new_revisions is not None:
            entry.revisions = new_revisions
            update_fields.append('revisions')

        # TED-440: persist the converted-premium amount captured by the
        # StatusTransitionModal. Only meaningful on the success transition;
        # ignored for Lost even if the client sent a value.
        if new_converted_premium is not None and new_status != 'lost':
            entry.converted_premium = new_converted_premium
            update_fields.append('converted_premium')

        if new_status in GeneralRenewalEntry.TERMINAL_STATUSES:
            entry.status_changed_at = timezone.now()
            update_fields.append('status_changed_at')

        entry.save(update_fields=update_fields)

        GeneralRenewalStatusTransition.objects.create(
            entry=entry,
            from_status=old_status,
            to_status=new_status,
            changed_by=request.user,
        )

        return Response(
            GeneralRenewalEntrySerializer(entry, context={'request': request}).data
        )

    @action(detail=True, methods=['patch'], url_path='update-revisions')
    def update_revisions(self, request, pk=None):
        entry = self.get_object()

        if entry.status != GeneralRenewalEntry.STATUS_NEW:
            return Response(
                {'error': 'Revisions can only be edited while the enquiry status is New.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = GeneralRenewalRevisionsUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        entry.revisions = serializer.validated_data['revisions']
        entry.save(update_fields=['revisions', 'updated_at'])

        return Response(
            GeneralRenewalEntrySerializer(entry, context={'request': request}).data
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


class GeneralRenewalMonthlyTargetViewSet(HodAwareMonthlyTargetMixin, viewsets.ModelViewSet):
    """Per-user retention target for the general renewal module.

    Non-HOD: each user only sees/edits their own targets; admins included. The
    data_visibility='all' rule applies to entry data, not to personal targets.
    HOD: writes blocked; reads return aggregate sums across all users.
    """
    model_class = GeneralRenewalMonthlyTarget
    serializer_class = GeneralRenewalMonthlyTargetSerializer
    permission_classes = [IsAuthenticated]


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

    # Premium aggregates (added 2026-05-24). potential_premium is nullable;
    # Sum() returns None when no matching rows have a value, so coerce.
    def _sum_potential(qs):
        result = qs.aggregate(s=Sum('potential_premium'))['s']
        # DecimalField → Decimal; the frontend expects a string-or-number JSON value.
        return float(result) if result is not None else 0.0

    # TED-440 dashboard card: prefer the actual converted_premium captured on
    # close; fall back to potential_premium for entries closed before this
    # field existed so historical aggregates don't regress to zero.
    def _sum_converted(qs):
        result = qs.aggregate(
            s=Sum(Coalesce('converted_premium', 'potential_premium')),
        )['s']
        return float(result) if result is not None else 0.0

    converted_premium = _sum_converted(queryset.filter(status=success_status))
    lost_premium = _sum_potential(queryset.filter(status='lost'))
    total_potential_premium = _sum_potential(queryset)

    return {
        'total': total,
        'revised': revised,
        'converted': success_count if success_status == 'converted' else 0,
        'retained': success_count if success_status == 'retained' else 0,
        'lost': lost,
        'avg_tat_minutes': round(avg_tat_seconds / 60, 2) if avg_tat_seconds is not None else None,
        'avg_accuracy': round(avg_accuracy, 2) if avg_accuracy is not None else None,
        # New premium aggregates: drive the Converted Premium / Lost Potential
        # Premium / Converted-vs-Potential Premium cards.
        'converted_premium': round(converted_premium, 2),
        'lost_premium': round(lost_premium, 2),
        'total_potential_premium': round(total_potential_premium, 2),
    }


class MotorNewEntryViewSet(BaseEntryViewSet):
    queryset = MotorNewEntry.objects.all()
    serializer_class = MotorNewEntrySerializer
    module_key = 'motor_new'
    filterset_class = MotorEnquiryFilter

    def get_queryset(self):
        return super().get_queryset().select_related('agent').prefetch_related('status_transitions')

    def perform_create(self, serializer):
        initial_remark = serializer.validated_data.pop('initial_remark', '').strip()
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
        _seed_initial_remark(initial_remark, instance, self.request.user)

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
        new_converted_premium = serializer.validated_data.get('converted_premium')

        entry.status = new_status
        update_fields = ['status', 'updated_at']

        if new_revisions is not None:
            entry.revisions = new_revisions
            update_fields.append('revisions')

        # TED-440: persist the converted-premium amount captured by the
        # StatusTransitionModal. Only meaningful on the success transition;
        # ignored for Lost even if the client sent a value.
        if new_converted_premium is not None and new_status != 'lost':
            entry.converted_premium = new_converted_premium
            update_fields.append('converted_premium')

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
        initial_remark = serializer.validated_data.pop('initial_remark', '').strip()
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
        _seed_initial_remark(initial_remark, instance, self.request.user)

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
        new_converted_premium = serializer.validated_data.get('converted_premium')

        entry.status = new_status
        update_fields = ['status', 'updated_at']

        if new_revisions is not None:
            entry.revisions = new_revisions
            update_fields.append('revisions')

        # TED-440: persist the converted-premium amount captured by the
        # StatusTransitionModal. Only meaningful on the success transition;
        # ignored for Lost even if the client sent a value.
        if new_converted_premium is not None and new_status != 'lost':
            entry.converted_premium = new_converted_premium
            update_fields.append('converted_premium')

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
        initial_remark = serializer.validated_data.pop('initial_remark', '').strip()
        instance = serializer.save(added_by=self.request.user)
        MotorClaimStatusTransition.objects.create(
            entry=instance,
            from_status='',
            to_status=instance.status,
            changed_by=self.request.user,
        )
        _seed_initial_remark(initial_remark, instance, self.request.user)

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

    @action(detail=True, methods=['patch'], url_path='update-next-call-date')
    def update_next_call_date(self, request, pk=None):
        """Inline edit for next_call_date — bypasses the 30-min edit window so
        the field can be rescheduled anytime by anyone with module access.
        Accepts {"next_call_date": "YYYY-MM-DD"} or {"next_call_date": null}.
        Rejects past dates (must be today or later).
        """
        entry = self.get_object()
        raw = request.data.get('next_call_date')
        if raw in (None, ''):
            entry.next_call_date = None
        else:
            from datetime import datetime
            try:
                parsed = datetime.strptime(raw, '%Y-%m-%d').date()
            except (TypeError, ValueError):
                return Response(
                    {'error': 'next_call_date must be in YYYY-MM-DD format or null.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            if parsed < timezone.localdate():
                return Response(
                    {'error': 'next_call_date cannot be in the past.'},
                    status=status.HTTP_400_BAD_REQUEST,
                )
            entry.next_call_date = parsed
        entry.save(update_fields=['next_call_date', 'updated_at'])
        return Response(
            MotorClaimEntrySerializer(entry, context={'request': request}).data
        )

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Current-status counts for the Motor Claim Dashboard.

        Returns six numbers feeding two card groups on the frontend:

        Overview (aggregates):
          - claims_opened:  total row count (every claim was opened on create)
          - claims_pending: status in {claims_opened, claims_in_progress}
          - claims_closed:  status in {claims_resolved, claims_rejected}

        Breakdown (single-status):
          - claims_in_progress: status == claims_in_progress
          - claims_resolved:    status == claims_resolved
          - claims_rejected:    status == claims_rejected

        RBAC + date filters still apply via get_queryset() + filterset.
        """
        queryset = self.get_queryset()

        date_params = {k: v for k, v in request.query_params.items() if k in ('date_from', 'date_to')}
        filterset = self.filterset_class(date_params, queryset=queryset)
        queryset = filterset.qs

        counts = dict(queryset.values_list('status').annotate(n=Count('id')))
        opened = counts.get('claims_opened', 0)
        in_progress = counts.get('claims_in_progress', 0)
        resolved = counts.get('claims_resolved', 0)
        rejected = counts.get('claims_rejected', 0)

        return Response({
            'claims_opened': opened + in_progress + resolved + rejected,
            'claims_pending': opened + in_progress,
            'claims_closed': resolved + rejected,
            'claims_in_progress': in_progress,
            'claims_resolved': resolved,
            'claims_rejected': rejected,
        })


class SalesKPIEntryViewSet(BaseEntryViewSet):
    queryset = SalesKPIEntry.objects.all()
    serializer_class = SalesKPIEntrySerializer
    module_key = 'sales_kpi'
    filterset_class = SalesKPIEntryFilter

    def get_queryset(self):
        return (
            super().get_queryset()
            .select_related('assignee', 'class_of_insurance')
            .prefetch_related('status_transitions')
        )

    def perform_create(self, serializer):
        # Sales KPI tickets always start in 'lead' and log the seed transition
        # so the audit log mirrors the motor/general renewal pattern.
        initial_remark = serializer.validated_data.pop('initial_remark', '').strip()
        instance = serializer.save(
            added_by=self.request.user,
            status=SalesKPIEntry.STATUS_LEAD,
        )
        SalesKPIStatusTransition.objects.create(
            entry=instance,
            from_status='',
            to_status=instance.status,
            changed_by=self.request.user,
        )
        _seed_initial_remark(initial_remark, instance, self.request.user)

    @action(detail=True, methods=['patch'], url_path='update-status')
    def update_status(self, request, pk=None):
        """TED-447 workflow. Bypasses 30-min window + ownership; accepts the
        three yes/no answers when closing the enquiry (Won/Lost) and the
        converted_premium for Won. Lead -> In Progress requires no payload
        beyond status; the frontend's generic confirmation popup gates it."""
        entry = self.get_object()

        if entry.is_terminal:
            return Response(
                {'error': 'Cannot change status of a won or lost enquiry.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = SalesKPIStatusUpdateSerializer(
            data=request.data,
            context={'entry': entry},
        )
        serializer.is_valid(raise_exception=True)

        old_status = entry.status
        new_status = serializer.validated_data['status']

        entry.status = new_status
        update_fields = ['status', 'updated_at']

        if new_status in SalesKPIEntry.TERMINAL_STATUSES:
            entry.sent_for_quote = serializer.validated_data['sent_for_quote']
            entry.quote_received = serializer.validated_data['quote_received']
            entry.submitted_to_client = serializer.validated_data['submitted_to_client']
            entry.status_changed_at = timezone.now()
            update_fields.extend([
                'sent_for_quote', 'quote_received', 'submitted_to_client',
                'status_changed_at',
            ])
            if new_status == SalesKPIEntry.STATUS_WON:
                entry.converted_premium = serializer.validated_data['converted_premium']
                update_fields.append('converted_premium')

        entry.save(update_fields=update_fields)

        SalesKPIStatusTransition.objects.create(
            entry=entry,
            from_status=old_status,
            to_status=new_status,
            changed_by=request.user,
        )

        return Response(
            SalesKPIEntrySerializer(entry, context={'request': request}).data
        )

    @action(detail=False, methods=['get'])
    def stats(self, request):
        """Dashboard counts + premium aggregates, RBAC + date filtered."""
        queryset = self.get_queryset()
        date_params = {
            k: v for k, v in request.query_params.items()
            if k in ('date_from', 'date_to')
        }
        filterset = self.filterset_class(date_params, queryset=queryset)
        queryset = filterset.qs

        counts = dict(queryset.values_list('status').annotate(n=Count('id')))
        lead = counts.get('lead', 0)
        in_progress = counts.get('in_progress', 0)
        won = counts.get('won', 0)
        lost = counts.get('lost', 0)
        total = lead + in_progress + won + lost

        def _sum(qs, field):
            r = qs.aggregate(s=Sum(field))['s']
            return float(r) if r is not None else 0.0

        potential_total = _sum(queryset, 'potential_premium')
        converted_premium_total = _sum(queryset.filter(status='won'), 'converted_premium')

        return Response({
            'total': total,
            'lead': lead,
            'in_progress': in_progress,
            'won': won,
            'lost': lost,
            'potential_premium_total': round(potential_total, 2),
            'converted_premium_total': round(converted_premium_total, 2),
        })


class SalesMonthlyTargetViewSet(HodAwareMonthlyTargetMixin, viewsets.ModelViewSet):
    """Per-user Sales KPI target.

    Non-HOD: each user only sees/edits their own targets; admins included.
    HOD: writes blocked; reads return team-summed `premium_target` and
    `clients_assigned` per (year, month) — see HodAwareMonthlyTargetMixin.
    """
    model_class = SalesMonthlyTarget
    serializer_class = SalesMonthlyTargetSerializer
    permission_classes = [IsAuthenticated]
    # Sales KPI tracks both premium and client targets; the other renewal
    # modules only have clients_assigned (mixin default).
    aggregate_fields = ['clients_assigned', 'premium_target']


class MotorRenewalMonthlyTargetViewSet(HodAwareMonthlyTargetMixin, viewsets.ModelViewSet):
    """Per-user retention target for the motor renewal module.

    Non-HOD: each user only sees/edits their own targets; admins included. The
    data_visibility='all' rule applies to entry data, not to personal targets.
    HOD: writes blocked; reads return aggregate sums across all users.
    """
    model_class = MotorRenewalMonthlyTarget
    serializer_class = MotorRenewalMonthlyTargetSerializer
    permission_classes = [IsAuthenticated]


class MotorFleetNewEntryViewSet(BaseEntryViewSet):
    queryset = MotorFleetNewEntry.objects.all()
    serializer_class = MotorFleetNewEntrySerializer
    module_key = 'motor_fleet_new'
    filterset_class = MotorEnquiryFilter

    def get_queryset(self):
        return super().get_queryset().select_related('agent').prefetch_related('status_transitions')

    def perform_create(self, serializer):
        initial_remark = serializer.validated_data.pop('initial_remark', '').strip()
        instance = serializer.save(
            added_by=self.request.user,
            status=MotorFleetNewEntry.STATUS_NEW,
            revisions=0,
        )
        MotorFleetNewStatusTransition.objects.create(
            entry=instance,
            from_status='',
            to_status=instance.status,
            changed_by=self.request.user,
        )
        _seed_initial_remark(initial_remark, instance, self.request.user)

    @action(detail=True, methods=['patch'], url_path='update-status')
    def update_status(self, request, pk=None):
        """Update status with transition validation. Bypasses 30-min window + ownership."""
        entry = self.get_object()

        if entry.is_terminal:
            return Response(
                {'error': 'Cannot change status of a converted or lost enquiry.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = MotorFleetNewStatusUpdateSerializer(
            data=request.data,
            context={'entry': entry},
        )
        serializer.is_valid(raise_exception=True)

        old_status = entry.status
        new_status = serializer.validated_data['status']
        new_revisions = serializer.validated_data.get('revisions')
        new_converted_premium = serializer.validated_data.get('converted_premium')

        entry.status = new_status
        update_fields = ['status', 'updated_at']

        if new_revisions is not None:
            entry.revisions = new_revisions
            update_fields.append('revisions')

        # TED-440: persist the converted-premium amount captured by the
        # StatusTransitionModal. Only meaningful on the success transition;
        # ignored for Lost even if the client sent a value.
        if new_converted_premium is not None and new_status != 'lost':
            entry.converted_premium = new_converted_premium
            update_fields.append('converted_premium')

        if new_status in MotorFleetNewEntry.TERMINAL_STATUSES:
            entry.status_changed_at = timezone.now()
            update_fields.append('status_changed_at')

        entry.save(update_fields=update_fields)

        MotorFleetNewStatusTransition.objects.create(
            entry=entry,
            from_status=old_status,
            to_status=new_status,
            changed_by=request.user,
        )

        return Response(
            MotorFleetNewEntrySerializer(entry, context={'request': request}).data
        )

    @action(detail=True, methods=['patch'], url_path='update-revisions')
    def update_revisions(self, request, pk=None):
        """Update the revisions counter. Only allowed while status='new'."""
        entry = self.get_object()

        if entry.status != MotorFleetNewEntry.STATUS_NEW:
            return Response(
                {'error': 'Revisions can only be edited while the enquiry status is New.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = MotorFleetNewRevisionsUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        entry.revisions = serializer.validated_data['revisions']
        entry.save(update_fields=['revisions', 'updated_at'])

        return Response(
            MotorFleetNewEntrySerializer(entry, context={'request': request}).data
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


class MotorFleetRenewalEntryViewSet(BaseEntryViewSet):
    queryset = MotorFleetRenewalEntry.objects.all()
    serializer_class = MotorFleetRenewalEntrySerializer
    module_key = 'motor_fleet_renewal'
    filterset_class = MotorEnquiryFilter

    def get_queryset(self):
        return super().get_queryset().select_related('agent').prefetch_related('status_transitions')

    def perform_create(self, serializer):
        initial_remark = serializer.validated_data.pop('initial_remark', '').strip()
        instance = serializer.save(
            added_by=self.request.user,
            status=MotorFleetRenewalEntry.STATUS_NEW,
            revisions=0,
        )
        MotorFleetRenewalStatusTransition.objects.create(
            entry=instance,
            from_status='',
            to_status=instance.status,
            changed_by=self.request.user,
        )
        _seed_initial_remark(initial_remark, instance, self.request.user)

    @action(detail=True, methods=['patch'], url_path='update-status')
    def update_status(self, request, pk=None):
        entry = self.get_object()

        if entry.is_terminal:
            return Response(
                {'error': 'Cannot change status of a retained or lost enquiry.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = MotorFleetRenewalStatusUpdateSerializer(
            data=request.data,
            context={'entry': entry},
        )
        serializer.is_valid(raise_exception=True)

        old_status = entry.status
        new_status = serializer.validated_data['status']
        new_revisions = serializer.validated_data.get('revisions')
        new_converted_premium = serializer.validated_data.get('converted_premium')

        entry.status = new_status
        update_fields = ['status', 'updated_at']

        if new_revisions is not None:
            entry.revisions = new_revisions
            update_fields.append('revisions')

        # TED-440: persist the converted-premium amount captured by the
        # StatusTransitionModal. Only meaningful on the success transition;
        # ignored for Lost even if the client sent a value.
        if new_converted_premium is not None and new_status != 'lost':
            entry.converted_premium = new_converted_premium
            update_fields.append('converted_premium')

        if new_status in MotorFleetRenewalEntry.TERMINAL_STATUSES:
            entry.status_changed_at = timezone.now()
            update_fields.append('status_changed_at')

        entry.save(update_fields=update_fields)

        MotorFleetRenewalStatusTransition.objects.create(
            entry=entry,
            from_status=old_status,
            to_status=new_status,
            changed_by=request.user,
        )

        return Response(
            MotorFleetRenewalEntrySerializer(entry, context={'request': request}).data
        )

    @action(detail=True, methods=['patch'], url_path='update-revisions')
    def update_revisions(self, request, pk=None):
        entry = self.get_object()

        if entry.status != MotorFleetRenewalEntry.STATUS_NEW:
            return Response(
                {'error': 'Revisions can only be edited while the enquiry status is New.'},
                status=status.HTTP_400_BAD_REQUEST,
            )

        serializer = MotorFleetRenewalRevisionsUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)

        entry.revisions = serializer.validated_data['revisions']
        entry.save(update_fields=['revisions', 'updated_at'])

        return Response(
            MotorFleetRenewalEntrySerializer(entry, context={'request': request}).data
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


class MotorFleetRenewalMonthlyTargetViewSet(HodAwareMonthlyTargetMixin, viewsets.ModelViewSet):
    """Per-user retention target for the motor fleet renewal module.

    Non-HOD: each user only sees/edits their own targets; admins included.
    HOD: writes blocked; reads return aggregate sums across all users.
    """
    model_class = MotorFleetRenewalMonthlyTarget
    serializer_class = MotorFleetRenewalMonthlyTargetSerializer
    permission_classes = [IsAuthenticated]


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
        """Current-status counts for the Medical Claim Dashboard.

        Same shape as Motor Claim's /stats/ — six fields covering an Overview
        group (opened / pending / closed) and a Breakdown group (in_progress
        / resolved / rejected). All counts are based on the row's CURRENT
        status, not the cumulative lifecycle path.
        """
        queryset = self.get_queryset()

        # Apply only date filters (user_id already handled by get_queryset RBAC logic)
        date_params = {k: v for k, v in request.query_params.items() if k in ('date_from', 'date_to')}
        filterset = self.filterset_class(date_params, queryset=queryset)
        queryset = filterset.qs

        counts = dict(queryset.values_list('status').annotate(n=Count('id')))
        opened = counts.get('claims_opened', 0)
        in_progress = counts.get('claims_in_progress', 0)
        resolved = counts.get('claims_resolved', 0)
        rejected = counts.get('claims_rejected', 0)

        return Response({
            'claims_opened': opened + in_progress + resolved + rejected,
            'claims_pending': opened + in_progress,
            'claims_closed': resolved + rejected,
            'claims_in_progress': in_progress,
            'claims_resolved': resolved,
            'claims_rejected': rejected,
        })


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
    filter_backends = [DjangoFilterBackend, filters.SearchFilter]
    filterset_fields = ['is_active']
    search_fields = ['name']

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


class ClassOfInsuranceViewSet(_LookupViewSet):
    queryset = ClassOfInsurance.objects.all()
    serializer_class = ClassOfInsuranceSerializer


# ─── Cross-module per-entry comments ──────────────────────────────────────────

# Lowercase model names of the entry types that support remarks. Matches
# Django ContentType.model values. Marine / Medical Claim are intentionally
# excluded — they don't currently expose a remarks workflow.
ALLOWED_REMARK_MODELS = {
    'generalnewentry', 'generalrenewalentry',
    'motornewentry', 'motorrenewalentry',
    'motorfleetnewentry', 'motorfleetrenewalentry',
    'motorclaimentry',
    'saleskpientry',
}


class EntryRemarkViewSet(viewsets.ModelViewSet):
    """CRUD for EntryRemark. List requires a (content_type, object_id) filter
    so callers always scope to one entry. Only the comment's author can edit
    or delete it — admins do not get an override.
    """
    queryset = EntryRemark.objects.select_related('author', 'content_type').all()
    serializer_class = EntryRemarkSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        qs = super().get_queryset()
        if self.action == 'list':
            ct_id = self.request.query_params.get('content_type')
            obj_id = self.request.query_params.get('object_id')
            if not (ct_id and obj_id):
                return qs.none()
            qs = qs.filter(content_type_id=ct_id, object_id=obj_id)
        return qs

    def perform_create(self, serializer):
        ct = serializer.validated_data['content_type']
        if ct.model not in ALLOWED_REMARK_MODELS:
            raise drf_serializers.ValidationError(
                {'content_type': 'Remarks are not supported on this model.'}
            )
        if not ct.model_class().objects.filter(pk=serializer.validated_data['object_id']).exists():
            raise drf_serializers.ValidationError(
                {'object_id': 'Referenced entry does not exist.'}
            )
        serializer.save(author=self.request.user)

    def update(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.author_id != request.user.id:
            return Response(
                {'error': 'Only the author can edit a comment.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().update(request, *args, **kwargs)

    def destroy(self, request, *args, **kwargs):
        instance = self.get_object()
        if instance.author_id != request.user.id:
            return Response(
                {'error': 'Only the author can delete a comment.'},
                status=status.HTTP_403_FORBIDDEN,
            )
        return super().destroy(request, *args, **kwargs)


@api_view(['GET'])
@permission_classes([IsAuthenticated])
def remarks_content_types(request):
    """Return {model_name: content_type_id} for the 7 modules that support
    remarks. The frontend hits this once on mount and caches the map, so
    page code doesn't need to hard-code ContentType ids.
    """
    cts = ContentType.objects.filter(app_label='entries', model__in=ALLOWED_REMARK_MODELS)
    return Response({ct.model: ct.id for ct in cts})
