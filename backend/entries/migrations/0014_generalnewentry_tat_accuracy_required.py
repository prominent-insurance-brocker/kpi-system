from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0013_motornewentry_quotes_converted'),
    ]

    operations = [
        migrations.AlterField(
            model_name='generalnewentry',
            name='tat',
            field=models.PositiveIntegerField(blank=True, null=True, verbose_name='TAT'),
        ),
        migrations.AlterField(
            model_name='generalnewentry',
            name='accuracy',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=5, null=True),
        ),
        migrations.AlterField(
            model_name='generalrenewalentry',
            name='tat',
            field=models.PositiveIntegerField(blank=True, null=True, verbose_name='TAT'),
        ),
        migrations.AlterField(
            model_name='generalrenewalentry',
            name='accuracy',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=5, null=True),
        ),
        migrations.AlterField(
            model_name='motornewentry',
            name='tat',
            field=models.PositiveIntegerField(blank=True, null=True, verbose_name='TAT'),
        ),
        migrations.AlterField(
            model_name='motornewentry',
            name='accuracy',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=5, null=True),
        ),
        migrations.AlterField(
            model_name='motorrenewalentry',
            name='tat',
            field=models.PositiveIntegerField(blank=True, null=True, verbose_name='TAT'),
        ),
        migrations.AlterField(
            model_name='motorrenewalentry',
            name='accuracy',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=5, null=True),
        ),
    ]
