from decimal import Decimal

from django.db import models, transaction
from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType  # noqa: F401  (re-exported for callers)
from django.utils import timezone
from datetime import timedelta


# Fixed-choice dropdowns shared across the general / motor enquiry modules.
# Kept as CharField choices (not a lookup table) because the list is short
# and stable; flip to FKs later if admins need to manage them themselves.
GENERAL_CLASS_OF_INSURANCE_CHOICES = [
    ('property_all_risk', 'Property All Risk Insurance'),
    ('marine_cargo', 'Marine Cargo Insurance'),
    ('trade_credit', 'Trade Credit Insurance'),
    ('professional_indemnity', 'Professional Indemnity Insurance'),
    ('public_liability', 'Public Liability Insurance'),
]

MOTOR_CLASS_OF_ENQUIRY_CHOICES = [
    ('comprehensive', 'Comprehensive'),
    ('tpl', 'TPL'),
]


class PIBSequence(models.Model):
    """Per-module counter that hands out PIB ids. Each entry module has its
    own row keyed by `module` (the concrete model's lowercase class name —
    e.g. 'motornewentry', 'generalrenewalentry'). PIB ids restart at 1 inside
    each module, so 'PIB-1' is module-local rather than globally unique.

    Atomic via select_for_update — safe under concurrency.
    """
    module = models.CharField(max_length=50, unique=True)
    last_number = models.PositiveBigIntegerField(default=0)

    @classmethod
    def next_value(cls, module):
        with transaction.atomic():
            seq, _ = cls.objects.select_for_update().get_or_create(module=module)
            seq.last_number += 1
            seq.save(update_fields=['last_number'])
            return seq.last_number


class BaseEntry(models.Model):
    """Abstract base class for all KPI entries."""
    # Human-readable id (PIB-1, PIB-2, ...) assigned on first save from
    # PIBSequence. Restarts at 1 in each module — see PIBSequence docstring.
    pib_id = models.CharField(max_length=20, db_index=True, blank=True, default='')
    date = models.DateField()
    added_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='%(class)s_entries'
    )
    on_behalf_of = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='%(class)s_on_behalf_entries',
        null=True,
        blank=True,
    )
    added_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        abstract = True
        ordering = ['-date', '-added_at']

    def save(self, *args, **kwargs):
        if not self.pib_id:
            # Each concrete subclass gets its own counter via `model_name`
            # (e.g. 'motornewentry') so PIB ids restart at 1 per module.
            self.pib_id = f"PIB-{PIBSequence.next_value(self._meta.model_name)}"
        super().save(*args, **kwargs)

    @property
    def owner(self):
        """The effective record owner — on_behalf_of if set, else added_by."""
        return self.on_behalf_of or self.added_by

    def is_editable(self):
        """Check if entry is within 30-minute edit window."""
        cutoff = self.added_at + timedelta(minutes=30)
        return timezone.now() <= cutoff

    def can_edit(self, user):
        """Check if user can edit this entry."""
        return self.added_by == user and self.is_editable()


