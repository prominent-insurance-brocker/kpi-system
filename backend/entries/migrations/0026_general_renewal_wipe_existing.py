"""Wipe existing GeneralRenewalEntry rows before the schema revamp.

Split out from 0027 (the revamp) so the DELETE commits in its own transaction.
Postgres queues deferred FK trigger events when rows are deleted, and won't let
us ALTER TABLE on the same relation in the same transaction — splitting forces
the triggers to flush before the revamp's schema changes run. Mirrors the
0023 pattern used when motor_claim was wiped before its revamp.

The General Renewal module is moving from a per-day aggregate KPI schema
(quotations / quotes_revised / quotes_converted / tat / accuracy) to a
per-enquiry workflow shape matching Motor Renewal. The old rows don't map
onto the new contract — they're destroyed here intentionally.
"""
from django.db import migrations


def wipe_general_renewal_rows(apps, schema_editor):
    GeneralRenewalEntry = apps.get_model('entries', 'GeneralRenewalEntry')
    GeneralRenewalEntry.objects.all().delete()


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0025_add_pib_id'),
    ]

    operations = [
        migrations.RunPython(wipe_general_renewal_rows, reverse_code=noop_reverse),
    ]
