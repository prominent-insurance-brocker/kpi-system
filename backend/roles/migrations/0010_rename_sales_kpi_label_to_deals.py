from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('roles', '0009_role_is_hod'),
    ]

    operations = [
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
                    ('motor_fleet_new', 'Motor Fleet New'),
                    ('motor_fleet_renewal', 'Motor Fleet Renewal'),
                    ('sales_kpi', 'Deals'),
                    ('marine_new', 'Marine New'),
                    ('marine_renewal', 'Marine Renewal'),
                    ('medical_claim', 'Medical Claim'),
                    ('settings', 'Settings'),
                ],
                max_length=50,
            ),
        ),
    ]
