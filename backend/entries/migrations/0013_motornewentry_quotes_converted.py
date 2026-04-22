from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0012_rename_motor_claim_pending_to_in_progress'),
    ]

    operations = [
        migrations.AddField(
            model_name='motornewentry',
            name='quotes_converted',
            field=models.PositiveIntegerField(default=0),
            preserve_default=False,
        ),
    ]