class GeneralNewEntry(BaseEntry):
    """General New enquiry — one row per customer enquiry with status state machine.

    Mirrors MotorNewEntry's shape but without the motor-specific chassis number
    (general insurance products have no chassis).
    """
    STATUS_NEW = 'new'
    STATUS_CONVERTED = 'converted'
    STATUS_LOST = 'lost'

    STATUS_CHOICES = [
        (STATUS_NEW, 'New Enquiry'),
        (STATUS_CONVERTED, 'Converted'),
        (STATUS_LOST, 'Lost'),
    ]

    TERMINAL_STATUSES = {STATUS_CONVERTED, STATUS_LOST}

    TRANSITIONS = {
        STATUS_NEW: [STATUS_CONVERTED, STATUS_LOST],
        STATUS_CONVERTED: [],
        STATUS_LOST: [],
    }

    ACCURACY_DECAY = Decimal('0.9')

    client_name = models.CharField(max_length=200)
    agent = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='general_new_enquiries_as_agent',
    )
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default=STATUS_NEW
    )
    revisions = models.PositiveIntegerField(default=0)
    quotes_compared = models.PositiveIntegerField(default=0)
    status_changed_at = models.DateTimeField(null=True, blank=True)
    potential_premium = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
    )
    # Captured at the moment the enquiry closes as Converted via the
    # update-status flow (TED-440). NULL when not yet closed or closed as Lost.
    converted_premium = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
    )
    class_of_insurance = models.ForeignKey(
        'ClassOfInsurance',
        on_delete=models.PROTECT,
        related_name='%(class)s_entries',
        null=True, blank=True,
    )
    insurance_company = models.ForeignKey(
        'InsuranceCompany',
        on_delete=models.PROTECT,
        related_name='general_new_entries',
        null=True, blank=True,
    )

    class Meta(BaseEntry.Meta):
        verbose_name = 'General New Entry'
        verbose_name_plural = 'General New Entries'

    def __str__(self):
        return f"General New Enquiry - {self.client_name} ({self.status})"

    @classmethod
    def get_allowed_transitions(cls, current_status):
        return cls.TRANSITIONS.get(current_status, [])

    @property
    def is_terminal(self):
        return self.status in self.TERMINAL_STATUSES

    def get_tat(self):
        if not self.is_terminal or self.status_changed_at is None:
            return None
        return self.status_changed_at - self.added_at

    def get_tat_display(self):
        delta = self.get_tat()
        if delta is None:
            return '—'
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

    @property
    def accuracy_pct(self):
        if not self.is_terminal:
            return None
        return float(Decimal('100') * (self.ACCURACY_DECAY ** self.revisions))


class GeneralNewStatusTransition(models.Model):
    """Records each status change for a general new enquiry."""
    entry = models.ForeignKey(
        GeneralNewEntry,
        on_delete=models.CASCADE,
        related_name='status_transitions',
    )
    from_status = models.CharField(
        max_length=20, choices=GeneralNewEntry.STATUS_CHOICES, blank=True
    )
    to_status = models.CharField(
        max_length=20, choices=GeneralNewEntry.STATUS_CHOICES
    )
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='general_new_status_changes',
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['changed_at']

    def __str__(self):
        return f"{self.entry_id}: {self.from_status} -> {self.to_status}"


class GeneralRenewalEntry(BaseEntry):
    """General Renewal enquiry — one row per renewal opportunity with status state machine.

    Mirrors MotorRenewalEntry's shape but without the motor-specific chassis
    number (general insurance products have no chassis).
    """
    STATUS_NEW = 'new'
    STATUS_RETAINED = 'retained'
    STATUS_LOST = 'lost'

    STATUS_CHOICES = [
        (STATUS_NEW, 'New Enquiry'),
        (STATUS_RETAINED, 'Retained'),
        (STATUS_LOST, 'Lost'),
    ]

    TERMINAL_STATUSES = {STATUS_RETAINED, STATUS_LOST}

    TRANSITIONS = {
        STATUS_NEW: [STATUS_RETAINED, STATUS_LOST],
        STATUS_RETAINED: [],
        STATUS_LOST: [],
    }

    ACCURACY_DECAY = Decimal('0.9')

    client_name = models.CharField(max_length=200)
    agent = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='general_renewal_enquiries_as_agent',
    )
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default=STATUS_NEW
    )
    revisions = models.PositiveIntegerField(default=0)
    quotes_compared = models.PositiveIntegerField(default=0)
    status_changed_at = models.DateTimeField(null=True, blank=True)
    potential_premium = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
    )
    # Captured at the moment the enquiry closes as Retained via the
    # update-status flow (TED-440). NULL when not yet closed or closed as Lost.
    converted_premium = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
    )
    class_of_insurance = models.ForeignKey(
        'ClassOfInsurance',
        on_delete=models.PROTECT,
        related_name='%(class)s_entries',
        null=True, blank=True,
    )
    insurance_company = models.ForeignKey(
        'InsuranceCompany',
        on_delete=models.PROTECT,
        related_name='general_renewal_entries',
        null=True, blank=True,
    )

    class Meta(BaseEntry.Meta):
        verbose_name = 'General Renewal Entry'
        verbose_name_plural = 'General Renewal Entries'

    def __str__(self):
        return f"General Renewal Enquiry - {self.client_name} ({self.status})"

    @classmethod
    def get_allowed_transitions(cls, current_status):
        return cls.TRANSITIONS.get(current_status, [])

    @property
    def is_terminal(self):
        return self.status in self.TERMINAL_STATUSES

    def get_tat(self):
        if not self.is_terminal or self.status_changed_at is None:
            return None
        return self.status_changed_at - self.added_at

    def get_tat_display(self):
        delta = self.get_tat()
        if delta is None:
            return '—'
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

    @property
    def accuracy_pct(self):
        if not self.is_terminal:
            return None
        return float(Decimal('100') * (self.ACCURACY_DECAY ** self.revisions))


