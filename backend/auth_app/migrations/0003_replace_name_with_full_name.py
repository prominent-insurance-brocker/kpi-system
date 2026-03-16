from django.db import migrations, models


def combine_names(apps, schema_editor):
    CustomUser = apps.get_model('auth_app', 'CustomUser')
    for user in CustomUser.objects.all():
        user.full_name = f"{user.first_name} {user.last_name}".strip()
        user.save(update_fields=['full_name'])


def split_names(apps, schema_editor):
    CustomUser = apps.get_model('auth_app', 'CustomUser')
    for user in CustomUser.objects.all():
        parts = user.full_name.split(' ', 1)
        user.first_name = parts[0] if parts else ''
        user.last_name = parts[1] if len(parts) > 1 else ''
        user.save(update_fields=['first_name', 'last_name'])


class Migration(migrations.Migration):

    dependencies = [
        ('auth_app', '0002_customuser_role_magiclink'),
    ]

    operations = [
        migrations.AddField(
            model_name='customuser',
            name='full_name',
            field=models.CharField(blank=True, default='', max_length=100),
        ),
        migrations.RunPython(combine_names, split_names),
        migrations.RemoveField(
            model_name='customuser',
            name='first_name',
        ),
        migrations.RemoveField(
            model_name='customuser',
            name='last_name',
        ),
    ]
