from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('roles', '0006_remove_sales_premium_data_module'),
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
                    ('sales_kpi', 'Sales KPI'),
                    ('marine_new', 'Marine New'),
                    ('marine_renewal', 'Marine Renewal'),
                    ('medical_claim', 'Medical Claim'),
                    ('settings', 'Settings'),
                ],
                max_length=50,
            ),
        ),
    ]
