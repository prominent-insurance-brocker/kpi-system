import random
import re
import string
import unicodedata
from decimal import Decimal

from django.db import IntegrityError, models, transaction
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

    # ── Void / write-off (TED-594) ──────────────────────────────────────
    # A voided entry is "written off": retained for audit but excluded from
    # every dashboard metric and report. Voiding is irreversible. No db_index
    # on is_voided — the extra `WHERE is_voided = false` is cheap at this scale
    # and skipping the index keeps the migration a fast, lock-free metadata add
    # on the live Postgres DB.
    is_voided = models.BooleanField(default=False)
    voided_at = models.DateTimeField(null=True, blank=True)
    voided_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='%(class)s_voided_entries',
        null=True,
        blank=True,
    )
    void_reason = models.TextField(blank=True, default='')

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

    def can_void(self, user):
        """Who may void this entry: the creator (any time — no 30-min window)
        or a super-admin. HODs are blocked at the viewset level. An entry that
        is already voided cannot be voided again."""
        if self.is_voided:
            return False
        return bool(user and (user.is_staff or self.added_by_id == user.id))


class StoredQualityMixin(models.Model):
    """Persists each enquiry's TAT and Accuracy as real columns, so the values
    the Enquiries table shows (`get_tat()` / `accuracy_pct`) are queryable in
    the database (e.g. from Metabase). Re-derived on every save, so they can
    never drift from the UI. NULL wherever the UI shows '—'.

    Mixed into the per-enquiry models (General / Motor / Motor Fleet New &
    Renewal, Marine New); each supplies get_tat(), accuracy_pct and
    TERMINAL_STATUSES.
    """
    tat_minutes = models.DecimalField(
        max_digits=12, decimal_places=2, null=True, blank=True,
    )
    accuracy = models.DecimalField(
        max_digits=5, decimal_places=2, null=True, blank=True,
    )

    class Meta:
        abstract = True

    def compute_stored_quality(self):
        """(tat_minutes, accuracy) as stored: 2-dp Decimals, or None."""
        if self.added_at is None:
            return None, None
        delta = self.get_tat()
        tat = (
            Decimal(delta.total_seconds() / 60).quantize(Decimal('0.01'))
            if delta is not None else None
        )
        acc = self.accuracy_pct
        acc = Decimal(acc).quantize(Decimal('0.01')) if acc is not None else None
        return tat, acc

    def save(self, *args, **kwargs):
        super().save(*args, **kwargs)
        # After the insert/update so auto_now_add `added_at` is populated.
        # Derive from a fresh read of the row, not this instance: a save with
        # update_fields on a stale instance (e.g. revisions written after a
        # concurrent close) must still store values matching the row's real
        # state. A direct UPDATE keeps the derived columns out of callers'
        # update_fields lists and only runs when a value actually changed.
        fresh = type(self).objects.filter(pk=self.pk).first()
        if fresh is None:
            return
        tat, acc = fresh.compute_stored_quality()
        if (tat, acc) != (fresh.tat_minutes, fresh.accuracy):
            type(self).objects.filter(pk=self.pk).update(
                tat_minutes=tat, accuracy=acc,
            )
        self.tat_minutes, self.accuracy = tat, acc

    @classmethod
    def tat_spans(cls, queryset):
        """(start, end) pairs behind the dashboard's Avg. TAT — exactly the rows
        whose get_tat() is not None. Default: closed rows with a close stamp."""
        return list(
            queryset.filter(
                status__in=sorted(cls.TERMINAL_STATUSES),
                status_changed_at__isnull=False,
            ).values_list('added_at', 'status_changed_at')
        )


