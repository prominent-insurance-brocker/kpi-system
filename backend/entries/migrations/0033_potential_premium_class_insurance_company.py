"""Add Potential Premium / Class of (Insurance|Enquiry) / Insurance Company
to the enquiry tables for General New, General Renewal, Motor New, Motor Renewal.

All three fields are nullable so the migration applies cleanly on existing
rows. Class-of choices live in `entries.models`:
    * GENERAL_CLASS_OF_INSURANCE_CHOICES — 5 options (general)
    * MOTOR_CLASS_OF_ENQUIRY_CHOICES     — 2 options (motor)
Insurance Company reuses the existing admin-managed `InsuranceCompany`
lookup table (the same one Motor Claim already uses).
"""
from django.db import migrations, models
import django.db.models.deletion


GENERAL_CHOICES = [
    ('property_all_risk', 'Property All Risk Insurance'),
    ('marine_cargo', 'Marine Cargo Insurance'),
    ('trade_credit', 'Trade Credit Insurance'),
    ('professional_indemnity', 'Professional Indemnity Insurance'),
    ('public_liability', 'Public Liability Insurance'),
]

MOTOR_CHOICES = [
    ('comprehensive', 'Comprehensive'),
    ('tpl', 'TPL'),
]


def _ins_fk(related_name):
    return models.ForeignKey(
        'entries.InsuranceCompany',
        on_delete=django.db.models.deletion.PROTECT,
        related_name=related_name,
        null=True, blank=True,
    )


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0032_entry_remark_create_and_backfill'),
    ]

    operations = [
        # General New
        migrations.AddField(
            model_name='generalnewentry',
            name='potential_premium',
            field=models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True),
        ),
        migrations.AddField(
            model_name='generalnewentry',
            name='class_of_insurance',
            field=models.CharField(max_length=50, choices=GENERAL_CHOICES, blank=True, default=''),
        ),
        migrations.AddField(
            model_name='generalnewentry',
            name='insurance_company',
            field=_ins_fk('general_new_entries'),
        ),

        # General Renewal
        migrations.AddField(
            model_name='generalrenewalentry',
            name='potential_premium',
            field=models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True),
        ),
        migrations.AddField(
            model_name='generalrenewalentry',
            name='class_of_insurance',
            field=models.CharField(max_length=50, choices=GENERAL_CHOICES, blank=True, default=''),
        ),
        migrations.AddField(
            model_name='generalrenewalentry',
            name='insurance_company',
            field=_ins_fk('general_renewal_entries'),
        ),

        # Motor New
        migrations.AddField(
            model_name='motornewentry',
            name='potential_premium',
            field=models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True),
        ),
        migrations.AddField(
            model_name='motornewentry',
            name='class_of_enquiry',
            field=models.CharField(max_length=20, choices=MOTOR_CHOICES, blank=True, default=''),
        ),
        migrations.AddField(
            model_name='motornewentry',
            name='insurance_company',
            field=_ins_fk('motor_new_entries'),
        ),

        # Motor Renewal
        migrations.AddField(
            model_name='motorrenewalentry',
            name='potential_premium',
            field=models.DecimalField(max_digits=15, decimal_places=2, null=True, blank=True),
        ),
        migrations.AddField(
            model_name='motorrenewalentry',
            name='class_of_enquiry',
            field=models.CharField(max_length=20, choices=MOTOR_CHOICES, blank=True, default=''),
        ),
        migrations.AddField(
            model_name='motorrenewalentry',
            name='insurance_company',
            field=_ins_fk('motor_renewal_entries'),
        ),
    ]
