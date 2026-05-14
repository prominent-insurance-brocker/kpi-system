"""Add a globally unique PIB-N display id to every BaseEntry subclass.

Schema:
- Creates PIBSequence (single-row counter).
- Adds nullable-ish `pib_id` CharField on all 9 entry tables.

Data backfill:
- Walks every existing entry across all 9 tables, sorted by (added_at, table, id),
  and assigns PIB-1, PIB-2, ... in that order.
- Updates PIBSequence.last_number so new entries continue from the next number.
"""
from django.db import migrations, models


ENTRY_MODELS = [
    ('entries', 'GeneralNewEntry'),
    ('entries', 'GeneralRenewalEntry'),
    ('entries', 'MotorNewEntry'),
    ('entries', 'MotorRenewalEntry'),
    ('entries', 'MotorClaimEntry'),
    ('entries', 'SalesKPIEntry'),
    ('entries', 'MarineNewEntry'),
    ('entries', 'MarineRenewalEntry'),
    ('entries', 'MedicalClaimEntry'),
]


def backfill_pib_ids(apps, schema_editor):
    PIBSequence = apps.get_model('entries', 'PIBSequence')

    # Collect (added_at, table_label, id, model_class) tuples across every table.
    rows = []
    for app_label, model_name in ENTRY_MODELS:
        Model = apps.get_model(app_label, model_name)
        for entry in Model.objects.all().only('id', 'added_at'):
            rows.append((entry.added_at, model_name, entry.id, Model))

    # Stable global order: oldest creation first; tie-break by model + id.
    rows.sort(key=lambda r: (r[0], r[1], r[2]))

    for i, (_, _, entry_id, Model) in enumerate(rows, start=1):
        Model.objects.filter(pk=entry_id).update(pib_id=f"PIB-{i}")

    PIBSequence.objects.update_or_create(pk=1, defaults={'last_number': len(rows)})


def reverse_backfill(apps, schema_editor):
    # Wipe pib_id values on all entries; drop the sequence row.
    for app_label, model_name in ENTRY_MODELS:
        Model = apps.get_model(app_label, model_name)
        Model.objects.all().update(pib_id='')
    PIBSequence = apps.get_model('entries', 'PIBSequence')
    PIBSequence.objects.all().delete()


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0024_motor_claim_revamp_and_settings'),
    ]

    operations = [
        migrations.CreateModel(
            name='PIBSequence',
            fields=[
                ('id', models.AutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('last_number', models.PositiveBigIntegerField(default=0)),
            ],
        ),
        migrations.AddField(
            model_name='generalnewentry',
            name='pib_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=20),
        ),
        migrations.AddField(
            model_name='generalrenewalentry',
            name='pib_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=20),
        ),
        migrations.AddField(
            model_name='motornewentry',
            name='pib_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=20),
        ),
        migrations.AddField(
            model_name='motorrenewalentry',
            name='pib_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=20),
        ),
        migrations.AddField(
            model_name='motorclaimentry',
            name='pib_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=20),
        ),
        migrations.AddField(
            model_name='saleskpientry',
            name='pib_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=20),
        ),
        migrations.AddField(
            model_name='marinenewentry',
            name='pib_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=20),
        ),
        migrations.AddField(
            model_name='marinerenewalentry',
            name='pib_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=20),
        ),
        migrations.AddField(
            model_name='medicalclaimentry',
            name='pib_id',
            field=models.CharField(blank=True, db_index=True, default='', max_length=20),
        ),
        migrations.RunPython(backfill_pib_ids, reverse_backfill),
    ]
