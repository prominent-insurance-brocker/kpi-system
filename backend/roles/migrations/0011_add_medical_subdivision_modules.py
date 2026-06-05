from django.db import migrations, models


class Migration(migrations.Migration):
    """TED: register the six placeholder medical sub-modules in
    RoleModulePermission.MODULE_CHOICES so admins can assign permissions
    ahead of the data-entry surfaces shipping. The frontend renders a
    Coming Soon placeholder for each route until the per-module pages
    are built out.
    """

    dependencies = [
        ('roles', '0010_rename_sales_kpi_label_to_deals'),
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
                    ('medical_individual_new', 'Medical Individual New'),
                    ('medical_individual_renewal', 'Medical Individual Renewal'),
                    ('medical_sme_new', 'Medical SME New'),
                    ('medical_sme_renewal', 'Medical SME Renewal'),
                    ('medical_corporate_new', 'Medical Corporate New'),
                    ('medical_corporate_renewal', 'Medical Corporate Renewal'),
                    ('settings', 'Settings'),
                ],
                max_length=50,
            ),
        ),
    ]
