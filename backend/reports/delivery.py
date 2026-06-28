"""Shared delivery + audit logging of the Sales Weekly Digest (TED-567).

Single code path used by the weekly dispatcher command and the on-demand
``send_now`` API action. Every send records an append-only ``ReportSendEvent``
(the History tab) with per-recipient results, plus the once-per-week
``ReportSendLog`` idempotency row when at least one email succeeds.
"""
import logging

from django.utils import timezone

from .emails import SALES_WEEKLY_DIGEST_SUBJECT, send_sales_weekly_digest
from .models import ReportSendEvent, ReportSendLog

logger = logging.getLogger(__name__)


def record_send_event(report, *, trigger, triggered_by, week_label, results):
    """Append a ReportSendEvent from per-recipient ``results``.

    ``results`` is a list of ``(email, ok, error)`` tuples.
    """
    return ReportSendEvent.objects.create(
        report=report,
        trigger=trigger,
        triggered_by=triggered_by,
        week_label=week_label or '',
        subject=report.subject or SALES_WEEKLY_DIGEST_SUBJECT,
        recipients=[{'email': e, 'ok': ok, 'error': err} for e, ok, err in results],
        sent_count=sum(1 for _, ok, _ in results if ok),
        failed_count=sum(1 for _, ok, _ in results if not ok),
    )


def deliver_sales_weekly_digest(report, metrics, *, trigger, triggered_by=None):
    """Send the digest to a report's recipients; log per-recipient results.

    Per-recipient error isolation. Always records a ReportSendEvent (audit
    history). When at least one email succeeds, records ``last_sent_at`` + a
    ``ReportSendLog`` row for the week (a total failure is left un-recorded so
    it can be retried). Returns ``(sent_count, failed_emails)``.
    """
    recipients = [e for e in (report.recipients or []) if e]
    results = []
    for email in recipients:
        try:
            send_sales_weekly_digest(metrics, email, report.subject)
            results.append((email, True, ''))
        except Exception as exc:  # noqa: BLE001 - isolate per recipient
            logger.error("Failed to send Sales Weekly Digest to %s: %s", email, exc)
            results.append((email, False, str(exc)))

    sent = sum(1 for _, ok, _ in results if ok)
    failed = [e for e, ok, _ in results if not ok]

    record_send_event(
        report, trigger=trigger, triggered_by=triggered_by,
        week_label=metrics.get('week_label', ''), results=results,
    )

    if sent > 0:
        report.last_sent_at = timezone.now()
        report.save(update_fields=['last_sent_at', 'updated_at'])
        ReportSendLog.objects.update_or_create(
            report=report,
            week_start=metrics['week_start'],
            defaults={
                'recipient_count': sent,
                'status': (
                    ReportSendLog.STATUS_SENT if not failed
                    else ReportSendLog.STATUS_FAILED
                ),
            },
        )
    return sent, failed
