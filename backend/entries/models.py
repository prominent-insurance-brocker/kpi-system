from django.db import models
from django.conf import settings
from django.utils import timezone
from datetime import timedelta


class BaseEntry(models.Model):
    """Abstract base class for all KPI entries."""
    date = models.DateField()
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='%(class)s_entries'
    )
    added_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        ordering = ['-date', '-added_at']

    def is_editable(self):
        """Check if entry is within 30-minute edit window."""
        cutoff = self.added_at + timedelta(minutes=30)
        return timezone.now() <= cutoff

    def can_edit(self, user):
        """Check if user can edit this entry."""
        return self.added_by == user and self.is_editable()


class GeneralNewEntry(BaseEntry):
    """General New module entry."""
    quotations = models.PositiveIntegerField()
    quotes_revised = models.PositiveIntegerField()
    quotes_converted = models.PositiveIntegerField()
    tat = models.PositiveIntegerField(verbose_name='TAT', null=True, blank=True)
    accuracy = models.DecimalField(max_digits=5, decimal_places=2, null=True, blank=True)

    class Meta(BaseEntry.Meta):
        verbose_name = 'General New Entry'
        verbose_name_plural = 'General New Entries'

    def __str__(self):
        return f"General New - {self.date} by {self.added_by}"


class GeneralRenewalEntry(BaseEntry):
    """General Renewal module entry."""
    quotations = models.PositiveIntegerField()
    quotes_revised = models.PositiveIntegerField()
    quotes_converted = models.PositiveIntegerField()
    tat = models.PositiveIntegerField(verbose_name='TAT')
    accuracy = models.DecimalField(max_digits=5, decimal_places=2)

    class Meta(BaseEntry.Meta):
        verbose_name = 'General Renewal Entry'
        verbose_name_plural = 'General Renewal Entries'

    def __str__(self):
        return f"General Renewal - {self.date} by {self.added_by}"


class MotorNewEntry(BaseEntry):
    """Motor New module entry."""
    quotations = models.PositiveIntegerField()
    quotes_revised = models.PositiveIntegerField()
    tat = models.PositiveIntegerField(verbose_name='TAT')
    accuracy = models.DecimalField(max_digits=5, decimal_places=2)

    class Meta(BaseEntry.Meta):
        verbose_name = 'Motor New Entry'
        verbose_name_plural = 'Motor New Entries'

    def __str__(self):
        return f"Motor New - {self.date} by {self.added_by}"


class MotorRenewalEntry(BaseEntry):
    """Motor Renewal module entry."""
    quotations = models.PositiveIntegerField()
    retention = models.PositiveIntegerField()
    tat = models.PositiveIntegerField(verbose_name='TAT')
    accuracy = models.DecimalField(max_digits=5, decimal_places=2)

    class Meta(BaseEntry.Meta):
        verbose_name = 'Motor Renewal Entry'
        verbose_name_plural = 'Motor Renewal Entries'

    def __str__(self):
        return f"Motor Renewal - {self.date} by {self.added_by}"


class MotorClaimEntry(BaseEntry):
    """Motor Claim module entry."""
    STATUS_CHOICES = [
        ('claims_opened', 'Claims Opened'),
        ('claims_pending', 'Claims Pending'),
        ('claims_resolved', 'Claims Resolved'),
        ('claims_rejected', 'Claims Rejected'),
    ]

    TERMINAL_STATUSES = {'claims_resolved', 'claims_rejected'}

    TRANSITIONS = {
        'claims_opened': ['claims_pending'],
        'claims_pending': ['claims_resolved', 'claims_rejected'],
        'claims_resolved': [],
        'claims_rejected': [],
    }

    customer_name = models.CharField(max_length=255)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES)

    class Meta(BaseEntry.Meta):
        verbose_name = 'Motor Claim Entry'
        verbose_name_plural = 'Motor Claim Entries'

    def __str__(self):
        return f"Motor Claim - {self.date} by {self.added_by}"

    @classmethod
    def get_allowed_transitions(cls, current_status):
        return cls.TRANSITIONS.get(current_status, [])

    @property
    def is_terminal(self):
        return self.status in self.TERMINAL_STATUSES

    def get_tat(self):
        """Calculate turnaround time from creation to terminal status."""
        if not self.is_terminal:
            return None
        terminal_transition = self.status_transitions.filter(
            to_status__in=self.TERMINAL_STATUSES
        ).first()
        if terminal_transition:
            return terminal_transition.changed_at - self.added_at
        return None

    def get_tat_display(self):
        """Return TAT as 'Xd Yh Zm' or 'In progress'."""
        delta = self.get_tat()
        if delta is None:
            return 'In progress'
        total_seconds = int(delta.total_seconds())
        days = total_seconds // 86400
        hours = (total_seconds % 86400) // 3600
        minutes = (total_seconds % 3600) // 60
        seconds = total_seconds % 60
        if days > 0:
            return f"{days}d {hours}h {minutes}m"
        if hours > 0:
            return f"{hours}h {minutes}m"
        if minutes > 0:
            return f"{minutes}m {seconds}s"
        return f"{seconds}s"