class GeneralRenewalStatusTransition(models.Model):
    """Records each status change for a general renewal enquiry."""
    entry = models.ForeignKey(
        GeneralRenewalEntry,
        on_delete=models.CASCADE,
        related_name='status_transitions',
    )
    from_status = models.CharField(
        max_length=20, choices=GeneralRenewalEntry.STATUS_CHOICES, blank=True
    )
    to_status = models.CharField(
        max_length=20, choices=GeneralRenewalEntry.STATUS_CHOICES
    )
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='general_renewal_status_changes',
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['changed_at']

    def __str__(self):
        return f"{self.entry_id}: {self.from_status} -> {self.to_status}"


class GeneralRenewalMonthlyTarget(models.Model):
    """Per-user retention target for the general renewal module."""
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='general_renewal_monthly_targets',
    )
    year = models.PositiveIntegerField()
    month = models.PositiveIntegerField()
    calculated_date = models.DateField(db_index=True)
    clients_assigned = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'year', 'month')

    def save(self, *args, **kwargs):
        from datetime import date
        self.calculated_date = date(self.year, self.month, 1)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"General Renewal Target {self.year}/{self.month} - {self.user}"


class MotorNewEntry(BaseEntry):
    """Motor New enquiry — one row per customer enquiry with status state machine."""
    STATUS_NEW = 'new'
    STATUS_CONVERTED = 'converted'
    STATUS_LOST = 'lost'

    STATUS_CHOICES = [
        (STATUS_NEW, 'New Enquiry'),
        (STATUS_CONVERTED, 'Converted'),
        (STATUS_LOST, 'Lost'),
    ]

    TERMINAL_STATUSES = {STATUS_CONVERTED, STATUS_LOST}

    TRANSITIONS = {
        STATUS_NEW: [STATUS_CONVERTED, STATUS_LOST],
        STATUS_CONVERTED: [],
        STATUS_LOST: [],
    }

    ACCURACY_DECAY = Decimal('0.9')

    client_name = models.CharField(max_length=200)
    agent = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='motor_new_enquiries_as_agent',
    )
    chassis_no = models.CharField(max_length=100)
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default=STATUS_NEW
    )
    revisions = models.PositiveIntegerField(default=0)
    quotes_compared = models.PositiveIntegerField(default=0)
    status_changed_at = models.DateTimeField(null=True, blank=True)
    potential_premium = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
    )
    # Captured at the moment the enquiry closes as Converted via the
    # update-status flow (TED-440). NULL when not yet closed or closed as Lost.
    converted_premium = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
    )
    class_of_enquiry = models.CharField(
        max_length=20, choices=MOTOR_CLASS_OF_ENQUIRY_CHOICES,
        blank=True, default='',
    )
    insurance_company = models.ForeignKey(
        'InsuranceCompany',
        on_delete=models.PROTECT,
        related_name='motor_new_entries',
        null=True, blank=True,
    )

    class Meta(BaseEntry.Meta):
        verbose_name = 'Motor New Entry'
        verbose_name_plural = 'Motor New Entries'

    def __str__(self):
        return f"Motor New Enquiry - {self.client_name} ({self.status})"

    @classmethod
    def get_allowed_transitions(cls, current_status):
        return cls.TRANSITIONS.get(current_status, [])

    @property
    def is_terminal(self):
        return self.status in self.TERMINAL_STATUSES

    def get_tat(self):
        """TAT = status_changed_at - added_at, only when status is terminal."""
        if not self.is_terminal or self.status_changed_at is None:
            return None
        return self.status_changed_at - self.added_at

    def get_tat_display(self):
        """Return TAT as 'Xd Yh Zm' / 'Xh Ym' / 'Xm Ys' or '—' when not terminal."""
        delta = self.get_tat()
        if delta is None:
            return '—'
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

    @property
    def accuracy_pct(self):
        """100 × (0.9 ^ revisions) when terminal; None otherwise."""
        if not self.is_terminal:
            return None
        return float(Decimal('100') * (self.ACCURACY_DECAY ** self.revisions))


