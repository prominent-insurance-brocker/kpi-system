"""Create the ClassOfInsurance admin-managed lookup table.

Seeds the 5 existing General-module class names so:
  1. Settings → Class of Insurance page is populated on first load.
  2. The follow-up migration (0035) can resolve the per-entry CharField
     value (e.g. 'property_all_risk') against these rows by display label
     and convert the column to an FK.
"""
from django.db import migrations, models


SEED_CLASSES = [
    'Property All Risk Insurance',
    'Marine Cargo Insurance',
    'Trade Credit Insurance',
    'Professional Indemnity Insurance',
    'Public Liability Insurance',
]


def seed_classes(apps, schema_editor):
    ClassOfInsurance = apps.get_model('entries', 'ClassOfInsurance')
    for name in SEED_CLASSES:
        ClassOfInsurance.objects.get_or_create(
            name=name,
            defaults={'is_active': True},
        )


def noop(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0033_potential_premium_class_insurance_company'),
    ]

    operations = [
        migrations.CreateModel(
            name='ClassOfInsurance',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=200, unique=True)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Class of Insurance',
                'verbose_name_plural': 'Classes of Insurance',
                'ordering': ['name'],
            },
        ),
        migrations.RunPython(seed_classes, reverse_code=noop),
    ]
