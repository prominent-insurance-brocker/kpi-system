"""Marine New revamp — convert from per-day aggregate to per-enquiry (TED-596).

Removes the old aggregate fields (gross_booked_premium, quotes_created,
new_clients_acquired, new_policies_issued) and adds the per-enquiry fields
mirroring GeneralNewEntry, plus the new MarineNewStatusTransition audit table.
Two Marine-specific differences vs. General New: class_of_insurance points at
the dedicated MarineClassOfInsurance lookup, and the status set adds two states
('shared_with_client', 'rejected').

The destructive wipe of existing MarineNewEntry rows happens in the preceding
migration (0047_marine_new_wipe_existing) — splitting it out is required because
Postgres won't ALTER TABLE while deferred FK trigger events from the DELETE are
still pending in the same transaction. Marine New never had a per-day
unique_together, so (unlike the General New revamp) there is no constraint to
drop here.
"""
from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


STATUS_CHOICES = [
    ('new', 'New Enquiry'),
    ('in_progress', 'In Progress'),
    ('shared_with_client', 'Shared With Client'),
    ('converted', 'Converted'),
    ('rejected', 'Rejected'),
    ('lost', 'Lost'),
]


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0047_marine_new_wipe_existing'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # 1. Remove the old aggregate fields.
        migrations.RemoveField(model_name='marinenewentry', name='gross_booked_premium'),
        migrations.RemoveField(model_name='marinenewentry', name='quotes_created'),
        migrations.RemoveField(model_name='marinenewentry', name='new_clients_acquired'),
        migrations.RemoveField(model_name='marinenewentry', name='new_policies_issued'),

        # 2. Add the per-enquiry fields. The agent FK is added nullable so the
        #    migration works against the now-empty table (0047 wiped every row),
        #    then altered to non-nullable.
        migrations.AddField(
            model_name='marinenewentry',
            name='client_name',
            field=models.CharField(default='', max_length=200),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='marinenewentry',
            name='agent',
            field=models.ForeignKey(
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='marine_new_enquiries_as_agent',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AlterField(
            model_name='marinenewentry',
            name='agent',
            field=models.ForeignKey(
                on_delete=django.db.models.deletion.PROTECT,
                related_name='marine_new_enquiries_as_agent',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='marinenewentry',
            name='status',
            field=models.CharField(choices=STATUS_CHOICES, default='new', max_length=20),
        ),
        migrations.AddField(
            model_name='marinenewentry',
            name='revisions',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='marinenewentry',
            name='quotes_compared',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='marinenewentry',
            name='status_changed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='marinenewentry',
            name='potential_premium',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=15, null=True),
        ),
        migrations.AddField(
            model_name='marinenewentry',
            name='converted_premium',
            field=models.DecimalField(blank=True, decimal_places=2, max_digits=15, null=True),
        ),
        migrations.AddField(
            model_name='marinenewentry',
            name='class_of_insurance',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='%(class)s_entries',
                to='entries.marineclassofinsurance',
            ),
        ),
        migrations.AddField(
            model_name='marinenewentry',
            name='insurance_company',
            field=models.ForeignKey(
                blank=True, null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name='marine_new_entries',
                to='entries.insurancecompany',
            ),
        ),
        migrations.AddField(
            model_name='marinenewentry',
            name='compared_insurance_companies',
            field=models.ManyToManyField(
                blank=True, related_name='marine_new_compared', to='entries.insurancecompany',
            ),
        ),

        # 3. Create the audit table.
        migrations.CreateModel(
            name='MarineNewStatusTransition',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('from_status', models.CharField(blank=True, choices=STATUS_CHOICES, max_length=20)),
                ('to_status', models.CharField(choices=STATUS_CHOICES, max_length=20)),
                ('changed_at', models.DateTimeField(auto_now_add=True)),
                ('changed_by', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='marine_new_status_changes',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('entry', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='status_transitions',
                    to='entries.marinenewentry',
                )),
            ],
            options={'ordering': ['changed_at']},
        ),
    ]