class MotorNewStatusTransition(models.Model):
    """Records each status change for a motor new enquiry."""
    entry = models.ForeignKey(
        MotorNewEntry,
        on_delete=models.CASCADE,
        related_name='status_transitions',
    )
    from_status = models.CharField(
        max_length=20, choices=MotorNewEntry.STATUS_CHOICES, blank=True
    )
    to_status = models.CharField(
        max_length=20, choices=MotorNewEntry.STATUS_CHOICES
    )
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='motor_new_status_changes',
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['changed_at']

    def __str__(self):
        return f"{self.entry_id}: {self.from_status} -> {self.to_status}"


class MotorRenewalEntry(BaseEntry):
    """Motor Renewal enquiry — one row per renewal opportunity with status state machine."""
    STATUS_NEW = 'new'
    STATUS_RETAINED = 'retained'
    STATUS_LOST = 'lost'

    STATUS_CHOICES = [
        (STATUS_NEW, 'New Enquiry'),
        (STATUS_RETAINED, 'Retained'),
        (STATUS_LOST, 'Lost'),
    ]

    TERMINAL_STATUSES = {STATUS_RETAINED, STATUS_LOST}

    TRANSITIONS = {
        STATUS_NEW: [STATUS_RETAINED, STATUS_LOST],
        STATUS_RETAINED: [],
        STATUS_LOST: [],
    }

    ACCURACY_DECAY = Decimal('0.9')

    client_name = models.CharField(max_length=200)
    agent = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='motor_renewal_enquiries_as_agent',
    )
    chassis_no = models.CharField(max_length=100)
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default=STATUS_NEW
    )
    revisions = models.PositiveIntegerField(default=0)
    quotes_compared = models.PositiveIntegerField(default=0)
    status_changed_at = models.DateTimeField(null=True, blank=True)
    potential_premium = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
    )
    # Captured at the moment the enquiry closes as Retained via the
    # update-status flow (TED-440). NULL when not yet closed or closed as Lost.
    converted_premium = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
    )
    class_of_enquiry = models.CharField(
        max_length=20, choices=MOTOR_CLASS_OF_ENQUIRY_CHOICES,
        blank=True, default='',
    )
    insurance_company = models.ForeignKey(
        'InsuranceCompany',
        on_delete=models.PROTECT,
        related_name='motor_renewal_entries',
        null=True, blank=True,
    )

    class Meta(BaseEntry.Meta):
        verbose_name = 'Motor Renewal Entry'
        verbose_name_plural = 'Motor Renewal Entries'

    def __str__(self):
        return f"Motor Renewal Enquiry - {self.client_name} ({self.status})"

    @classmethod
    def get_allowed_transitions(cls, current_status):
        return cls.TRANSITIONS.get(current_status, [])

    @property
    def is_terminal(self):
        return self.status in self.TERMINAL_STATUSES

    def get_tat(self):
        if not self.is_terminal or self.status_changed_at is None:
            return None
        return self.status_changed_at - self.added_at

    def get_tat_display(self):
        delta = self.get_tat()
        if delta is None:
            return '—'
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

    @property
    def accuracy_pct(self):
        if not self.is_terminal:
            return None
        return float(Decimal('100') * (self.ACCURACY_DECAY ** self.revisions))


class MotorRenewalStatusTransition(models.Model):
    """Records each status change for a motor renewal enquiry."""
    entry = models.ForeignKey(
        MotorRenewalEntry,
        on_delete=models.CASCADE,
        related_name='status_transitions',
    )
    from_status = models.CharField(
        max_length=20, choices=MotorRenewalEntry.STATUS_CHOICES, blank=True
    )
    to_status = models.CharField(
        max_length=20, choices=MotorRenewalEntry.STATUS_CHOICES
    )
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='motor_renewal_status_changes',
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['changed_at']

    def __str__(self):
        return f"{self.entry_id}: {self.from_status} -> {self.to_status}"


