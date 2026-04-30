from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0016_rename_medical_claim_pending_to_in_progress'),
    ]

    operations = [
        migrations.AddField(
            model_name='saleskpientry',
            name='existing_clients',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='saleskpientry',
            name='existing_clients_closed',
            field=models.PositiveIntegerField(default=0),
        ),
    ]
