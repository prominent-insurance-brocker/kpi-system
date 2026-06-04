from django.db import migrations, models


class Migration(migrations.Migration):
    """TED-496: SalesMonthlyTarget.clients_assigned changes type from
    PositiveIntegerField to DecimalField(15, 2). The column now stores a
    currency value (Renewal Premium Target) rather than an integer client
    count. Existing integer values cast cleanly to decimals (40 → 40.00).
    """

    dependencies = [
        ('entries', '0037_converted_premium_per_enquiry'),
    ]

    operations = [
        migrations.AlterField(
            model_name='salesmonthlytarget',
            name='clients_assigned',
            field=models.DecimalField(
                blank=True, decimal_places=2, max_digits=15, null=True,
            ),
        ),
    ]
