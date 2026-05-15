"""Wipe existing GeneralNewEntry rows before the schema revamp.

Split out from 0031 (the revamp) so the DELETE commits in its own transaction.
Postgres queues deferred FK trigger events when rows are deleted, and won't let
us ALTER TABLE on the same relation in the same transaction — splitting forces
the triggers to flush before the revamp's schema changes run.

The revamp converts GeneralNewEntry from a per-day aggregate (quotations,
quotes_revised, quotes_converted, tat, accuracy) to a per-enquiry model
mirroring MotorNewEntry minus chassis_no. The old aggregate columns can't be
back-derived into per-enquiry rows, so the wipe is destructive by necessity.
"""
from django.db import migrations


def wipe_general_new_rows(apps, schema_editor):
    GeneralNewEntry = apps.get_model('entries', 'GeneralNewEntry')
    GeneralNewEntry.objects.all().delete()


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0029_pib_id_per_module'),
    ]

    operations = [
        migrations.RunPython(wipe_general_new_rows, reverse_code=noop_reverse),
    ]
