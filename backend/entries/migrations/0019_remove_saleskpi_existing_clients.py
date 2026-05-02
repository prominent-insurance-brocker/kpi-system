from django.db import migrations


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0018_premium_target_to_decimal'),
    ]

    operations = [
        migrations.RemoveField(
            model_name='saleskpientry',
            name='existing_clients',
        ),
    ]
