"""Bundled Motor New/Renewal updates:

1. Add `quotes_compared` PositiveIntegerField to MotorNewEntry + MotorRenewalEntry.
2. Rename Motor Renewal status enum 'converted' -> 'retained' (data migration
   covering MotorRenewalEntry.status + MotorRenewalStatusTransition.from_status
   + to_status, then AlterField on the choices). Reversible.
3. Create MotorRenewalMonthlyTarget table (mirrors SalesMonthlyTarget but only
   tracks clients_assigned — no premium_target).
"""
from django.conf import settings
from django.db import migrations, models


def forwards(apps, schema_editor):
    """Flip MotorRenewalEntry 'converted' rows to 'retained' + sync transitions."""
    MotorRenewalEntry = apps.get_model('entries', 'MotorRenewalEntry')
    MotorRenewalStatusTransition = apps.get_model('entries', 'MotorRenewalStatusTransition')
    MotorRenewalEntry.objects.filter(status='converted').update(status='retained')
    MotorRenewalStatusTransition.objects.filter(from_status='converted').update(from_status='retained')
    MotorRenewalStatusTransition.objects.filter(to_status='converted').update(to_status='retained')


def backwards(apps, schema_editor):
    MotorRenewalEntry = apps.get_model('entries', 'MotorRenewalEntry')
    MotorRenewalStatusTransition = apps.get_model('entries', 'MotorRenewalStatusTransition')
    MotorRenewalEntry.objects.filter(status='retained').update(status='converted')
    MotorRenewalStatusTransition.objects.filter(from_status='retained').update(from_status='converted')
    MotorRenewalStatusTransition.objects.filter(to_status='retained').update(to_status='converted')


RENEWAL_NEW_CHOICES = [
    ('new', 'New Enquiry'),
    ('retained', 'Retained'),
    ('lost', 'Lost'),
]


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0021_motor_new_revamp'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # 1. Add `quotes_compared` to both motor entry models.
        migrations.AddField(
            model_name='motornewentry',
            name='quotes_compared',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='motorrenewalentry',
            name='quotes_compared',
            field=models.PositiveIntegerField(default=0),
        ),

        # 2. Data migration: 'converted' -> 'retained' for motor_renewal.
        migrations.RunPython(forwards, backwards),

        # 3. Tighten status choices to the new enum.
        migrations.AlterField(
            model_name='motorrenewalentry',
            name='status',
            field=models.CharField(
                choices=RENEWAL_NEW_CHOICES,
                default='new',
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name='motorrenewalstatustransition',
            name='from_status',
            field=models.CharField(
                blank=True,
                choices=RENEWAL_NEW_CHOICES,
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name='motorrenewalstatustransition',
            name='to_status',
            field=models.CharField(
                choices=RENEWAL_NEW_CHOICES,
                max_length=20,
            ),
        ),

        # 4. Create the MotorRenewalMonthlyTarget table.
        migrations.CreateModel(
            name='MotorRenewalMonthlyTarget',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('year', models.PositiveIntegerField()),
                ('month', models.PositiveIntegerField()),
                ('calculated_date', models.DateField(db_index=True)),
                ('clients_assigned', models.PositiveIntegerField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(
                    on_delete=models.deletion.CASCADE,
                    related_name='motor_renewal_monthly_targets',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'unique_together': {('user', 'year', 'month')},
            },
        ),
    ]
