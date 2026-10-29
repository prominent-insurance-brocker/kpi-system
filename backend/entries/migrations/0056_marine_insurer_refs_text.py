from django.db import migrations, models


def backfill_insurer_references_text(apps, schema_editor):
    """Fill the search copy for rows saved before the column existed. Only the
    new derived column is written; `insurer_references` itself is untouched."""
    MarineNewEntry = apps.get_model('entries', 'MarineNewEntry')
    batch = []
    for entry in MarineNewEntry.objects.only('id', 'insurer_references').iterator():
        refs = entry.insurer_references if isinstance(entry.insurer_references, dict) else {}
        values = (str(v).strip() for v in refs.values() if v is not None)
        text = ' '.join(v for v in values if v)
        if text:
            entry.insurer_references_text = text
            batch.append(entry)
    MarineNewEntry.objects.bulk_update(batch, ['insurer_references_text'], batch_size=500)


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0055_client'),
    ]

    operations = [
        migrations.AddField(
            model_name='marinenewentry',
            name='insurer_references_text',
            field=models.TextField(blank=True, default='', editable=False),
        ),
        migrations.RunPython(backfill_insurer_references_text, migrations.RunPython.noop),
    ]
