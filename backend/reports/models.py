from datetime import time

from django.conf import settings
from django.db import models


class Report(models.Model):
    """A configurable auto-email report (TED-567).

    Only the Sales Weekly Digest exists today; ``report_type`` keeps the table
    extensible for future digests. A row stores *who* receives the digest and
    *whether* it is active — the schedule itself is a fixed weekly cron
    (``send_weekly_sales_digest``), not configured per-row, matching the
    ticket's table columns (ID, Name, Email List, Status, Activate/Deactivate).
    """
    REPORT_TYPE_SALES_WEEKLY = 'sales_weekly_digest'
    REPORT_TYPE_CHOICES = [
        (REPORT_TYPE_SALES_WEEKLY, 'Sales Weekly Digest'),
    ]

    name = models.CharField(max_length=200)
    # Per-report email subject line. Defaults to the ticket's system-generated
    # subject; a blank value falls back to that default at send time.
    subject = models.CharField(
        max_length=255,
        blank=True,
        default='Sales Weekly Digest - System Generated',
    )
    report_type = models.CharField(
        max_length=50,
        choices=REPORT_TYPE_CHOICES,
        default=REPORT_TYPE_SALES_WEEKLY,
    )
    # list[str] of recipient email addresses — the "Email List" column.
    recipients = models.JSONField(default=list, blank=True)
    # New configs start inactive so a freshly-created row never auto-emails
    # anyone until an admin explicitly Activates it (zero production impact).
    is_active = models.BooleanField(default=False)
    # Per-report schedule override. NULL on a field falls back to the global
    # ReportSetting default. weekday: 0=Monday .. 6=Sunday.
    send_weekday = models.PositiveSmallIntegerField(null=True, blank=True)
    send_time = models.TimeField(null=True, blank=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='reports_created',
    )
    last_sent_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['id']

    def __str__(self):
        return f"{self.name} ({self.get_report_type_display()})"


class ReportSendLog(models.Model):
    """Idempotency guard: at most one successful send per (report, week_start).

    Protects against a cron double-fire (e.g. a duplicate crontab registration
    on redeploy) re-emailing the same weekly digest. The management command
    skips any report whose (report, week_start) row already exists unless
    ``--force`` is passed.
    """
    STATUS_SENT = 'sent'
    STATUS_FAILED = 'failed'
    STATUS_SKIPPED = 'skipped'

    report = models.ForeignKey(
        Report,
        on_delete=models.CASCADE,
        related_name='send_logs',
    )
    # Monday of the reported week, in Dubai local time.
    week_start = models.DateField()
    sent_at = models.DateTimeField(auto_now_add=True)
    recipient_count = models.PositiveIntegerField(default=0)
    status = models.CharField(max_length=20, default=STATUS_SENT)

    class Meta:
        ordering = ['-sent_at']
        unique_together = ('report', 'week_start')

    def __str__(self):
        return f"{self.report_id} @ {self.week_start} ({self.status})"


class ReportSetting(models.Model):
    """Singleton holding the global default send schedule for reports (TED-567).

    A report uses these defaults unless it overrides ``send_weekday`` /
    ``send_time``. Admins can edit the defaults from the UI.
    """
    default_send_weekday = models.PositiveSmallIntegerField(default=0)  # Monday
    default_send_time = models.TimeField(default=time(6, 0))            # 06:00 local

    class Meta:
        verbose_name = 'Report setting'

    def save(self, *args, **kwargs):
        self.pk = 1  # enforce a single row
        super().save(*args, **kwargs)

    @classmethod
    def load(cls):
        obj, _ = cls.objects.get_or_create(pk=1)
        return obj

    def __str__(self):
        return f"Default send: weekday={self.default_send_weekday} at {self.default_send_time}"
