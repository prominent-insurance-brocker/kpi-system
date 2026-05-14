"""Make PIB ids per-module rather than globally unique.

Each entry module now has its own PIB counter that restarts at 1 — so
Motor New, Motor Renewal, etc. each get their own PIB-1 / PIB-2 sequence.
Previously a single global PIBSequence row handed out one increasing
number across all entry tables, which mixed unrelated modules in the same
id space (a motor enquiry could be PIB-47 and a medical claim PIB-48).

Operations:
1. Drop the existing single-row PIBSequence content (we recreate per
   module below).
2. Add the `module` column with a unique index.
3. Renumber every existing entry's `pib_id` per module, ordered by
   `(added_at, id)` so the original creation order is preserved within
   each module. Seed PIBSequence with one row per module pointing at the
   new last_number.
"""
from django.db import migrations, models


ENTRY_MODELS = [
    ('entries', 'GeneralNewEntry'),
    ('entries', 'GeneralRenewalEntry'),
    ('entries', 'MotorNewEntry'),
    ('entries', 'MotorRenewalEntry'),
    ('entries', 'MotorFleetNewEntry'),
    ('entries', 'MotorFleetRenewalEntry'),
    ('entries', 'MotorClaimEntry'),
    ('entries', 'SalesKPIEntry'),
    ('entries', 'MarineNewEntry'),
    ('entries', 'MarineRenewalEntry'),
    ('entries', 'MedicalClaimEntry'),
]


def wipe_sequence_rows(apps, schema_editor):
    PIBSequence = apps.get_model('entries', 'PIBSequence')
    PIBSequence.objects.all().delete()


def renumber_pib_ids_per_module(apps, schema_editor):
    PIBSequence = apps.get_model('entries', 'PIBSequence')
    for app_label, model_name in ENTRY_MODELS:
        Model = apps.get_model(app_label, model_name)
        rows = list(
            Model.objects.all()
            .order_by('added_at', 'id')
            .values_list('id', flat=True)
        )
        for idx, entry_id in enumerate(rows, start=1):
            Model.objects.filter(pk=entry_id).update(pib_id=f"PIB-{idx}")
        if rows:
            PIBSequence.objects.update_or_create(
                module=Model._meta.model_name,
                defaults={'last_number': len(rows)},
            )


def reverse_noop(apps, schema_editor):
    """Reverse is destructive enough that we don't try to rebuild the old
    global sequence — leave the migration one-way."""
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0028_motorfleetnewentry_motorfleetrenewalentry_and_more'),
    ]

    operations = [
        # 1. Empty the table first so the unique index added in step 2 has
        #    no rows to conflict on.
        migrations.RunPython(wipe_sequence_rows, reverse_code=reverse_noop),

        # 2. Add the per-module key. Unique = each module has at most one
        #    counter row.
        migrations.AddField(
            model_name='pibsequence',
            name='module',
            field=models.CharField(max_length=50, unique=True, default=''),
            preserve_default=False,
        ),

        # 3. Renumber existing entries + seed the per-module counters.
        migrations.RunPython(renumber_pib_ids_per_module, reverse_code=reverse_noop),
    ]
