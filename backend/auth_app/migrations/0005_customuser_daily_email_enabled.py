from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('auth_app', '0004_alter_customuser_full_name'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='daily_email_enabled',
            field=models.BooleanField(default=True),
        ),
    ]
