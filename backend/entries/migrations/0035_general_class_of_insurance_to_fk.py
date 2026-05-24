"""Convert General New / General Renewal `class_of_insurance` from a CharField
with hardcoded choices to an FK pointing at the new ClassOfInsurance lookup.

The four-step dance avoids a destructive ALTER TYPE on existing rows:
  1. Add `class_of_insurance_new` FK (nullable) alongside the old CharField.
  2. Data migration: map old string keys (e.g. 'property_all_risk') to the
     seeded ClassOfInsurance rows (by display label) and populate the new FK.
  3. Drop the old `class_of_insurance` CharField.
  4. Rename `class_of_insurance_new` → `class_of_insurance`.

After this migration the General modules use the same lookup table as the
new Sales KPI ticket flow (TED-446).
"""
from django.db import migrations, models
import django.db.models.deletion


# Old CharField choices (key → display label). Display label matches the seed
# row name in 0034 so we can resolve directly.
KEY_TO_LABEL = {
    'property_all_risk': 'Property All Risk Insurance',
    'marine_cargo': 'Marine Cargo Insurance',
    'trade_credit': 'Trade Credit Insurance',
    'professional_indemnity': 'Professional Indemnity Insurance',
    'public_liability': 'Public Liability Insurance',
}


def populate_fk(apps, schema_editor):
    ClassOfInsurance = apps.get_model('entries', 'ClassOfInsurance')
    label_to_row = {
        name: ClassOfInsurance.objects.get_or_create(
            name=name, defaults={'is_active': True},
        )[0]
        for name in KEY_TO_LABEL.values()
    }

    for model_name in ('GeneralNewEntry', 'GeneralRenewalEntry'):
        Model = apps.get_model('entries', model_name)
        qs = (
            Model.objects
            .exclude(class_of_insurance='')
            .exclude(class_of_insurance__isnull=True)
        )
        for entry in qs:
            label = KEY_TO_LABEL.get(entry.class_of_insurance)
            if not label:
                continue
            row = label_to_row.get(label)
            if row is None:
                continue
            entry.class_of_insurance_new_id = row.id
            entry.save(update_fields=['class_of_insurance_new'])


def noop(apps, schema_editor):
    pass


def _new_fk():
    return models.ForeignKey(
        'entries.ClassOfInsurance',
        on_delete=django.db.models.deletion.PROTECT,
        related_name='%(class)s_entries',
        null=True, blank=True,
    )


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0034_classofinsurance'),
    ]

    operations = [
        # 1. Add the new FK alongside the old CharField on both models.
        migrations.AddField(
            model_name='generalnewentry',
            name='class_of_insurance_new',
            field=_new_fk(),
        ),
        migrations.AddField(
            model_name='generalrenewalentry',
            name='class_of_insurance_new',
            field=_new_fk(),
        ),

        # 2. Backfill the FK from the existing CharField keys.
        migrations.RunPython(populate_fk, reverse_code=noop),

        # 3. Drop the old CharField on both.
        migrations.RemoveField(
            model_name='generalnewentry',
            name='class_of_insurance',
        ),
        migrations.RemoveField(
            model_name='generalrenewalentry',
            name='class_of_insurance',
        ),

        # 4. Rename the FK back to the canonical name.
        migrations.RenameField(
            model_name='generalnewentry',
            old_name='class_of_insurance_new',
            new_name='class_of_insurance',
        ),
        migrations.RenameField(
            model_name='generalrenewalentry',
            old_name='class_of_insurance_new',
            new_name='class_of_insurance',
        ),
    ]