class MotorRenewalMonthlyTarget(models.Model):
    """Per-user retention target for the motor renewal module.

    Mirrors SalesMonthlyTarget but tracks only `clients_assigned` (number of
    renewal opportunities the user is expected to retain in the month). The
    `premium_target` concept doesn't apply to renewal enquiries.
    """
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='motor_renewal_monthly_targets',
    )
    year = models.PositiveIntegerField()
    month = models.PositiveIntegerField()
    # Auto-derived from (year, month) on every save() — same pattern as
    # SalesMonthlyTarget.calculated_date.
    calculated_date = models.DateField(db_index=True)
    clients_assigned = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'year', 'month')

    def save(self, *args, **kwargs):
        from datetime import date
        self.calculated_date = date(self.year, self.month, 1)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Motor Renewal Target {self.year}/{self.month} - {self.user}"


class MotorFleetNewEntry(BaseEntry):
    """Motor Fleet New enquiry — one row per customer enquiry with status state machine."""
    STATUS_NEW = 'new'
    STATUS_CONVERTED = 'converted'
    STATUS_LOST = 'lost'

    STATUS_CHOICES = [
        (STATUS_NEW, 'New Enquiry'),
        (STATUS_CONVERTED, 'Converted'),
        (STATUS_LOST, 'Lost'),
    ]

    TERMINAL_STATUSES = {STATUS_CONVERTED, STATUS_LOST}

    TRANSITIONS = {
        STATUS_NEW: [STATUS_CONVERTED, STATUS_LOST],
        STATUS_CONVERTED: [],
        STATUS_LOST: [],
    }

    ACCURACY_DECAY = Decimal('0.9')

    client_name = models.CharField(max_length=200)
    agent = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='motor_fleet_new_enquiries_as_agent',
    )
    chassis_no = models.CharField(max_length=100)
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default=STATUS_NEW
    )
    revisions = models.PositiveIntegerField(default=0)
    quotes_compared = models.PositiveIntegerField(default=0)
    status_changed_at = models.DateTimeField(null=True, blank=True)
    # Captured at the moment the enquiry closes as Converted via the
    # update-status flow (TED-440). NULL when not yet closed or closed as Lost.
    converted_premium = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
    )

    class Meta(BaseEntry.Meta):
        verbose_name = 'Motor Fleet New Entry'
        verbose_name_plural = 'Motor Fleet New Entries'

    def __str__(self):
        return f"Motor Fleet New Enquiry - {self.client_name} ({self.status})"

    @classmethod
    def get_allowed_transitions(cls, current_status):
        return cls.TRANSITIONS.get(current_status, [])

    @property
    def is_terminal(self):
        return self.status in self.TERMINAL_STATUSES

    def get_tat(self):
        """TAT = status_changed_at - added_at, only when status is terminal."""
        if not self.is_terminal or self.status_changed_at is None:
            return None
        return self.status_changed_at - self.added_at

    def get_tat_display(self):
        """Return TAT as 'Xd Yh Zm' / 'Xh Ym' / 'Xm Ys' or '—' when not terminal."""
        delta = self.get_tat()
        if delta is None:
            return '—'
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

    @property
    def accuracy_pct(self):
        """100 × (0.9 ^ revisions) when terminal; None otherwise."""
        if not self.is_terminal:
            return None
        return float(Decimal('100') * (self.ACCURACY_DECAY ** self.revisions))


class MotorFleetNewStatusTransition(models.Model):
    """Records each status change for a motor fleet new enquiry."""
    entry = models.ForeignKey(
        MotorFleetNewEntry,
        on_delete=models.CASCADE,
        related_name='status_transitions',
    )
    from_status = models.CharField(
        max_length=20, choices=MotorFleetNewEntry.STATUS_CHOICES, blank=True
    )
    to_status = models.CharField(
        max_length=20, choices=MotorFleetNewEntry.STATUS_CHOICES
    )
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='motor_fleet_new_status_changes',
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['changed_at']

    def __str__(self):
        return f"{self.entry_id}: {self.from_status} -> {self.to_status}"