class MotorClaimStatusTransition(models.Model):
    """Records each status change for a motor claim entry."""
    entry = models.ForeignKey(
        MotorClaimEntry,
        on_delete=models.CASCADE,
        related_name='status_transitions'
    )
    from_status = models.CharField(
        max_length=20, choices=MotorClaimEntry.STATUS_CHOICES, blank=True
    )
    to_status = models.CharField(
        max_length=20, choices=MotorClaimEntry.STATUS_CHOICES
    )
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='motor_claim_status_changes'
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['changed_at']

    def __str__(self):
        return f"{self.entry_id}: {self.from_status} -> {self.to_status}"


class SalesKPIEntry(BaseEntry):
    """Sales KPI module entry."""
    leads_to_ops_team = models.PositiveIntegerField()
    quotes_from_ops_team = models.PositiveIntegerField()
    quotes_to_client = models.PositiveIntegerField()
    total_conversions = models.PositiveIntegerField()
    new_clients_acquired = models.PositiveIntegerField()
    gross_booked_premium = models.DecimalField(max_digits=15, decimal_places=2)

    class Meta(BaseEntry.Meta):
        verbose_name = 'Sales KPI Entry'
        verbose_name_plural = 'Sales KPI Entries'

    def __str__(self):
        return f"Sales KPI - {self.date} by {self.added_by}"


class SalesMonthlyTarget(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='sales_monthly_targets'
    )
    year = models.PositiveIntegerField()
    month = models.PositiveIntegerField()
    premium_target = models.PositiveIntegerField(null=True, blank=True)
    clients_assigned = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'year', 'month')

    def __str__(self):
        return f"Sales Target {self.year}/{self.month} - {self.user}"


class MarineNewEntry(BaseEntry):
    """Marine New module entry."""
    gross_booked_premium = models.DecimalField(max_digits=15, decimal_places=2)
    quotes_created = models.PositiveIntegerField()
    new_clients_acquired = models.PositiveIntegerField()
    new_policies_issued = models.PositiveIntegerField()

    class Meta(BaseEntry.Meta):
        verbose_name = 'Marine New Entry'
        verbose_name_plural = 'Marine New Entries'

    def __str__(self):
        return f"Marine New - {self.date} by {self.added_by}"


class MarineRenewalEntry(BaseEntry):
    """Marine Renewal module entry."""
    monthly_renewal_quotes_assigned = models.PositiveIntegerField()
    gross_booked_premium = models.DecimalField(max_digits=15, decimal_places=2)
    quotes_created = models.PositiveIntegerField()
    renewal_policies_issued = models.PositiveIntegerField()

    class Meta(BaseEntry.Meta):
        verbose_name = 'Marine Renewal Entry'
        verbose_name_plural = 'Marine Renewal Entries'

    def __str__(self):
        return f"Marine Renewal - {self.date} by {self.added_by}"


class MedicalClaimEntry(BaseEntry):
    """Medical Claim module entry."""
    STATUS_CHOICES = [
        ('claims_opened', 'Claims Opened'),
        ('claims_pending', 'Claims Pending'),
        ('claims_resolved', 'Claims Resolved'),
        ('claims_rejected', 'Claims Rejected'),
    ]

    TERMINAL_STATUSES = {'claims_resolved', 'claims_rejected'}

    TRANSITIONS = {
        'claims_opened': ['claims_pending'],
        'claims_pending': ['claims_resolved', 'claims_rejected'],
        'claims_resolved': [],
        'claims_rejected': [],
    }

    customer_name = models.CharField(max_length=255)
    status = models.CharField(max_length=20, choices=STATUS_CHOICES)

    class Meta(BaseEntry.Meta):
        verbose_name = 'Medical Claim Entry'
        verbose_name_plural = 'Medical Claim Entries'

    def __str__(self):
        return f"Medical Claim - {self.date} by {self.added_by}"

    @classmethod
    def get_allowed_transitions(cls, current_status):
        return cls.TRANSITIONS.get(current_status, [])

    @property
    def is_terminal(self):
        return self.status in self.TERMINAL_STATUSES

    def get_tat(self):
        """Calculate turnaround time from creation to terminal status."""
        if not self.is_terminal:
            return None
        terminal_transition = self.status_transitions.filter(
            to_status__in=self.TERMINAL_STATUSES
        ).first()
        if terminal_transition:
            return terminal_transition.changed_at - self.added_at
        return None

    def get_tat_display(self):
        """Return TAT as 'Xd Yh Zm' or 'In progress'."""
        delta = self.get_tat()
        if delta is None:
            return 'In progress'
        total_seconds = int(delta.total_seconds())
        days = total_seconds // 86400
        hours = (total_seconds % 86400) // 3600
        minutes = (total_seconds % 3600) // 60
        seconds = total_seconds % 60
        if days > 0:
            return f"{days}d {hours}h {minutes}m"
        if hours > 0:
            return f"{hours}h {minutes}m"
        if minutes > 0:
            return f"{minutes}m {seconds}s"
        return f"{seconds}s"


class MedicalClaimStatusTransition(models.Model):
    """Records each status change for a medical claim entry."""
    entry = models.ForeignKey(
        MedicalClaimEntry,
        on_delete=models.CASCADE,
        related_name='status_transitions'
    )
    from_status = models.CharField(
        max_length=20, choices=MedicalClaimEntry.STATUS_CHOICES, blank=True
    )
    to_status = models.CharField(
        max_length=20, choices=MedicalClaimEntry.STATUS_CHOICES
    )
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='medical_claim_status_changes'
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['changed_at']

    def __str__(self):
        return f"{self.entry_id}: {self.from_status} -> {self.to_status}"
