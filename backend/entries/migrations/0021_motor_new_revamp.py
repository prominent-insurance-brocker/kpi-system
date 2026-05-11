"""Motor New + Motor Renewal revamp — destructive replacement of the
daily-aggregate schema with a per-enquiry workflow for both modules.

Both modules adopt the same per-enquiry shape (client_name, agent FK,
chassis_no, remarks, status state machine, revisions counter, transition
history). Existing rows are dropped because the daily-aggregate columns
don't map cleanly to per-enquiry semantics. Production was wiped before
this migration ships.
"""
from django.conf import settings
from django.db import migrations, models


def drop_existing_rows(apps, schema_editor):
    MotorNewEntry = apps.get_model('entries', 'MotorNewEntry')
    MotorRenewalEntry = apps.get_model('entries', 'MotorRenewalEntry')
    MotorNewEntry.objects.all().delete()
    MotorRenewalEntry.objects.all().delete()


def noop_reverse(apps, schema_editor):
    """Reverse leaves the table empty — old rows were already discarded."""
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0020_salesmonthlytarget_calculated_date'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # 1. Drop existing data first — old columns are NOT NULL on some
        #    fields and the schema change below would otherwise carry stale
        #    rows that don't match the new contract.
        migrations.RunPython(drop_existing_rows, reverse_code=noop_reverse),

        # 2. Remove the old daily-aggregate fields.
        migrations.RemoveField(model_name='motornewentry', name='quotations'),
        migrations.RemoveField(model_name='motornewentry', name='quotes_revised'),
        migrations.RemoveField(model_name='motornewentry', name='quotes_converted'),
        migrations.RemoveField(model_name='motornewentry', name='tat'),
        migrations.RemoveField(model_name='motornewentry', name='accuracy'),

        # 3. Add the new per-enquiry fields.
        migrations.AddField(
            model_name='motornewentry',
            name='client_name',
            field=models.CharField(default='', max_length=200),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='motornewentry',
            name='agent',
            field=models.ForeignKey(
                on_delete=models.deletion.PROTECT,
                related_name='motor_new_enquiries_as_agent',
                to=settings.AUTH_USER_MODEL,
                # Nullable=False but no default — table is empty so this is safe.
                null=True,
            ),
            preserve_default=False,
        ),
        # Tighten the FK now that the column exists. Two-step keeps the
        # migration runnable even on empty tables created via syncdb.
        migrations.AlterField(
            model_name='motornewentry',
            name='agent',
            field=models.ForeignKey(
                on_delete=models.deletion.PROTECT,
                related_name='motor_new_enquiries_as_agent',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='motornewentry',
            name='chassis_no',
            field=models.CharField(default='', max_length=100),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='motornewentry',
            name='remarks',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='motornewentry',
            name='status',
            field=models.CharField(
                choices=[
                    ('new', 'New Enquiry'),
                    ('converted', 'Converted'),
                    ('lost', 'Lost'),
                ],
                default='new',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='motornewentry',
            name='revisions',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='motornewentry',
            name='status_changed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),

        # 4. Create the motor_new status history table.
        migrations.CreateModel(
            name='MotorNewStatusTransition',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('from_status', models.CharField(
                    blank=True,
                    choices=[
                        ('new', 'New Enquiry'),
                        ('converted', 'Converted'),
                        ('lost', 'Lost'),
                    ],
                    max_length=20,
                )),
                ('to_status', models.CharField(
                    choices=[
                        ('new', 'New Enquiry'),
                        ('converted', 'Converted'),
                        ('lost', 'Lost'),
                    ],
                    max_length=20,
                )),
                ('changed_at', models.DateTimeField(auto_now_add=True)),
                ('changed_by', models.ForeignKey(
                    on_delete=models.deletion.CASCADE,
                    related_name='motor_new_status_changes',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('entry', models.ForeignKey(
                    on_delete=models.deletion.CASCADE,
                    related_name='status_transitions',
                    to='entries.motornewentry',
                )),
            ],
            options={
                'ordering': ['changed_at'],
            },
        ),

        # 5. Same destructive transformation for MotorRenewalEntry.
        migrations.RemoveField(model_name='motorrenewalentry', name='quotations'),
        migrations.RemoveField(model_name='motorrenewalentry', name='retention'),
        migrations.RemoveField(model_name='motorrenewalentry', name='tat'),
        migrations.RemoveField(model_name='motorrenewalentry', name='accuracy'),
        migrations.AddField(
            model_name='motorrenewalentry',
            name='client_name',
            field=models.CharField(default='', max_length=200),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='motorrenewalentry',
            name='agent',
            field=models.ForeignKey(
                on_delete=models.deletion.PROTECT,
                related_name='motor_renewal_enquiries_as_agent',
                to=settings.AUTH_USER_MODEL,
                null=True,
            ),
            preserve_default=False,
        ),
        migrations.AlterField(
            model_name='motorrenewalentry',
            name='agent',
            field=models.ForeignKey(
                on_delete=models.deletion.PROTECT,
                related_name='motor_renewal_enquiries_as_agent',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='motorrenewalentry',
            name='chassis_no',
            field=models.CharField(default='', max_length=100),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='motorrenewalentry',
            name='remarks',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='motorrenewalentry',
            name='status',
            field=models.CharField(
                choices=[
                    ('new', 'New Enquiry'),
                    ('converted', 'Converted'),
                    ('lost', 'Lost'),
                ],
                default='new',
                max_length=20,
            ),
        ),
        migrations.AddField(
            model_name='motorrenewalentry',
            name='revisions',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='motorrenewalentry',
            name='status_changed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.CreateModel(
            name='MotorRenewalStatusTransition',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('from_status', models.CharField(
                    blank=True,
                    choices=[
                        ('new', 'New Enquiry'),
                        ('converted', 'Converted'),
                        ('lost', 'Lost'),
                    ],
                    max_length=20,
                )),
                ('to_status', models.CharField(
                    choices=[
                        ('new', 'New Enquiry'),
                        ('converted', 'Converted'),
                        ('lost', 'Lost'),
                    ],
                    max_length=20,
                )),
                ('changed_at', models.DateTimeField(auto_now_add=True)),
                ('changed_by', models.ForeignKey(
                    on_delete=models.deletion.CASCADE,
                    related_name='motor_renewal_status_changes',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('entry', models.ForeignKey(
                    on_delete=models.deletion.CASCADE,
                    related_name='status_transitions',
                    to='entries.motorrenewalentry',
                )),
            ],
            options={
                'ordering': ['changed_at'],
            },
        ),
    ]