class MotorFleetRenewalEntry(BaseEntry):
    """Motor Fleet Renewal enquiry — one row per renewal opportunity with status state machine."""
    STATUS_NEW = 'new'
    STATUS_RETAINED = 'retained'
    STATUS_LOST = 'lost'

    STATUS_CHOICES = [
        (STATUS_NEW, 'New Enquiry'),
        (STATUS_RETAINED, 'Retained'),
        (STATUS_LOST, 'Lost'),
    ]

    TERMINAL_STATUSES = {STATUS_RETAINED, STATUS_LOST}

    TRANSITIONS = {
        STATUS_NEW: [STATUS_RETAINED, STATUS_LOST],
        STATUS_RETAINED: [],
        STATUS_LOST: [],
    }

    ACCURACY_DECAY = Decimal('0.9')

    client_name = models.CharField(max_length=200)
    agent = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='motor_fleet_renewal_enquiries_as_agent',
    )
    chassis_no = models.CharField(max_length=100)
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default=STATUS_NEW
    )
    revisions = models.PositiveIntegerField(default=0)
    quotes_compared = models.PositiveIntegerField(default=0)
    status_changed_at = models.DateTimeField(null=True, blank=True)
    # Captured at the moment the enquiry closes as Retained via the
    # update-status flow (TED-440). NULL when not yet closed or closed as Lost.
    converted_premium = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
    )

    class Meta(BaseEntry.Meta):
        verbose_name = 'Motor Fleet Renewal Entry'
        verbose_name_plural = 'Motor Fleet Renewal Entries'

    def __str__(self):
        return f"Motor Fleet Renewal Enquiry - {self.client_name} ({self.status})"

    @classmethod
    def get_allowed_transitions(cls, current_status):
        return cls.TRANSITIONS.get(current_status, [])

    @property
    def is_terminal(self):
        return self.status in self.TERMINAL_STATUSES

    def get_tat(self):
        if not self.is_terminal or self.status_changed_at is None:
            return None
        return self.status_changed_at - self.added_at

    def get_tat_display(self):
        delta = self.get_tat()
        if delta is None:
            return '—'
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

    @property
    def accuracy_pct(self):
        if not self.is_terminal:
            return None
        return float(Decimal('100') * (self.ACCURACY_DECAY ** self.revisions))


class MotorFleetRenewalStatusTransition(models.Model):
    """Records each status change for a motor fleet renewal enquiry."""
    entry = models.ForeignKey(
        MotorFleetRenewalEntry,
        on_delete=models.CASCADE,
        related_name='status_transitions',
    )
    from_status = models.CharField(
        max_length=20, choices=MotorFleetRenewalEntry.STATUS_CHOICES, blank=True
    )
    to_status = models.CharField(
        max_length=20, choices=MotorFleetRenewalEntry.STATUS_CHOICES
    )
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='motor_fleet_renewal_status_changes',
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['changed_at']

    def __str__(self):
        return f"{self.entry_id}: {self.from_status} -> {self.to_status}"


class MotorFleetRenewalMonthlyTarget(models.Model):
    """Per-user retention target for the motor fleet renewal module.

    Mirrors MotorRenewalMonthlyTarget but scoped to the motor_fleet_renewal
    module so fleet targets are tracked independently from retail-motor renewal
    targets.
    """
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='motor_fleet_renewal_monthly_targets',
    )
    year = models.PositiveIntegerField()
    month = models.PositiveIntegerField()
    calculated_date = models.DateField(db_index=True)
    clients_assigned = models.PositiveIntegerField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'year', 'month')

    def save(self, *args, **kwargs):
        from datetime import date
        self.calculated_date = date(self.year, self.month, 1)
        super().save(*args, **kwargs)

    def __str__(self):
        return f"Motor Fleet Renewal Target {self.year}/{self.month} - {self.user}"


