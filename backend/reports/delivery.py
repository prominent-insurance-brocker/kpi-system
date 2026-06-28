"""Shared delivery of the Sales Weekly Digest to a report's recipients (TED-567).

Single code path used by BOTH the weekly cron command
(``send_weekly_sales_digest``) and the on-demand ``send_now`` API action, so the
send + idempotency-logging behaviour can never drift between them.
"""
import logging

from django.utils import timezone

from .emails import send_sales_weekly_digest
from .models import ReportSendLog

logger = logging.getLogger(__name__)


def deliver_sales_weekly_digest(report, metrics, *, dry_run=False):
    """Send ``metrics`` to ``report``'s configured recipients (one email each).

    Per-recipient error isolation: one bad address never blocks the rest. On a
    real (non-dry-run) send it records ``last_sent_at`` + a ``ReportSendLog``
    row for the week — but ONLY when at least one email succeeded, so a total
    failure (e.g. SMTP down) is left un-recorded and can be retried rather than
    marked permanently done.

    Returns ``(sent_count, failed_emails)``.
    """
    recipients = [e for e in (report.recipients or []) if e]
    sent = 0
    failed = []
    for email in recipients:
        if dry_run:
            sent += 1
            continue
        try:
            send_sales_weekly_digest(metrics, email, report.subject)
            sent += 1
        except Exception as exc:  # noqa: BLE001 - isolate per recipient
            failed.append(email)
            logger.error("Failed to send Sales Weekly Digest to %s: %s", email, exc)

    if dry_run or sent == 0:
        return sent, failed

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
