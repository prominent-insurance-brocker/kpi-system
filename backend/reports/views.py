import logging

from rest_framework import generics, status, viewsets
from rest_framework.decorators import action
from rest_framework.response import Response

from roles.permissions import IsAdminUser

from .delivery import deliver_sales_weekly_digest
from .emails import send_sales_weekly_digest
from .models import Report, ReportSetting
from .serializers import ReportSerializer, ReportSettingSerializer
from .services.sales_weekly_digest import SalesWeeklyDigestService

logger = logging.getLogger(__name__)


class ReportSettingView(generics.RetrieveUpdateAPIView):
    """Global default send schedule (singleton) — admin-only GET / PATCH."""
    serializer_class = ReportSettingSerializer
    permission_classes = [IsAdminUser]

    def get_object(self):
        return ReportSetting.load()


class ReportViewSet(viewsets.ModelViewSet):
    """Admin-only CRUD for configured auto-email reports (TED-567)."""
    queryset = Report.objects.all().order_by('id')
    serializer_class = ReportSerializer
    permission_classes = [IsAdminUser]

    def perform_create(self, serializer):
        serializer.save(created_by=self.request.user)

    @action(detail=True, methods=['post'])
    def activate(self, request, pk=None):
        report = self.get_object()
        report.is_active = True
        report.save(update_fields=['is_active', 'updated_at'])
        return Response({'message': 'Report activated'})

    @action(detail=True, methods=['post'])
    def deactivate(self, request, pk=None):
        report = self.get_object()
        report.is_active = False
        report.save(update_fields=['is_active', 'updated_at'])
        return Response({'message': 'Report deactivated'})

    @action(detail=True, methods=['post'])
    def send_test(self, request, pk=None):
        """Send the digest only to the requesting admin, against live data.

        Lets an admin preview the real rendered email on demand without waiting
        for the weekly cron or emailing the configured recipient list.
        """
        report = self.get_object()
        recipient = request.user.email
        if not recipient:
            return Response(
                {'error': 'Your account has no email address.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            metrics = SalesWeeklyDigestService().build()
            send_sales_weekly_digest(metrics, recipient, report.subject)
        except Exception as exc:  # noqa: BLE001 - surface SMTP/render failures
            logger.error("send_test failed for %s: %s", recipient, exc)
            return Response(
                {'error': f'Failed to send test email: {exc}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        return Response({'message': f'Test digest sent to {recipient}'})

    @action(detail=True, methods=['post'])
    def send_now(self, request, pk=None):
        """Send the digest to the report's configured recipients immediately.

        Unlike ``send_test`` (which emails only the requesting admin), this is an
        on-demand override of the weekly cron — it delivers to the real recipient
        list right now and records the send (``last_sent_at`` + ``ReportSendLog``).
        """
        report = self.get_object()
        recipients = [e for e in (report.recipients or []) if e]
        if not recipients:
            return Response(
                {'error': 'This report has no recipients.'},
                status=status.HTTP_400_BAD_REQUEST,
            )
        try:
            metrics = SalesWeeklyDigestService().build()
            sent, failed = deliver_sales_weekly_digest(report, metrics)
        except Exception as exc:  # noqa: BLE001 - surface render/SMTP failures
            logger.error("send_now failed for report %s: %s", report.id, exc)
            return Response(
                {'error': f'Failed to send: {exc}'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        if sent == 0:
            return Response(
                {'error': f'All {len(failed)} send(s) failed.'},
                status=status.HTTP_502_BAD_GATEWAY,
            )
        message = f"Sent to {sent} recipient{'' if sent == 1 else 's'}"
        if failed:
            message += f" ({len(failed)} failed)"
        return Response({'message': message, 'sent': sent, 'failed': failed})