class TypeOfAccident(models.Model):
    """Admin-managed list of accident types referenced by MotorClaimEntry."""
    name = models.CharField(max_length=200, unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class ClassOfInsurance(models.Model):
    """Admin-managed list of insurance classes referenced by Sales KPI
    enquiries (and, post-migration 0035, by the General New / General Renewal
    enquiry tables). Managed via the Settings page tab next to
    TypeOfAccident / InsuranceCompany — same lookup-table shape."""
    name = models.CharField(max_length=200, unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Class of Insurance'
        verbose_name_plural = 'Classes of Insurance'

    def __str__(self):
        return self.name


class InsuranceCompany(models.Model):
    """Admin-managed list of insurance companies referenced by MotorClaimEntry."""
    name = models.CharField(max_length=200, unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']

    def __str__(self):
        return self.name


class MotorClaimEntry(BaseEntry):
    """Motor Claim — one row per claim, with status state machine + lookup FKs."""
    STATUS_CHOICES = [
        ('claims_opened', 'Claims Opened'),
        ('claims_in_progress', 'Claims In Progress'),
        ('claims_resolved', 'Claims Resolved'),
        ('claims_rejected', 'Claims Rejected'),
    ]

    TERMINAL_STATUSES = {'claims_resolved', 'claims_rejected'}

    TRANSITIONS = {
        'claims_opened': ['claims_in_progress'],
        'claims_in_progress': ['claims_resolved', 'claims_rejected'],
        'claims_resolved': [],
        'claims_rejected': [],
    }

    client_name = models.CharField(max_length=200)
    vehicle_number = models.CharField(max_length=50)
    claim_number = models.CharField(max_length=100)
    source = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='motor_claim_enquiries_as_source',
    )
    type_of_accident = models.ForeignKey(
        TypeOfAccident, on_delete=models.PROTECT, related_name='motor_claims',
    )
    insurance_company = models.ForeignKey(
        InsuranceCompany, on_delete=models.PROTECT, related_name='motor_claims',
    )
    next_call_date = models.DateField(null=True, blank=True)
    garage_name = models.CharField(max_length=200, blank=True, default='')
    garage_number = models.CharField(max_length=50, blank=True, default='')
    status = models.CharField(max_length=20, choices=STATUS_CHOICES)

    class Meta(BaseEntry.Meta):
        verbose_name = 'Motor Claim Entry'
        verbose_name_plural = 'Motor Claim Entries'

    def __str__(self):
        return f"Motor Claim - {self.client_name} ({self.claim_number})"

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
    """Sales KPI ticket — per-enquiry workflow with status state machine.

    Replaced the original per-day KPI aggregate model in migration 0036
    (TED-446). Each row represents a single sales enquiry tracked through:
        lead → in_progress → won / lost
    The three "Sent for quote" / "Quote received" / "Submitted to client"
    booleans are captured at the time of the Won/Lost transition via the
    `update_status` endpoint (TED-447 workflow). `converted_premium` is set
    only when the transition is to Won.
    """
    STATUS_LEAD = 'lead'
    STATUS_IN_PROGRESS = 'in_progress'
    STATUS_WON = 'won'
    STATUS_LOST = 'lost'

    STATUS_CHOICES = [
        (STATUS_LEAD, 'Lead'),
        (STATUS_IN_PROGRESS, 'In Progress'),
        (STATUS_WON, 'Won'),
        (STATUS_LOST, 'Lost'),
    ]

    TERMINAL_STATUSES = {STATUS_WON, STATUS_LOST}

    TRANSITIONS = {
        STATUS_LEAD: [STATUS_IN_PROGRESS, STATUS_WON, STATUS_LOST],
        STATUS_IN_PROGRESS: [STATUS_WON, STATUS_LOST],
        STATUS_WON: [],
        STATUS_LOST: [],
    }

    ENTRY_TYPE_CHOICES = [
        ('new', 'New'),
        ('renewal', 'Renewal'),
    ]

    customer_name = models.CharField(max_length=200)
    entry_type = models.CharField(max_length=20, choices=ENTRY_TYPE_CHOICES)
    class_of_insurance = models.ForeignKey(
        ClassOfInsurance,
        on_delete=models.PROTECT,
        related_name='sales_kpi_entries',
    )
    # Assignee — current rule: any user with the sales_kpi module permission.
    # Sourcing may change later; the FK doesn't enforce module permission at
    # the DB layer so we don't have to migrate when the rule shifts.
    assignee = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='sales_kpi_assigned_enquiries',
    )
    potential_premium = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
    )
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default=STATUS_LEAD,
    )
    status_changed_at = models.DateTimeField(null=True, blank=True)

    # TED-447 workflow answers captured when the enquiry is closed (Won/Lost).
    # Nullable while the enquiry is still Lead / In Progress.
    sent_for_quote = models.BooleanField(null=True, blank=True)
    quote_received = models.BooleanField(null=True, blank=True)
    submitted_to_client = models.BooleanField(null=True, blank=True)
    converted_premium = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
    )

    class Meta(BaseEntry.Meta):
        verbose_name = 'Sales KPI Entry'
        verbose_name_plural = 'Sales KPI Entries'

    def __str__(self):
        return f"Sales KPI Enquiry - {self.customer_name} ({self.status})"

    @classmethod
    def get_allowed_transitions(cls, current_status):
        return cls.TRANSITIONS.get(current_status, [])

    @property
    def is_terminal(self):
        return self.status in self.TERMINAL_STATUSES


