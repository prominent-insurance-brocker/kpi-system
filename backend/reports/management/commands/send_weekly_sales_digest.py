"""Sales Weekly Digest dispatcher (TED-567).

Run frequently by django-crontab (see CRONJOBS / WEEKLY_SALES_DIGEST_DISPATCH_CRON,
default every 15 min). Each run sends the reports whose *effective* schedule
(per-report override, else the global ReportSetting default) is due for the
current week and that haven't been sent yet (``ReportSendLog`` guard). Metrics
are computed only when at least one report is due.

Flags:
  --force       send all active reports now, ignoring schedule + already-sent.
  --report-id   restrict to a single report.
  --dry-run     log what would be sent without sending.

The per-recipient send + idempotency logging lives in ``reports.delivery`` so
the on-demand ``send_now`` API action shares the same behaviour.
"""
from django.core.management.base import BaseCommand
from django.utils import timezone

from reports.delivery import deliver_sales_weekly_digest
from reports.models import Report, ReportSendLog, ReportSetting
from reports.scheduling import is_due, reporting_week_start
from reports.services.sales_weekly_digest import SalesWeeklyDigestService


class Command(BaseCommand):
    help = 'Dispatches the Sales Weekly Digest to reports that are due.'

    def add_arguments(self, parser):
        parser.add_argument(
            '--dry-run', action='store_true',
            help='Log what would be sent without sending.',
        )
        parser.add_argument(
            '--force', action='store_true',
            help='Send all active reports now, ignoring schedule + already-sent.',
        )
        parser.add_argument(
            '--report-id', type=int, default=None,
            help='Only process the report with this id.',
        )

    def handle(self, *args, **options):
        dry_run = options['dry_run']
        force = options['force']
        report_id = options['report_id']

        reports = Report.objects.filter(
            is_active=True, report_type=Report.REPORT_TYPE_SALES_WEEKLY,
        )
        if report_id is not None:
            reports = reports.filter(pk=report_id)
        reports = list(reports)
        if not reports:
            self.stdout.write(self.style.WARNING('No active Sales Weekly Digest reports.'))
            return

        setting = ReportSetting.load()
        now = timezone.localtime()
        week_start = reporting_week_start(now.date())

        # Decide which reports to send this run (cheap checks, no metrics yet).
        pending = []
        for report in reports:
            recipients = [e for e in (report.recipients or []) if e]
            if not recipients:
                continue
            if force:
                pending.append(report)
                continue
            if not is_due(report, setting, now):
                continue
            if ReportSendLog.objects.filter(report=report, week_start=week_start).exists():
                continue
            pending.append(report)

        if not pending:
            self.stdout.write('No reports due this run.')
            return

        # Build the digest once — shared by every due report for this week.
        metrics = SalesWeeklyDigestService().build()
        self.stdout.write(
            f"Sales Weekly Digest for {metrics['week_label']} "
            f"(dry_run={dry_run}, force={force}, due={len(pending)})"
        )

        for report in pending:
            if dry_run:
                for email in [e for e in report.recipients if e]:
                    self.stdout.write(f"  [DRY RUN] Would send '{report.name}' to {email}")
                continue

            sent, failed = deliver_sales_weekly_digest(report, metrics)
            for email in failed:
                self.stderr.write(self.style.ERROR(f"  FAILED: {email}"))
            if sent == 0:
                self.stderr.write(self.style.ERROR(
                    f"  '{report.name}': all {len(failed)} send(s) failed — "
                    "not recorded; will retry on the next run."
                ))
                continue
            style = self.style.SUCCESS if not failed else self.style.WARNING
            self.stdout.write(style(
                f"  '{report.name}': sent {sent}, failed {len(failed)}"
            ))
