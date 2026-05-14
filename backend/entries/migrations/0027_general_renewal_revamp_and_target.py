"""General Renewal revamp + monthly target.

Mirrors the Motor Renewal shape (per-enquiry workflow with status state
machine + transition history + monthly retention target) but WITHOUT the
motor-specific chassis_no field. Existing rows were wiped in the preceding
0026 migration; running this on an empty table avoids the deferred-FK-trigger
issues that bit motor_claim's revamp (0023+0024).

Operations:
1. Remove the old per-day aggregate fields (quotations, quotes_revised,
   quotes_converted, tat, accuracy).
2. Add the per-enquiry fields (client_name, agent FK, remarks, status,
   revisions, quotes_compared, status_changed_at).
3. Create GeneralRenewalStatusTransition (audit trail per entry).
4. Create GeneralRenewalMonthlyTarget (per-user retention target).
"""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


STATUS_CHOICES = [
    ('new', 'New Enquiry'),
    ('retained', 'Retained'),
    ('lost', 'Lost'),
]


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0026_general_renewal_wipe_existing'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # 1. Drop the old daily-aggregate columns.
        migrations.RemoveField(model_name='generalrenewalentry', name='quotations'),
        migrations.RemoveField(model_name='generalrenewalentry', name='quotes_revised'),
        migrations.RemoveField(model_name='generalrenewalentry', name='quotes_converted'),
        migrations.RemoveField(model_name='generalrenewalentry', name='tat'),
        migrations.RemoveField(model_name='generalrenewalentry', name='accuracy'),

        # 2. Add the new per-enquiry fields (no chassis_no — general
        #    insurance products have no chassis).
        migrations.AddField(
            model_name='generalrenewalentry',
            name='client_name',
            field=models.CharField(default='', max_length=200),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='generalrenewalentry',
            name='agent',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name='general_renewal_enquiries_as_agent',
                to=settings.AUTH_USER_MODEL,
                null=True,
            ),
            preserve_default=False,
        ),
        # Tighten the FK to non-null now that the column exists. Table is
        # empty (just wiped in 0026), so this is safe.
        migrations.AlterField(
            model_name='generalrenewalentry',
            name='agent',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name='general_renewal_enquiries_as_agent',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='generalrenewalentry',
            name='remarks',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='generalrenewalentry',
            name='status',
            field=models.CharField(
                choices=STATUS_CHOICES,
                default='new',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='generalrenewalentry',
            name='revisions',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='generalrenewalentry',
            name='quotes_compared',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='generalrenewalentry',
            name='status_changed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),

        # 3. Create the GeneralRenewal status history table.
        migrations.CreateModel(
            name='GeneralRenewalStatusTransition',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('from_status', models.CharField(
                    blank=True,
                    choices=STATUS_CHOICES,
                    max_length=20,
                )),
                ('to_status', models.CharField(
                    choices=STATUS_CHOICES,
                    max_length=20,
                )),
                ('changed_at', models.DateTimeField(auto_now_add=True)),
                ('changed_by', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='general_renewal_status_changes',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('entry', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='status_transitions',
                    to='entries.generalrenewalentry',
                )),
            ],
            options={
                'ordering': ['changed_at'],
            },
        ),

        # 4. Create the GeneralRenewalMonthlyTarget table.
        migrations.CreateModel(
            name='GeneralRenewalMonthlyTarget',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('year', models.PositiveIntegerField()),
                ('month', models.PositiveIntegerField()),
                ('calculated_date', models.DateField(db_index=True)),
                ('clients_assigned', models.PositiveIntegerField(blank=True, null=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('user', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='general_renewal_monthly_targets',
                    to=settings.AUTH_USER_MODEL,
                )),
            ],
            options={
                'unique_together': {('user', 'year', 'month')},
            },
        ),
    ]