class GeneralNewEntry(StoredQualityMixin, BaseEntry):
    """General New enquiry — one row per customer enquiry with status state machine.

    Mirrors MotorNewEntry's shape but without the motor-specific chassis number
    (general insurance products have no chassis).
    """
    STATUS_NEW = 'new'
    STATUS_IN_PROGRESS = 'in_progress'
    STATUS_CONVERTED = 'converted'
    STATUS_LOST = 'lost'
    STATUS_REJECTED = 'rejected'

    STATUS_CHOICES = [
        (STATUS_NEW, 'New Enquiry'),
        (STATUS_IN_PROGRESS, 'In Progress'),
        (STATUS_CONVERTED, 'Converted'),
        (STATUS_LOST, 'Lost'),
        (STATUS_REJECTED, 'Rejected'),
    ]

    TERMINAL_STATUSES = {STATUS_CONVERTED, STATUS_LOST, STATUS_REJECTED}

    # New ↔ In Progress is a free back-and-forth; both can close to
    # Converted/Lost/Rejected (terminal). Rejected (TED-595) is an
    # irreversible decline — an entry cannot leave it. All three are dead-ends.
    TRANSITIONS = {
        STATUS_NEW: [STATUS_IN_PROGRESS, STATUS_CONVERTED, STATUS_LOST, STATUS_REJECTED],
        STATUS_IN_PROGRESS: [STATUS_NEW, STATUS_CONVERTED, STATUS_LOST, STATUS_REJECTED],
        STATUS_CONVERTED: [],
        STATUS_LOST: [],
        STATUS_REJECTED: [],
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
    # TED-592: insurers compared/quoted while the enquiry is open (the
    # create-modal multi-select).
    compared_insurance_companies = models.ManyToManyField(
        'InsuranceCompany',
        related_name='general_new_compared',
        blank=True,
    )
    # TED-592 (corrected): the single insurer the client purchased from,
    # captured on Won (Converted/Retained). Kept separate from the legacy
    # `insurance_company` FK so the original column is never overwritten.
    converted_insurer = models.ForeignKey(
        'InsuranceCompany',
        on_delete=models.PROTECT,
        related_name='general_new_converted',
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


class GeneralRenewalEntry(StoredQualityMixin, BaseEntry):
    """General Renewal enquiry — one row per renewal opportunity with status state machine.

    Mirrors MotorRenewalEntry's shape but without the motor-specific chassis
    number (general insurance products have no chassis).
    """
    STATUS_NEW = 'new'
    STATUS_RETAINED = 'retained'
    STATUS_LOST = 'lost'
    STATUS_REJECTED = 'rejected'

    STATUS_CHOICES = [
        (STATUS_NEW, 'New Enquiry'),
        (STATUS_RETAINED, 'Retained'),
        (STATUS_LOST, 'Lost'),
        (STATUS_REJECTED, 'Rejected'),
    ]

    TERMINAL_STATUSES = {STATUS_RETAINED, STATUS_LOST, STATUS_REJECTED}

    # Rejected (TED-595) is an irreversible decline reachable from New; an
    # entry cannot leave it. Retained/Lost/Rejected are dead-ends.
    TRANSITIONS = {
        STATUS_NEW: [STATUS_RETAINED, STATUS_LOST, STATUS_REJECTED],
        STATUS_RETAINED: [],
        STATUS_LOST: [],
        STATUS_REJECTED: [],
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
    # TED-592: insurers compared/quoted while the enquiry is open (the
    # create-modal multi-select).
    compared_insurance_companies = models.ManyToManyField(
        'InsuranceCompany',
        related_name='general_renewal_compared',
        blank=True,
    )
    # TED-592 (corrected): the single insurer the client purchased from,
    # captured on Won (Converted/Retained). Kept separate from the legacy
    # `insurance_company` FK so the original column is never overwritten.
    converted_insurer = models.ForeignKey(
        'InsuranceCompany',
        on_delete=models.PROTECT,
        related_name='general_renewal_converted',
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


class MotorNewEntry(StoredQualityMixin, BaseEntry):
    """Motor New enquiry — one row per customer enquiry with status state machine."""
    STATUS_NEW = 'new'
    STATUS_IN_PROGRESS = 'in_progress'
    STATUS_CONVERTED = 'converted'
    STATUS_LOST = 'lost'
    STATUS_REJECTED = 'rejected'

    STATUS_CHOICES = [
        (STATUS_NEW, 'New Enquiry'),
        (STATUS_IN_PROGRESS, 'In Progress'),
        (STATUS_CONVERTED, 'Converted'),
        (STATUS_LOST, 'Lost'),
        (STATUS_REJECTED, 'Rejected'),
    ]

    TERMINAL_STATUSES = {STATUS_CONVERTED, STATUS_LOST, STATUS_REJECTED}

    # New ↔ In Progress is a free back-and-forth; both can close to
    # Converted/Lost/Rejected (terminal). Rejected (TED-595) is an
    # irreversible decline — an entry cannot leave it. All three are dead-ends.
    TRANSITIONS = {
        STATUS_NEW: [STATUS_IN_PROGRESS, STATUS_CONVERTED, STATUS_LOST, STATUS_REJECTED],
        STATUS_IN_PROGRESS: [STATUS_NEW, STATUS_CONVERTED, STATUS_LOST, STATUS_REJECTED],
        STATUS_CONVERTED: [],
        STATUS_LOST: [],
        STATUS_REJECTED: [],
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
    # TED-592: insurers compared/quoted while the enquiry is open (the
    # create-modal multi-select).
    compared_insurance_companies = models.ManyToManyField(
        'InsuranceCompany',
        related_name='motor_new_compared',
        blank=True,
    )
    # TED-592 (corrected): the single insurer the client purchased from,
    # captured on Won (Converted/Retained). Kept separate from the legacy
    # `insurance_company` FK so the original column is never overwritten.
    converted_insurer = models.ForeignKey(
        'InsuranceCompany',
        on_delete=models.PROTECT,
        related_name='motor_new_converted',
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


class MotorRenewalEntry(StoredQualityMixin, BaseEntry):
    """Motor Renewal enquiry — one row per renewal opportunity with status state machine."""
    STATUS_NEW = 'new'
    STATUS_RETAINED = 'retained'
    STATUS_LOST = 'lost'
    STATUS_REJECTED = 'rejected'

    STATUS_CHOICES = [
        (STATUS_NEW, 'New Enquiry'),
        (STATUS_RETAINED, 'Retained'),
        (STATUS_LOST, 'Lost'),
        (STATUS_REJECTED, 'Rejected'),
    ]

    TERMINAL_STATUSES = {STATUS_RETAINED, STATUS_LOST, STATUS_REJECTED}

    # Rejected (TED-595) is an irreversible decline reachable from New; an
    # entry cannot leave it. Retained/Lost/Rejected are dead-ends.
    TRANSITIONS = {
        STATUS_NEW: [STATUS_RETAINED, STATUS_LOST, STATUS_REJECTED],
        STATUS_RETAINED: [],
        STATUS_LOST: [],
        STATUS_REJECTED: [],
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
    # TED-592: insurers compared/quoted while the enquiry is open (the
    # create-modal multi-select).
    compared_insurance_companies = models.ManyToManyField(
        'InsuranceCompany',
        related_name='motor_renewal_compared',
        blank=True,
    )
    # TED-592 (corrected): the single insurer the client purchased from,
    # captured on Won (Converted/Retained). Kept separate from the legacy
    # `insurance_company` FK so the original column is never overwritten.
    converted_insurer = models.ForeignKey(
        'InsuranceCompany',
        on_delete=models.PROTECT,
        related_name='motor_renewal_converted',
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


class MotorFleetNewEntry(StoredQualityMixin, BaseEntry):
    """Motor Fleet New enquiry — one row per customer enquiry with status state machine."""
    STATUS_NEW = 'new'
    STATUS_IN_PROGRESS = 'in_progress'
    STATUS_CONVERTED = 'converted'
    STATUS_LOST = 'lost'
    STATUS_REJECTED = 'rejected'

    STATUS_CHOICES = [
        (STATUS_NEW, 'New Enquiry'),
        (STATUS_IN_PROGRESS, 'In Progress'),
        (STATUS_CONVERTED, 'Converted'),
        (STATUS_LOST, 'Lost'),
        (STATUS_REJECTED, 'Rejected'),
    ]

    TERMINAL_STATUSES = {STATUS_CONVERTED, STATUS_LOST, STATUS_REJECTED}

    # New ↔ In Progress is a free back-and-forth; both can close to
    # Converted/Lost/Rejected (terminal). Rejected (TED-595) is an
    # irreversible decline — an entry cannot leave it. All three are dead-ends.
    TRANSITIONS = {
        STATUS_NEW: [STATUS_IN_PROGRESS, STATUS_CONVERTED, STATUS_LOST, STATUS_REJECTED],
        STATUS_IN_PROGRESS: [STATUS_NEW, STATUS_CONVERTED, STATUS_LOST, STATUS_REJECTED],
        STATUS_CONVERTED: [],
        STATUS_LOST: [],
        STATUS_REJECTED: [],
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
        related_name='motor_fleet_new_entries',
        null=True, blank=True,
    )
    # TED-592: insurers compared/quoted while the enquiry is open (the
    # create-modal multi-select).
    compared_insurance_companies = models.ManyToManyField(
        'InsuranceCompany',
        related_name='motor_fleet_new_compared',
        blank=True,
    )
    # TED-592 (corrected): the single insurer the client purchased from,
    # captured on Won (Converted/Retained). Kept separate from the legacy
    # `insurance_company` FK so the original column is never overwritten.
    converted_insurer = models.ForeignKey(
        'InsuranceCompany',
        on_delete=models.PROTECT,
        related_name='motor_fleet_new_converted',
        null=True, blank=True,
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


class MotorFleetRenewalEntry(StoredQualityMixin, BaseEntry):
    """Motor Fleet Renewal enquiry — one row per renewal opportunity with status state machine."""
    STATUS_NEW = 'new'
    STATUS_RETAINED = 'retained'
    STATUS_LOST = 'lost'
    STATUS_REJECTED = 'rejected'

    STATUS_CHOICES = [
        (STATUS_NEW, 'New Enquiry'),
        (STATUS_RETAINED, 'Retained'),
        (STATUS_LOST, 'Lost'),
        (STATUS_REJECTED, 'Rejected'),
    ]

    TERMINAL_STATUSES = {STATUS_RETAINED, STATUS_LOST, STATUS_REJECTED}

    # Rejected (TED-595) is an irreversible decline reachable from New; an
    # entry cannot leave it. Retained/Lost/Rejected are dead-ends.
    TRANSITIONS = {
        STATUS_NEW: [STATUS_RETAINED, STATUS_LOST, STATUS_REJECTED],
        STATUS_RETAINED: [],
        STATUS_LOST: [],
        STATUS_REJECTED: [],
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
    class_of_enquiry = models.CharField(
        max_length=20, choices=MOTOR_CLASS_OF_ENQUIRY_CHOICES,
        blank=True, default='',
    )
    insurance_company = models.ForeignKey(
        'InsuranceCompany',
        on_delete=models.PROTECT,
        related_name='motor_fleet_renewal_entries',
        null=True, blank=True,
    )
    # TED-592: insurers compared/quoted while the enquiry is open (the
    # create-modal multi-select).
    compared_insurance_companies = models.ManyToManyField(
        'InsuranceCompany',
        related_name='motor_fleet_renewal_compared',
        blank=True,
    )
    # TED-592 (corrected): the single insurer the client purchased from,
    # captured on Won (Converted/Retained). Kept separate from the legacy
    # `insurance_company` FK so the original column is never overwritten.
    converted_insurer = models.ForeignKey(
        'InsuranceCompany',
        on_delete=models.PROTECT,
        related_name='motor_fleet_renewal_converted',
        null=True, blank=True,
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


class MarineClassOfInsurance(models.Model):
    """Admin-managed list of Marine insurance classes referenced by the Marine
    New enquiry table (TED-596). Kept separate from ClassOfInsurance because
    Marine classes are a distinct sub-category of Marine Insurance. Managed via
    its own Settings page tab — same lookup-table shape as ClassOfInsurance."""
    name = models.CharField(max_length=200, unique=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name']
        verbose_name = 'Marine Class of Insurance'
        verbose_name_plural = 'Marine Classes of Insurance'

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


# ─── Clients (Marine New client list) ─────────────────────────────────────────

# Client tags = the sidebar's parent categories. A client can carry several;
# each module's client picker lists only its own category.
CLIENT_CATEGORIES = [
    ('general', 'General'),
    ('motor', 'Motor'),
    ('sales', 'Sales'),
    ('marine', 'Marine'),
    ('medical', 'Medical'),
]

# Category -> RoleModulePermission module keys, mirroring the sidebar groups.
# A user "can access" a category when their role grants any of its modules.
CATEGORY_MODULES = {
    'general': ('general_new', 'general_renewal', 'general_claim'),
    'motor': (
        'motor_new', 'motor_renewal', 'motor_claim',
        'motor_fleet_new', 'motor_fleet_renewal',
    ),
    'sales': ('sales_kpi',),
    'marine': ('marine_new', 'marine_renewal'),
    'medical': (
        'medical_claim',
        'medical_individual_new', 'medical_individual_renewal',
        'medical_sme_new', 'medical_sme_renewal',
        'medical_corporate_new', 'medical_corporate_renewal',
    ),
}

# Module key -> its category (reverse of CATEGORY_MODULES).
MODULE_CATEGORY = {
    module: category
    for category, modules in CATEGORY_MODULES.items()
    for module in modules
}

# Category key -> its boolean column on Client (e.g. 'marine' -> 'is_marine').
CATEGORY_FIELDS = {key: f'is_{key}' for key, _ in CLIENT_CATEGORIES}

CLIENT_USERNAME_MAX_LENGTH = 200
# Usernames are stored as handles: '@' + slug + '_' + code.
CLIENT_USERNAME_PREFIX = '@'
# `slug_` + a 4-char code of exactly 2 digits and 2 lowercase letters in a
# random order, e.g. 'k47q'.
_CLIENT_CODE_DIGITS = 2
_CLIENT_CODE_LETTERS = 2
_CLIENT_CODE_LENGTH = _CLIENT_CODE_DIGITS + _CLIENT_CODE_LETTERS
_client_rng = random.SystemRandom()


def normalise_client_name(name):
    """Comparison key for client names: trimmed, inner whitespace collapsed,
    lower-cased. Two names with the same key are "the same client name"."""
    return ' '.join((name or '').split()).lower()


def _client_username_slug(name):
    ascii_name = (
        unicodedata.normalize('NFKD', name or '')
        .encode('ascii', 'ignore').decode('ascii').lower()
    )
    slug = re.sub(r'[^a-z0-9]+', '_', ascii_name).strip('_')
    # Leave room for '@' + '_' + the 4-char code inside the column's 200 chars.
    slug = slug[:CLIENT_USERNAME_MAX_LENGTH - (_CLIENT_CODE_LENGTH + 2)].rstrip('_')
    return slug or 'client'


def _client_username_code():
    chars = (
        [_client_rng.choice(string.digits) for _ in range(_CLIENT_CODE_DIGITS)]
        + [_client_rng.choice(string.ascii_lowercase) for _ in range(_CLIENT_CODE_LETTERS)]
    )
    _client_rng.shuffle(chars)
    return ''.join(chars)


def generate_client_username(name):
    """A unique username for a client called `name`, e.g. '@abc_ltd_k47q'.
    Draws a new code whenever the candidate is already taken."""
    slug = _client_username_slug(name)
    for _ in range(50):
        candidate = f'{CLIENT_USERNAME_PREFIX}{slug}_{_client_username_code()}'
        if not Client.objects.filter(username=candidate).exists():
            return candidate
    raise RuntimeError('Could not generate a unique client username.')


def client_username_matches_name(name, username):
    """True when `username`'s name part is already the slug of `name`, so a
    rename that keeps the same slug (e.g. 'ABC Ltd' -> 'ABC Ltd.') can keep
    the existing username."""
    prefix = f'{CLIENT_USERNAME_PREFIX}{_client_username_slug(name)}_'
    return (
        isinstance(username, str) and username.startswith(prefix)
        and len(username) == len(prefix) + _CLIENT_CODE_LENGTH
    )


def is_valid_client_username(name, username):
    """True when `username` has the generated shape for `name`: '@' + the
    name's slug + '_' + exactly 2 digits and 2 lowercase letters. Used to
    accept the live-preview username the form sends on create."""
    prefix = f'{CLIENT_USERNAME_PREFIX}{_client_username_slug(name)}_'
    if not isinstance(username, str) or not username.startswith(prefix):
        return False
    code = username[len(prefix):]
    return (
        len(code) == _CLIENT_CODE_LENGTH
        and code.isascii() and code.isalnum() and code == code.lower()
        and sum(ch.isdigit() for ch in code) == _CLIENT_CODE_DIGITS
    )


def client_category_q(categories):
    """Q matching clients tagged with any of `categories` (category keys).
    Unknown keys are ignored; no valid key matches nothing."""
    q = models.Q(pk__in=[])
    for key in categories:
        field = CATEGORY_FIELDS.get(key)
        if field:
            q |= models.Q(**{field: True})
    return q


class Client(models.Model):
    """A saved client, shared across modules and tagged with one or more
    parent categories (the is_<category> boolean columns). Names may repeat;
    `username` is the unique, human-readable handle shown next to the name
    in pickers."""
    name = models.CharField(max_length=200, db_index=True)
    username = models.CharField(max_length=CLIENT_USERNAME_MAX_LENGTH, unique=True)
    is_active = models.BooleanField(default=True)
    notes = models.TextField(blank=True, default='')
    # Category tags (see CLIENT_CATEGORIES / CATEGORY_FIELDS).
    is_general = models.BooleanField(default=False, db_index=True)
    is_motor = models.BooleanField(default=False, db_index=True)
    is_sales = models.BooleanField(default=False, db_index=True)
    is_marine = models.BooleanField(default=False, db_index=True)
    is_medical = models.BooleanField(default=False, db_index=True)
    created_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.SET_NULL,
        related_name='clients_created',
        null=True, blank=True,
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ['name', 'id']

    def __str__(self):
        return f"{self.name} ({self.username})" if self.username else self.name

    def save(self, *args, **kwargs):
        if self.username:
            return super().save(*args, **kwargs)
        # Generated usernames are checked before use, but a concurrent insert
        # can still take the same one; draw a fresh code and retry.
        for attempt in range(5):
            self.username = generate_client_username(self.name)
            try:
                with transaction.atomic():
                    return super().save(*args, **kwargs)
            except IntegrityError:
                if attempt == 4:
                    raise
        return None

    @property
    def category_keys(self):
        """Tag keys in CLIENT_CATEGORIES order."""
        return [
            key for key, _ in CLIENT_CATEGORIES
            if getattr(self, CATEGORY_FIELDS[key])
        ]

    def set_categories(self, categories):
        """Set the is_<category> columns from a list of keys (does not save)."""
        wanted = set(categories)
        for key, field in CATEGORY_FIELDS.items():
            setattr(self, field, key in wanted)


def clients_matching_name(name, categories, active_only=True):
    """Clients tagged with any of `categories` whose normalised name equals
    `name`'s, oldest first. A case-insensitive regex narrows the rows in SQL;
    the exact comparison is then done in Python with normalise_client_name."""
    key = normalise_client_name(name)
    if not key:
        return []
    pattern = r'^\s*' + r'\s+'.join(re.escape(word) for word in key.split(' ')) + r'\s*$'
    qs = Client.objects.filter(client_category_q(categories), name__iregex=pattern)
    if active_only:
        qs = qs.filter(is_active=True)
    return [
        client for client in qs.order_by('id')
        if normalise_client_name(client.name) == key
    ]


def marine_client_link_cutoff():
    """settings.MARINE_CLIENT_LINK_CUTOFF ('YYYY-MM-DD') as an aware datetime:
    midnight of that date in settings.TIME_ZONE (Asia/Dubai). Marine New rows
    added before it may be linked to a saved client by their creator."""
    from datetime import date as _date, datetime as _datetime
    from zoneinfo import ZoneInfo

    try:
        cutoff = _date.fromisoformat(str(settings.MARINE_CLIENT_LINK_CUTOFF).strip())
    except ValueError:
        # settings.py already validates the env value; this only guards a
        # runtime override so a typo can never 500 the module.
        cutoff = _date(2026, 11, 1)
    return timezone.make_aware(
        _datetime.combine(cutoff, _datetime.min.time()), ZoneInfo(settings.TIME_ZONE),
    )


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
        lead → awaiting_quote / shared_with_client → won / lost
    The three non-terminal stages move freely in any direction (TED-533); Won
    and Lost are terminal.

    The three "Sent for quote" / "Quote received" / "Submitted to client"
    booleans are captured at the Won/Lost transition via the `update_status`
    endpoint. On a Won transition they are auto-set to True (TED-533 — the user
    is no longer asked); on Lost the user answers them. `converted_premium` is
    captured on Won (required) and optionally on Lost.
    """
    STATUS_LEAD = 'lead'
    STATUS_AWAITING_QUOTE = 'awaiting_quote'
    STATUS_SHARED_WITH_CLIENT = 'shared_with_client'
    STATUS_WON = 'won'
    STATUS_LOST = 'lost'

    STATUS_CHOICES = [
        (STATUS_LEAD, 'Lead'),
        (STATUS_AWAITING_QUOTE, 'Awaiting Quote'),
        (STATUS_SHARED_WITH_CLIENT, 'Shared with Client'),
        (STATUS_WON, 'Won'),
        (STATUS_LOST, 'Lost'),
    ]

    TERMINAL_STATUSES = {STATUS_WON, STATUS_LOST}

    # TED-533: the three non-terminal stages (Lead / Awaiting Quote / Shared
    # with Client) can move to one another in any direction — the frontend
    # applies these directly with no confirmation popup. Won/Lost are terminal.
    TRANSITIONS = {
        STATUS_LEAD: [STATUS_AWAITING_QUOTE, STATUS_SHARED_WITH_CLIENT, STATUS_WON, STATUS_LOST],
        STATUS_AWAITING_QUOTE: [STATUS_LEAD, STATUS_SHARED_WITH_CLIENT, STATUS_WON, STATUS_LOST],
        STATUS_SHARED_WITH_CLIENT: [STATUS_LEAD, STATUS_AWAITING_QUOTE, STATUS_WON, STATUS_LOST],
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
    # On Won they are forced to True (TED-533); on Lost the user supplies them.
    # Nullable while the enquiry is still Lead / Awaiting Quote / Shared with Client.
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

    def can_edit(self, user):
        """Won/Lost deals are locked — once closed they feed dashboard
        aggregates and the audit log, so the row shouldn't change after the
        fact. Falls back to the normal ownership + 30-min window for
        pre-terminal statuses.
        """
        if self.is_terminal:
            return False
        return super().can_edit(user)


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


class MarineNewEntry(StoredQualityMixin, BaseEntry):
    """Marine New enquiry — one row per customer enquiry with status state
    machine (TED-596). Mirrors GeneralNewEntry's shape, with three Marine
    differences: (1) class_of_insurance points at the dedicated
    MarineClassOfInsurance lookup, (2) two extra statuses — 'shared_with_client'
    (a non-terminal working stage) and 'rejected' (a terminal decline), and
    (3) the closing modal never re-confirms the class of insurance on a Won.
    """
    STATUS_NEW = 'new'
    # TED-656: 'In Progress' was removed as a status — 'Shared With Client' is
    # its replacement. The constant is retained ONLY to decode historical
    # MarineNewStatusTransition rows and to drive the one-off remap data
    # migration; it is no longer a selectable choice or a reachable transition.
    STATUS_IN_PROGRESS = 'in_progress'
    STATUS_SHARED_WITH_CLIENT = 'shared_with_client'
    STATUS_CONVERTED = 'converted'
    STATUS_REJECTED = 'rejected'
    STATUS_LOST = 'lost'

    STATUS_CHOICES = [
        (STATUS_NEW, 'New Enquiry'),
        (STATUS_SHARED_WITH_CLIENT, 'Shared With Client'),
        (STATUS_CONVERTED, 'Converted'),
        (STATUS_REJECTED, 'Rejected'),
        (STATUS_LOST, 'Lost'),
    ]

    TERMINAL_STATUSES = {STATUS_CONVERTED, STATUS_REJECTED, STATUS_LOST}

    # TED-656: New / Shared With Client are the open working stages that move
    # freely between each other; each can close to Converted (Won) / Rejected /
    # Lost (all terminal dead-ends). 'In Progress' is no longer a stage.
    TRANSITIONS = {
        STATUS_NEW: [STATUS_SHARED_WITH_CLIENT, STATUS_CONVERTED, STATUS_REJECTED, STATUS_LOST],
        STATUS_SHARED_WITH_CLIENT: [STATUS_NEW, STATUS_CONVERTED, STATUS_REJECTED, STATUS_LOST],
        STATUS_CONVERTED: [],
        STATUS_REJECTED: [],
        STATUS_LOST: [],
    }

    ACCURACY_DECAY = Decimal('0.9')

    # Legacy free-text name. Only rows added before the saved client list
    # (and not yet linked) hold text here; new rows and linked rows store ''
    # and read the name from `client`. Use `client_display` to show it.
    client_name = models.CharField(max_length=200)
    # The saved client this enquiry is for. Required for new rows (by the
    # serializer); null on legacy rows until their creator links one with the
    # link-client action. PROTECT keeps a linked client from being deleted.
    client = models.ForeignKey(
        'Client',
        on_delete=models.PROTECT,
        related_name='marine_new_entries',
        null=True, blank=True,
    )
    agent = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name='marine_new_enquiries_as_agent',
    )
    status = models.CharField(
        max_length=20, choices=STATUS_CHOICES, default=STATUS_NEW
    )
    revisions = models.PositiveIntegerField(default=0)
    quotes_compared = models.PositiveIntegerField(default=0)
    status_changed_at = models.DateTimeField(null=True, blank=True)
    # When the enquiry FIRST reached Shared With Client (a later re-share after
    # going back to New does not move it). Marine TAT ends here, not at close.
    shared_with_client_at = models.DateTimeField(null=True, blank=True)
    potential_premium = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
    )
    # Captured when the enquiry closes as Converted via the update-status flow.
    # NULL when not yet closed; forced to 0 on a Rejected/Lost close.
    converted_premium = models.DecimalField(
        max_digits=15, decimal_places=2, null=True, blank=True,
    )
    # TED-596: Marine uses its own class-of-insurance lookup, distinct from the
    # shared ClassOfInsurance used by General / Sales.
    class_of_insurance = models.ForeignKey(
        'MarineClassOfInsurance',
        on_delete=models.PROTECT,
        related_name='%(class)s_entries',
        null=True, blank=True,
    )
    insurance_company = models.ForeignKey(
        'InsuranceCompany',
        on_delete=models.PROTECT,
        related_name='marine_new_entries',
        null=True, blank=True,
    )
    # TED-592: insurers compared/quoted while the enquiry is open (the
    # create-modal multi-select).
    compared_insurance_companies = models.ManyToManyField(
        'InsuranceCompany',
        related_name='marine_new_compared',
        blank=True,
    )
    # TED-592 (corrected): the single insurer the client purchased from,
    # captured on Won (Converted). Kept separate from the legacy
    # `insurance_company` FK so the original column is never overwritten.
    # Marine New was created after migration 0049 and so missed that sweep;
    # 0051 backfills it from `insurance_company` for already-Won rows.
    converted_insurer = models.ForeignKey(
        'InsuranceCompany',
        on_delete=models.PROTECT,
        related_name='marine_new_converted',
        null=True, blank=True,
    )
    # Policy / Certificate Number, required (server-side) when the enquiry is
    # marked Won. Rows Won before this field existed keep ''.
    policy_number = models.CharField(max_length=100, blank=True, default='')
    # Optional insurer reference IDs captured on Shared With Client, keyed by
    # str(InsuranceCompany id) of a compared insurer -> reference string.
    insurer_references = models.JSONField(default=dict, blank=True)
    # Derived, search-only copy of the insurer reference *values* (space
    # joined), kept in sync by save(). Searching the JSON directly would also
    # match the insurer-id keys, and SQLite / Postgres store JSON differently.
    insurer_references_text = models.TextField(blank=True, default='', editable=False)

    class Meta(BaseEntry.Meta):
        verbose_name = 'Marine New Entry'
        verbose_name_plural = 'Marine New Entries'

    def __str__(self):
        return f"Marine New Enquiry - {self.client_display} ({self.status})"

    @staticmethod
    def build_insurer_references_text(refs):
        """The searchable text for an `insurer_references` dict: its values."""
        if not isinstance(refs, dict):
            return ''
        values = (str(v).strip() for v in refs.values() if v is not None)
        return ' '.join(v for v in values if v)

    def save(self, *args, **kwargs):
        self.insurer_references_text = self.build_insurer_references_text(
            self.insurer_references
        )
        # A partial save of the refs (update-status) must write the copy too.
        update_fields = kwargs.get('update_fields')
        if update_fields is not None and 'insurer_references' in update_fields:
            update_fields = list(update_fields)
            if 'insurer_references_text' not in update_fields:
                update_fields.append('insurer_references_text')
            kwargs['update_fields'] = update_fields
        super().save(*args, **kwargs)

    @property
    def client_display(self):
        """The linked client's name, else the legacy typed `client_name`."""
        if self.client_id is not None:
            return self.client.name
        return self.client_name

    def link_client_block_reason(self, user):
        """Why `user` cannot link this row to a saved client (None = can).
        Returns (http_status, message). Only the creator may link, once, on a
        non-voided row added before marine_client_link_cutoff(); HODs never.
        The 30-minute edit window does not apply."""
        from roles.permissions import user_is_hod

        if user is None or not user.is_authenticated or self.added_by_id != user.id:
            return 403, 'Only the creator of this enquiry can link it to a client.'
        if user_is_hod(user):
            return 403, 'HOD users cannot link enquiries to clients.'
        if self.is_voided:
            return 403, 'This entry has been voided and can no longer be modified.'
        if self.client_id is not None:
            return 409, 'This enquiry is already linked to a client.'
        if self.added_at is None or self.added_at >= marine_client_link_cutoff():
            return 400, 'Only enquiries added before the client list can be linked.'
        return None

    def can_link_client(self, user):
        return self.link_client_block_reason(user) is None

    @classmethod
    def get_allowed_transitions(cls, current_status):
        return cls.TRANSITIONS.get(current_status, [])

    @property
    def is_terminal(self):
        return self.status in self.TERMINAL_STATUSES

    def get_tat(self):
        """Marine TAT runs from creation to the first Shared With Client — it is
        fixed (and shown) as soon as the enquiry is shared, even while open.
        An enquiry closed without ever being shared falls back to the close
        time (creation → Won / Lost / Rejected)."""
        if self.shared_with_client_at is not None:
            return self.shared_with_client_at - self.added_at
        if not self.is_terminal or self.status_changed_at is None:
            return None
        return self.status_changed_at - self.added_at

    @classmethod
    def tat_spans(cls, queryset):
        """Mirror get_tat(): every shared row (open or closed), plus closed
        rows that were never shared (ending at their close stamp)."""
        rows = queryset.filter(
            models.Q(shared_with_client_at__isnull=False)
            | models.Q(
                status__in=sorted(cls.TERMINAL_STATUSES),
                status_changed_at__isnull=False,
            )
        ).values_list('added_at', 'shared_with_client_at', 'status_changed_at')
        return [(added, shared or closed) for added, shared, closed in rows]

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


class MarineNewStatusTransition(models.Model):
    """Records each status change for a marine new enquiry."""
    entry = models.ForeignKey(
        MarineNewEntry,
        on_delete=models.CASCADE,
        related_name='status_transitions',
    )
    from_status = models.CharField(
        max_length=20, choices=MarineNewEntry.STATUS_CHOICES, blank=True
    )
    to_status = models.CharField(
        max_length=20, choices=MarineNewEntry.STATUS_CHOICES
    )
    changed_by = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name='marine_new_status_changes',
    )
    changed_at = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ['changed_at']

    def __str__(self):
        return f"{self.entry_id}: {self.from_status} -> {self.to_status}"


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

    KIND_COMMENT = 'comment'
    KIND_VOID = 'void_reason'
    KIND_CHOICES = [
        (KIND_COMMENT, 'Comment'),
        (KIND_VOID, 'Void Reason'),
    ]

    text = models.TextField()
    # TED-594: 'void_reason' remarks are created automatically when an entry is
    # voided and shown in the panel with a "Void Reason" tag. They are immutable
    # — the serializer forces can_edit/can_delete to False for non-comment kinds.
    kind = models.CharField(max_length=20, choices=KIND_CHOICES, default=KIND_COMMENT)
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