class SalesKPIStatusTransition(models.Model):
    """Records each status change for a Sales KPI enquiry."""
    entry = models.ForeignKey(
        SalesKPIEntry,
        on_delete=models.CASCADE,
        related_name='status_transitions',
    )
    from_status = models.CharField(
        max_length=20, choices=SalesKPIEntry.STATUS_CHOICES, blank=True,
    )
    to_status = models.CharField(
        max_length=20, choices=SalesKPIEntry.STATUS_CHOICES,
    )
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='sales_kpi_status_changes',
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['changed_at']

    def __str__(self):
        return f"{self.entry_id}: {self.from_status} -> {self.to_status}"


class SalesMonthlyTarget(models.Model):
    user = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='sales_monthly_targets'
    )
    year = models.PositiveIntegerField()
    month = models.PositiveIntegerField()
    # Stored as a real DATE (first day of the month) so analytics tools
    # (Metabase, raw SQL) can do date filtering / aggregations without
    # reconstructing it from the year+month integers each time.
    # Auto-derived from (year, month) on every save() — never set by hand.
    calculated_date = models.DateField(db_index=True)
    # TED-496 renamed these labels in the UI:
    # - premium_target is shown as "New Business Premium Target"
    # - clients_assigned is shown as "Renewal Premium Target" and now stores
    #   a currency amount (decimal) rather than an integer client count. The
    #   column name is preserved to avoid a rename-cascade through
    #   serializers / frontend; only its type and semantic meaning shift.
    premium_target = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    clients_assigned = models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        unique_together = ('user', 'year', 'month')

    def save(self, *args, **kwargs):
        from datetime import date
        self.calculated_date = date(self.year, self.month, 1)
        super().save(*args, **kwargs)

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
        ('claims_in_progress', 'Claims In Progress'),
        ('claims_resolved', 'Claims Resolved'),
        ('claims_rejected', 'Claims Rejected'),
    ]

    TERMINAL_STATUSES = {'claims_resolved', 'claims_rejected'}

    TRANSITIONS = {
        'claims_opened': ['claims_in_progress'],
        'claims_in_progress': ['claims_resolved', 'claims_rejected'],
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


class EntryRemark(models.Model):
    """Per-entry comment. One entry (any supported module) can have many remarks.

    `entry` is a GenericForeignKey so a single table serves all 7 supported
    modules (motor_new / motor_renewal / motor_fleet_new / motor_fleet_renewal
    / general_new / general_renewal / motor_claim) without polluting the
    per-module schemas. Only the author can edit or delete their own remark.
    """
    content_type = models.ForeignKey('contenttypes.ContentType', on_delete=models.CASCADE)
    object_id = models.PositiveIntegerField()
    entry = GenericForeignKey('content_type', 'object_id')

    text = models.TextField()
    author = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='entry_remarks',
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['-created_at']
        indexes = [
            models.Index(
                fields=['content_type', 'object_id', '-created_at'],
                name='entries_er_ct_obj_cr_idx',
            ),
        ]

    def __str__(self):
        return f"Remark by {self.author_id} on {self.content_type_id}:{self.object_id}"
