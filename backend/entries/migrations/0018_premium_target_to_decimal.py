from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0017_saleskpi_existing_clients'),
    ]

    operations = [
        migrations.AlterField(
            model_name='salesmonthlytarget',
            name='premium_target',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=15, null=True),
        ),
    ]
