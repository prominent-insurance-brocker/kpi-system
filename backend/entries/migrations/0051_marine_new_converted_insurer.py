from django.db import migrations, models
import django.db.models.deletion


def backfill_converted_insurer(apps, schema_editor):
    """Marine New missed migration 0049 (the module was still being revamped in
    0047/0048), so its Won modal kept writing the purchased insurer into the
    legacy `insurance_company` column. Copy that value into the new
    `converted_insurer` for every already-Converted row so history still
    displays correctly. `insurance_company` is never modified."""
    MarineNewEntry = apps.get_model('entries', 'MarineNewEntry')
    MarineNewEntry.objects.filter(
        status='converted', insurance_company__isnull=False,
    ).update(converted_insurer=models.F('insurance_company'))


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0050_marine_new_drop_in_progress'),
    ]

    operations = [
        migrations.AddField(
            model_name='marinenewentry',
            name='converted_insurer',
            field=models.ForeignKey(blank=True, null=True, on_delete=django.db.models.deletion.PROTECT, related_name='marine_new_converted', to='entries.insurancecompany'),
        ),
        migrations.RunPython(backfill_converted_insurer, migrations.RunPython.noop),
    ]
