"""Audit signal handlers.

Connected in ``AuditConfig.ready()`` for every model in ``MODEL_TO_CATEGORY``:

* ``pre_save``   snapshots the previous DB row (skipped on creates).
* ``post_save``  records the full initial state (create) or a field-level diff
                 (update); no row is written when an update changes nothing.
* ``post_delete`` records the final state.

The acting user + client IP come from ``auth_app.audit_context`` (populated by
``AuditActorMiddleware``); management-command / cron / shell writes have no
request, so ``actor`` is null and renders as "System".

Note: signals fire on ``.save()`` / ``.delete()`` only -- bulk
``QuerySet.update()`` / ``bulk_create`` are not captured (they bypass signals).
"""
import logging
from decimal import Decimal

from django.contrib.contenttypes.models import ContentType
from django.db.models.signals import post_delete, post_save, pre_save

from auth_app.audit_context import get_actor_id, get_ip_address

from .models import AuditLog
from .registry import MODEL_TO_CATEGORY, PER_MODEL_IGNORED_FIELDS

logger = logging.getLogger(__name__)

# Fields excluded from every model's diff (auto/housekeeping fields).
IGNORED_FIELDS = {'updated_at'}


def _ignored_for(instance):
    return IGNORED_FIELDS | PER_MODEL_IGNORED_FIELDS.get(type(instance), set())


def _normalize(value):
    """Coerce a field value into something JSON-serialisable and diff-stable."""
    if isinstance(value, Decimal):
        return str(value)
    if hasattr(value, 'isoformat'):  # date / datetime / time
        return value.isoformat()
    return value


def _fk_label(instance, field):
    """Human label for a foreign-key field's value, or None if unset/missing.

    Resolved at write time so the audit row records what the relation was at the
    moment of the change (and survives a later rename/deletion of the related
    row). Defensive: a cascade may have already removed the related row.
    """
    try:
        related = getattr(instance, field.name)
    except Exception:
        return None
    return str(related) if related is not None else None


def _snapshot(instance):
    """Map each tracked field to ``{"cmp": <comparable>, "disp": <display>}``.

    FK fields compare by id (precise change detection) but display the related
    object's label; other fields use their normalized value for both. The key is
    the field's bare name for FKs (``added_by``, not ``added_by_id``).
    """
    snapshot = {}
    ignored = _ignored_for(instance)
    for field in instance._meta.concrete_fields:
        if field.primary_key:
            continue
        if field.attname in ignored or field.name in ignored:
            continue
        if field.is_relation:
            fk_id = getattr(instance, field.attname)
            snapshot[field.name] = {
                'cmp': fk_id,
                'disp': _fk_label(instance, field) if fk_id is not None else None,
            }
        else:
            value = _normalize(getattr(instance, field.attname))
            snapshot[field.attname] = {'cmp': value, 'disp': value}
    return snapshot


def _object_label(instance):
    pib = getattr(instance, 'pib_id', '') or ''
    if pib:
        return str(pib)[:255]
    return str(instance)[:255]


def _write(instance, action, changes):
    try:
        AuditLog.objects.create(
            category=MODEL_TO_CATEGORY[type(instance)],
            content_type=ContentType.objects.get_for_model(type(instance)),
            object_id=instance.pk,
            object_label=_object_label(instance),
            model_label=str(instance._meta.verbose_name),
            action=action,
            changes=changes,
            actor_id=get_actor_id(),
            ip_address=get_ip_address(),
        )
    except Exception:  # auditing must never break a real mutation
        logger.exception("Failed to write audit log for %s", type(instance).__name__)


def audit_pre_save(sender, instance, **kwargs):
    if not instance.pk:
        return  # create -> nothing to diff
    try:
        previous = sender.objects.get(pk=instance.pk)
    except sender.DoesNotExist:
        return  # save-with-forced-pk (rare); treat as create, no diff
    instance._audit_pre_state = _snapshot(previous)


def audit_post_save(sender, instance, created, **kwargs):
    if created:
        snapshot = _snapshot(instance)
        changes = {key: {'old': None, 'new': v['disp']} for key, v in snapshot.items()}
        _write(instance, AuditLog.ACTION_CREATE, changes)
        return

    pre = getattr(instance, '_audit_pre_state', None)
    if pre is None:
        return  # pre_save was skipped (no prior row) -> nothing to diff
    post = _snapshot(instance)
    changes = {}
    for key, post_v in post.items():
        pre_v = pre.get(key, {'cmp': None, 'disp': None})
        if pre_v['cmp'] != post_v['cmp']:
            changes[key] = {'old': pre_v['disp'], 'new': post_v['disp']}
    if changes:
        _write(instance, AuditLog.ACTION_UPDATE, changes)


def audit_post_delete(sender, instance, **kwargs):
    snapshot = _snapshot(instance)
    changes = {key: {'old': v['disp'], 'new': None} for key, v in snapshot.items()}
    _write(instance, AuditLog.ACTION_DELETE, changes)


def connect():
    """Wire the three receivers for every audited model (idempotent)."""
    for model in MODEL_TO_CATEGORY:
        name = model.__name__
        pre_save.connect(audit_pre_save, sender=model, dispatch_uid=f'audit_pre_{name}')
        post_save.connect(audit_post_save, sender=model, dispatch_uid=f'audit_post_{name}')
        post_delete.connect(audit_post_delete, sender=model, dispatch_uid=f'audit_del_{name}')
