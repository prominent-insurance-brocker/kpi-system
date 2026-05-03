from datetime import date

from django.db import migrations, models


def backfill_calculated_date(apps, schema_editor):
    """Populate calculated_date for every existing target as the first of the month."""
    SalesMonthlyTarget = apps.get_model('entries', 'SalesMonthlyTarget')
    for target in SalesMonthlyTarget.objects.all():
        target.calculated_date = date(target.year, target.month, 1)
        target.save(update_fields=['calculated_date'])


def noop_reverse(apps, schema_editor):
    """Reverse is a no-op — column drop in the AddField reverse handles it."""
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0019_remove_saleskpi_existing_clients'),
    ]

    operations = [
        # 1. Add the column nullable so existing rows don't blow up.
        migrations.AddField(
            model_name='salesmonthlytarget',
            name='calculated_date',
            field=models.DateField(db_index=True, null=True),
        ),
        # 2. Backfill all existing rows from year/month.
        migrations.RunPython(backfill_calculated_date, reverse_code=noop_reverse),
        # 3. Tighten to NOT NULL — model definition is the source of truth.
        migrations.AlterField(
            model_name='salesmonthlytarget',
            name='calculated_date',
            field=models.DateField(db_index=True),
        ),
    ]
