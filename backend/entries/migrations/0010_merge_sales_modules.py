from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


def delete_sales_premium_data_permissions(apps, schema_editor):
    RoleModulePermission = apps.get_model('roles', 'RoleModulePermission')
    RoleModulePermission.objects.filter(module='sales_premium_data').delete()


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0009_add_unique_together_general_new'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
        ('roles', '0005_alter_rolemodulepermission_module'),
    ]

    operations = [
        # Remove SalesPremiumDataEntry table
        migrations.DeleteModel(
            name='SalesPremiumDataEntry',
        ),
        # Remove old SalesKPIEntry fields
        migrations.RemoveField(
            model_name='saleskpientry',
            name='existing_clients',
        ),
        migrations.RemoveField(
            model_name='saleskpientry',
            name='existing_clients_closed',
        ),
        # Add gross_booked_premium to SalesKPIEntry (default 0 for existing rows)
        migrations.AddField(
            model_name='saleskpientry',
            name='gross_booked_premium',
            field=models.DecimalField(decimal_places=2, max_digits=15, default=0),
            preserve_default=False,
        ),
        # Create SalesMonthlyTarget table
        migrations.CreateModel(
            name='SalesMonthlyTarget',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('year', models.PositiveIntegerField()),
                ('month', models.PositiveIntegerField()),
                ('premium_target', models.DecimalField(blank=True, decimal_places=2, max_digits=15, null=True)),
                ('clients_assigned', models.PositiveIntegerField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='sales_monthly_targets',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'unique_together': {('user', 'year', 'month')},
            },
        ),
        # Delete RoleModulePermission records for sales_premium_data
        migrations.RunPython(
            delete_sales_premium_data_permissions,
            migrations.RunPython.noop,
        ),
    ]
