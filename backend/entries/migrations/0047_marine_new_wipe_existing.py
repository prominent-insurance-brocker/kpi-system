"""Wipe existing MarineNewEntry rows before the schema revamp (TED-596).

Split out from 0048 (the revamp) so the DELETE commits in its own transaction.
Postgres queues deferred FK trigger events when rows are deleted and won't let
us ALTER TABLE on the same relation in the same transaction — splitting forces
the triggers to flush before the revamp's schema changes run.

The revamp converts MarineNewEntry from a per-day aggregate (gross_booked_premium,
quotes_created, new_clients_acquired, new_policies_issued) to a per-enquiry model
mirroring GeneralNewEntry. The old aggregate columns can't be back-derived into
per-enquiry rows, so the wipe is destructive by necessity. The module had no
production data (confirmed) — only dev/seed rows are affected.
"""
from django.db import migrations


def wipe_marine_new_rows(apps, schema_editor):
    MarineNewEntry = apps.get_model('entries', 'MarineNewEntry')
    MarineNewEntry.objects.all().delete()


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0046_marine_class_of_insurance'),
    ]

    operations = [
        migrations.RunPython(wipe_marine_new_rows, reverse_code=noop_reverse),
    ]
