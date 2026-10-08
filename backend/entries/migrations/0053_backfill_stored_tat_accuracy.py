"""Backfill the stored TAT / Accuracy columns added in 0052.

1. Marine New `shared_with_client_at` = the FIRST recorded 'shared_with_client'
   transition. Entries with none fall back to their first 'in_progress'
   transition (the stage 0050 / TED-656 remapped to Shared With Client).
2. `tat_minutes` / `accuracy` on every per-enquiry table, using the same rules
   as the models' get_tat() / accuracy_pct (historical models have no methods,
   so the rules are restated here):
     - TAT: closed rows with a close stamp → close − creation. Marine New ends
       at the first share instead, falling back to the close for rows closed
       without ever being shared.
     - Accuracy: closed rows → 100 × 0.9^revisions.

Additive only: no existing column or transition row is modified. Reverse is a
no-op (0052's reverse drops the columns).
"""
from decimal import Decimal

from django.db import migrations
from django.db.models import Min

DECAY = Decimal('0.9')
TWO_DP = Decimal('0.01')

# model name → terminal statuses (mirrors each model's TERMINAL_STATUSES)
ENQUIRY_MODELS = {
    'GeneralNewEntry': {'converted', 'lost', 'rejected'},
    'GeneralRenewalEntry': {'retained', 'lost', 'rejected'},
    'MotorNewEntry': {'converted', 'lost', 'rejected'},
    'MotorRenewalEntry': {'retained', 'lost', 'rejected'},
    'MotorFleetNewEntry': {'converted', 'lost', 'rejected'},
    'MotorFleetRenewalEntry': {'retained', 'lost', 'rejected'},
    'MarineNewEntry': {'converted', 'rejected', 'lost'},
}


def _tat_minutes(start, end):
    if start is None or end is None:
        return None
    return Decimal((end - start).total_seconds() / 60).quantize(TWO_DP)


def _accuracy(revisions):
    return Decimal(float(Decimal('100') * (DECAY ** revisions))).quantize(TWO_DP)


def backfill(apps, schema_editor):
    MarineNewEntry = apps.get_model('entries', 'MarineNewEntry')
    MarineNewStatusTransition = apps.get_model('entries', 'MarineNewStatusTransition')

    def _first(to_status):
        return dict(
            MarineNewStatusTransition.objects
            .filter(to_status=to_status)
            .values('entry_id')
            .annotate(first=Min('changed_at'))
            .values_list('entry_id', 'first')
        )

    # A real Shared With Client transition always wins. Between 0048 and 0050
    # 'in_progress' and 'shared_with_client' were separate stages, so an
    # in_progress row only stands in for the share on entries that never
    # recorded one (those 0050 remapped from in_progress).
    first_share = {**_first('in_progress'), **_first('shared_with_client')}
    to_update = []
    for entry in MarineNewEntry.objects.filter(
        shared_with_client_at__isnull=True, pk__in=list(first_share),
    ):
        entry.shared_with_client_at = first_share[entry.pk]
        to_update.append(entry)
    MarineNewEntry.objects.bulk_update(
        to_update, ['shared_with_client_at'], batch_size=500,
    )

    for model_name, terminal in ENQUIRY_MODELS.items():
        Model = apps.get_model('entries', model_name)
        is_marine = model_name == 'MarineNewEntry'
        changed = []
        for entry in Model.objects.all().iterator():
            closed = entry.status in terminal
            end = entry.status_changed_at if closed else None
            if is_marine and entry.shared_with_client_at is not None:
                end = entry.shared_with_client_at
            entry.tat_minutes = _tat_minutes(entry.added_at, end)
            entry.accuracy = _accuracy(entry.revisions) if closed else None
            changed.append(entry)
        Model.objects.bulk_update(
            changed, ['tat_minutes', 'accuracy'], batch_size=500,
        )


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0052_stored_tat_accuracy'),
    ]

    operations = [
        migrations.RunPython(backfill, migrations.RunPython.noop),
    ]
