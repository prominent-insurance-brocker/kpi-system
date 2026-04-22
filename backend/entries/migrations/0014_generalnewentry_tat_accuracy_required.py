from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0013_motornewentry_quotes_converted'),
    ]

    operations = [
        migrations.AlterField(
            model_name='generalnewentry',
            name='tat',
            field=models.PositiveIntegerField(verbose_name='TAT'),
        ),
        migrations.AlterField(
            model_name='generalnewentry',
            name='accuracy',
            field=models.DecimalField(decimal_places=2, max_digits=5),
        ),
    ]
