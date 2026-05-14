"""Wipe existing MotorClaimEntry rows before the schema revamp.

Split out from 0024 (the revamp) so the DELETE commits in its own transaction.
Postgres queues deferred FK trigger events when rows are deleted, and won't let
us ALTER TABLE on the same relation in the same transaction — splitting forces
the triggers to flush before the revamp's schema changes run.
"""
from django.db import migrations


def wipe_motor_claim_rows(apps, schema_editor):
    MotorClaimEntry = apps.get_model('entries', 'MotorClaimEntry')
    MotorClaimStatusTransition = apps.get_model('entries', 'MotorClaimStatusTransition')
    MotorClaimStatusTransition.objects.all().delete()
    MotorClaimEntry.objects.all().delete()


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0022_motor_renewal_retained_and_quotes_compared'),
    ]

    operations = [
        migrations.RunPython(wipe_motor_claim_rows, reverse_code=noop_reverse),
    ]
