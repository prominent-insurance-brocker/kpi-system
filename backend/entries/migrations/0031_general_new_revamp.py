"""General New revamp — convert from per-day aggregate to per-enquiry.

Removes the old aggregate fields (quotations, quotes_revised, quotes_converted,
tat, accuracy) and the per-day unique_together (added_by, date) constraint.
Adds the per-enquiry fields mirroring MotorNewEntry minus chassis_no, plus a
new GeneralNewStatusTransition audit table.

The destructive wipe of existing GeneralNewEntry rows happens in the preceding
migration (0030_general_new_wipe_existing) — splitting it out is required
because Postgres won't ALTER TABLE while deferred FK trigger events from the
DELETE are still pending in the same transaction.
"""
from django.conf import settings
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0030_general_new_wipe_existing'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # 1. Drop the per-day unique constraint (per-enquiry now).
        migrations.AlterUniqueTogether(
            name='generalnewentry',
            unique_together=set(),
        ),

        # 2. Remove the old aggregate fields.
        migrations.RemoveField(model_name='generalnewentry', name='quotations'),
        migrations.RemoveField(model_name='generalnewentry', name='quotes_revised'),
        migrations.RemoveField(model_name='generalnewentry', name='quotes_converted'),
        migrations.RemoveField(model_name='generalnewentry', name='tat'),
        migrations.RemoveField(model_name='generalnewentry', name='accuracy'),

        # 3. Add the per-enquiry fields. The FK is added nullable so the
        #    migration works against the now-empty table; the wipe in 0025
        #    ensures no row exists at this point.
        migrations.AddField(
            model_name='generalnewentry',
            name='client_name',
            field=models.CharField(default='', max_length=200),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='generalnewentry',
            name='agent',
            field=models.ForeignKey(
                null=True,
                on_delete=models.deletion.PROTECT,
                related_name='general_new_enquiries_as_agent',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AlterField(
            model_name='generalnewentry',
            name='agent',
            field=models.ForeignKey(
                on_delete=models.deletion.PROTECT,
                related_name='general_new_enquiries_as_agent',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='generalnewentry',
            name='remarks',
            field=models.TextField(blank=True, default=''),
        ),
        migrations.AddField(
            model_name='generalnewentry',
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
            model_name='generalnewentry',
            name='revisions',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='generalnewentry',
            name='quotes_compared',
            field=models.PositiveIntegerField(default=0),
        ),
        migrations.AddField(
            model_name='generalnewentry',
            name='status_changed_at',
            field=models.DateTimeField(blank=True, null=True),
        ),

        # 4. Create the audit table.
        migrations.CreateModel(
            name='GeneralNewStatusTransition',
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
                    related_name='general_new_status_changes',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('entry', models.ForeignKey(
                    on_delete=models.deletion.CASCADE,
                    related_name='status_transitions',
                    to='entries.generalnewentry',
                )),
            ],
            options={'ordering': ['changed_at']},
        ),
    ]
