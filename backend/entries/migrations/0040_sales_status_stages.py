"""TED-533 — Sales KPI status stages.

Replaces the single 'in_progress' stage with two explicit stages,
'awaiting_quote' and 'shared_with_client', and remaps existing production rows
that are still 'in_progress' to 'awaiting_quote' (per the issue).

We deliberately remap ONLY the live SalesKPIEntry.status — the
SalesKPIStatusTransition audit log keeps its historical 'in_progress' labels
(not surfaced in the UI).

The AlterField operations only change the `choices` metadata (Python-level);
Django emits no SQL for a choices-only change on a CharField, so this migration
is non-destructive: no columns dropped, no rows deleted, just a bounded UPDATE
of the rows still sitting in 'in_progress'. Runs in a transaction (Postgres).
"""
from django.db import migrations, models


STATUS_CHOICES = [
    ('lead', 'Lead'),
    ('awaiting_quote', 'Awaiting Quote'),
    ('shared_with_client', 'Shared with Client'),
    ('won', 'Won'),
    ('lost', 'Lost'),
]


def in_progress_to_awaiting_quote(apps, schema_editor):
    SalesKPIEntry = apps.get_model('entries', 'SalesKPIEntry')
    SalesKPIEntry.objects.filter(status='in_progress').update(status='awaiting_quote')


def awaiting_quote_to_in_progress(apps, schema_editor):
    # Best-effort reverse: collapse both new non-terminal stages back to the
    # single legacy 'in_progress' stage.
    SalesKPIEntry = apps.get_model('entries', 'SalesKPIEntry')
    SalesKPIEntry.objects.filter(
        status__in=['awaiting_quote', 'shared_with_client'],
    ).update(status='in_progress')


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0039_motorfleetnewentry_class_of_enquiry_and_more'),
    ]

    operations = [
        # 1. Remap live production rows: In Progress -> Awaiting Quote.
        migrations.RunPython(
            in_progress_to_awaiting_quote,
            reverse_code=awaiting_quote_to_in_progress,
        ),
        # 2. Sync the choices metadata on the entry + audit-log fields. These
        #    are no-op SQL (choices aren't a DB constraint); they only keep the
        #    migration state aligned with the model for `makemigrations --check`.
        migrations.AlterField(
            model_name='saleskpientry',
            name='status',
            field=models.CharField(
                choices=STATUS_CHOICES, default='lead', max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name='saleskpistatustransition',
            name='from_status',
            field=models.CharField(
                blank=True, choices=STATUS_CHOICES, max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name='saleskpistatustransition',
            name='to_status',
            field=models.CharField(choices=STATUS_CHOICES, max_length=20),
        ),
    ]
