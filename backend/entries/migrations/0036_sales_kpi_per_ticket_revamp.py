"""Sales KPI → per-ticket workflow (TED-446).

Replaces the original per-day KPI aggregate schema (leads_to_ops_team,
quotes_from_ops_team, etc.) with a per-enquiry ticket shape: customer_name,
entry_type, class_of_insurance FK, assignee FK, potential_premium, status
state machine, plus the three TED-447 workflow booleans and a
converted_premium that's captured when the enquiry closes as Won.

Adds the SalesKPIStatusTransition audit table.

SalesMonthlyTarget is intentionally left untouched — the per-user monthly
premium / clients_assigned target rows continue to drive the side panel.

Operations:
  1. Wipe all existing SalesKPIEntry rows (matches the motor_claim 0023
     pattern — old per-day data has no clean ticket equivalent).
  2. Drop the eight legacy aggregate columns.
  3. Add the per-ticket columns.
  4. Create SalesKPIStatusTransition.
"""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


STATUS_CHOICES = [
    ('lead', 'Lead'),
    ('in_progress', 'In Progress'),
    ('won', 'Won'),
    ('lost', 'Lost'),
]

TYPE_CHOICES = [
    ('new', 'New'),
    ('renewal', 'Renewal'),
]


def wipe_sales_kpi_rows(apps, schema_editor):
    SalesKPIEntry = apps.get_model('entries', 'SalesKPIEntry')
    SalesKPIEntry.objects.all().delete()


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0035_general_class_of_insurance_to_fk'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # 1. Wipe legacy rows first so the destructive RemoveField calls below
        #    don't have to ALTER a non-empty table for required columns.
        migrations.RunPython(wipe_sales_kpi_rows, reverse_code=noop),

        # 2. Drop the old per-day aggregate columns.
        migrations.RemoveField(model_name='saleskpientry', name='leads_to_ops_team'),
        migrations.RemoveField(model_name='saleskpientry', name='quotes_from_ops_team'),
        migrations.RemoveField(model_name='saleskpientry', name='quotes_to_client'),
        migrations.RemoveField(model_name='saleskpientry', name='total_conversions'),
        migrations.RemoveField(model_name='saleskpientry', name='new_clients_acquired'),
        migrations.RemoveField(model_name='saleskpientry', name='existing_clients_closed'),
        migrations.RemoveField(model_name='saleskpientry', name='gross_booked_premium'),

        # 3. Add the per-ticket columns. All required FKs come in as nullable
        #    first (the table is empty so the AlterField tightening immediately
        #    after is safe). Mirrors the motor_new_revamp pattern from 0021.
        migrations.AddField(
            model_name='saleskpientry',
            name='customer_name',
            field=models.CharField(default='', max_length=200),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='saleskpientry',
            name='entry_type',
            field=models.CharField(choices=TYPE_CHOICES, default='new', max_length=20),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='saleskpientry',
            name='class_of_insurance',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name='sales_kpi_entries',
                to='entries.ClassOfInsurance',
                null=True,
            ),
            preserve_default=False,
        ),
        migrations.AlterField(
            model_name='saleskpientry',
            name='class_of_insurance',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name='sales_kpi_entries',
                to='entries.ClassOfInsurance',
            ),
        ),
        migrations.AddField(
            model_name='saleskpientry',
            name='assignee',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name='sales_kpi_assigned_enquiries',
                to=settings.AUTH_USER_MODEL,
                null=True,
            ),
            preserve_default=False,
        ),
        migrations.AlterField(
            model_name='saleskpientry',
            name='assignee',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name='sales_kpi_assigned_enquiries',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='saleskpientry',
            name='potential_premium',
            field=models.DecimalField(decimal_places=2, max_digits=15, null=True, blank=True),
        ),
        migrations.AddField(
            model_name='saleskpientry',
            name='status',
            field=models.CharField(choices=STATUS_CHOICES, default='lead', max_length=20),
        ),
        migrations.AddField(
            model_name='saleskpientry',
            name='status_changed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='saleskpientry',
            name='sent_for_quote',
            field=models.BooleanField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='saleskpientry',
            name='quote_received',
            field=models.BooleanField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='saleskpientry',
            name='submitted_to_client',
            field=models.BooleanField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='saleskpientry',
            name='converted_premium',
            field=models.DecimalField(decimal_places=2, max_digits=15, null=True, blank=True),
        ),

        # 4. Status transition audit table.
        migrations.CreateModel(
            name='SalesKPIStatusTransition',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('from_status', models.CharField(blank=True, choices=STATUS_CHOICES, max_length=20)),
                ('to_status', models.CharField(choices=STATUS_CHOICES, max_length=20)),
                ('changed_at', models.DateTimeField(auto_now_add=True)),
                ('changed_by', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='sales_kpi_status_changes',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('entry', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='status_transitions',
                    to='entries.saleskpientry',
                )),
            ],
            options={
                'ordering': ['changed_at'],
            },
        ),
    ]
