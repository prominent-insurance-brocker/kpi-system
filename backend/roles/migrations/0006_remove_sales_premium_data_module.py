from django.db import migrations, models


def purge_orphan_permissions(apps, schema_editor):
    """Delete any RoleModulePermission rows still pointing at sales_premium_data."""
    RoleModulePermission = apps.get_model('roles', 'RoleModulePermission')
    RoleModulePermission.objects.filter(module='sales_premium_data').delete()


def noop(apps, schema_editor):
    """Reverse is a no-op — we cannot recreate deleted rows."""
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('roles', '0005_alter_rolemodulepermission_module'),
    ]

    operations = [
        migrations.RunPython(purge_orphan_permissions, noop),
        migrations.AlterField(
            model_name='rolemodulepermission',
            name='module',
            field=models.CharField(
                choices=[
                    ('general_new', 'General New'),
                    ('general_renewal', 'General Renewal'),
                    ('general_claim', 'General Claim'),
                    ('motor_new', 'Motor New'),
                    ('motor_renewal', 'Motor Renewal'),
                    ('motor_claim', 'Motor Claim'),
                    ('sales_kpi', 'Sales KPI'),
                    ('marine_new', 'Marine New'),
                    ('marine_renewal', 'Marine Renewal'),
                    ('medical_claim', 'Medical Claim'),
                ],
                max_length=50,
            ),
        ),
    ]
