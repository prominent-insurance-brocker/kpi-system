from django.conf import settings
from django.contrib.contenttypes.fields import GenericForeignKey
from django.contrib.contenttypes.models import ContentType
from django.db import models


class AuditLog(models.Model):
    """Immutable record of a create / update / delete on an audited model.

    Written by the signal handlers in ``audit.signals`` (one row per mutation,
    with a field-level ``changes`` diff). Exposed read-only and admin-only via
    ``AuditLogViewSet``. ``category`` is denormalised so the common "logs for
    one module, newest first" read needs no joins.
    """
    ACTION_CREATE = 'create'
    ACTION_UPDATE = 'update'
    ACTION_DELETE = 'delete'
    ACTION_CHOICES = [
        (ACTION_CREATE, 'Created'),
        (ACTION_UPDATE, 'Updated'),
        (ACTION_DELETE, 'Deleted'),
    ]

    category = models.CharField(max_length=50, db_index=True)
    content_type = models.ForeignKey(
        ContentType, null=True, blank=True, on_delete=models.SET_NULL
    )
    object_id = models.PositiveBigIntegerField(null=True, blank=True)
    target = GenericForeignKey('content_type', 'object_id')
    # Human-friendly id of the target, captured at write time so it survives a
    # later deletion (pib_id for entries, else str(instance)).
    object_label = models.CharField(max_length=255, blank=True, default='')
    # The audited model's verbose name (e.g. "motor new entry", "role") so the
    # grouped categories (Users & Roles, Monthly Targets) can distinguish rows.
    model_label = models.CharField(max_length=100, blank=True, default='')
    action = models.CharField(max_length=10, choices=ACTION_CHOICES, db_index=True)
    # {field_name: {"old": <value>, "new": <value>}}
    changes = models.JSONField(default=dict, blank=True)
    actor = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        null=True,
        blank=True,
        on_delete=models.SET_NULL,
        related_name='audit_logs',
    )
    timestamp = models.DateTimeField(auto_now_add=True, db_index=True)
    ip_address = models.GenericIPAddressField(null=True, blank=True)

    class Meta:
        ordering = ['-timestamp']
        indexes = [
            models.Index(fields=['category', '-timestamp']),
            models.Index(fields=['actor', '-timestamp']),
            models.Index(fields=['content_type', 'object_id']),
        ]

    def __str__(self):
        return f"{self.get_action_display()} {self.model_label} #{self.object_id}"
