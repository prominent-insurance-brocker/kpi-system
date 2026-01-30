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
    tat = models.PositiveIntegerField(verbose_name='TAT')
    accuracy = models.DecimalField(max_digits=5, decimal_places=2)

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
    registered_claims = models.PositiveIntegerField()
    claims_closed = models.PositiveIntegerField()
    pending_cases = models.PositiveIntegerField()
    tat = models.PositiveIntegerField(verbose_name='TAT')

    class Meta(BaseEntry.Meta):
        verbose_name = 'Motor Claim Entry'
        verbose_name_plural = 'Motor Claim Entries'

    def __str__(self):
        return f"Motor Claim - {self.date} by {self.added_by}"


class SalesPremiumDataEntry(BaseEntry):
    """Sales Premium Data module entry."""
    gross_booked_premium = models.DecimalField(max_digits=15, decimal_places=2)
    target = models.DecimalField(max_digits=15, decimal_places=2)

    class Meta(BaseEntry.Meta):
        verbose_name = 'Sales Premium Data Entry'
        verbose_name_plural = 'Sales Premium Data Entries'

    def __str__(self):
        return f"Sales Premium Data - {self.date} by {self.added_by}"


class SalesKPIEntry(BaseEntry):
    """Sales KPI module entry."""
    leads_to_ops_team = models.PositiveIntegerField()
    quotes_from_ops_team = models.PositiveIntegerField()
    quotes_to_client = models.PositiveIntegerField()
    total_conversions = models.PositiveIntegerField()
    existing_clients = models.PositiveIntegerField()
    existing_clients_closed = models.PositiveIntegerField()
    new_clients_acquired = models.PositiveIntegerField()

    class Meta(BaseEntry.Meta):
        verbose_name = 'Sales KPI Entry'
        verbose_name_plural = 'Sales KPI Entries'

    def __str__(self):
        return f"Sales KPI - {self.date} by {self.added_by}"
