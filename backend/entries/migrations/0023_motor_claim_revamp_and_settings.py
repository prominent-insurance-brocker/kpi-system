"""Motor Claim revamp + Settings lookup tables.

Adds TypeOfAccident + InsuranceCompany models, wipes existing MotorClaimEntry
rows (the schema change is destructive — old rows have no values for the new
required fields), renames customer_name -> client_name, adds 8 new fields, and
seeds 5 default rows in each lookup table so new claims have something to pick.
"""
from django.conf import settings
from django.db import migrations, models


DEFAULT_ACCIDENT_TYPES = ['Collision', 'Theft', 'Fire', 'Flood', 'Vandalism']
DEFAULT_INSURANCE_COMPANIES = [
    'Acme Insurance', 'BlueShield', 'GlobalCover', 'OmniSure', 'PremierGuard',
]


def wipe_motor_claim_rows(apps, schema_editor):
    """Drop existing MotorClaimEntry data before changing the schema."""
    MotorClaimEntry = apps.get_model('entries', 'MotorClaimEntry')
    MotorClaimStatusTransition = apps.get_model('entries', 'MotorClaimStatusTransition')
    MotorClaimStatusTransition.objects.all().delete()
    MotorClaimEntry.objects.all().delete()


def seed_lookups(apps, schema_editor):
    """Seed the two new lookup tables with sensible defaults."""
    TypeOfAccident = apps.get_model('entries', 'TypeOfAccident')
    InsuranceCompany = apps.get_model('entries', 'InsuranceCompany')
    for name in DEFAULT_ACCIDENT_TYPES:
        TypeOfAccident.objects.get_or_create(name=name)
    for name in DEFAULT_INSURANCE_COMPANIES:
        InsuranceCompany.objects.get_or_create(name=name)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0022_motor_renewal_retained_and_quotes_compared'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # 1. Wipe existing rows first so the schema change is safe.
        migrations.RunPython(wipe_motor_claim_rows, reverse_code=noop_reverse),

        # 2. Create the two new lookup tables.
        migrations.CreateModel(
            name='TypeOfAccident',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=200, unique=True)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={'ordering': ['name']},
        ),
        migrations.CreateModel(
            name='InsuranceCompany',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=200, unique=True)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={'ordering': ['name']},
        ),

        # 3. Seed defaults so dropdowns have something even on a fresh DB.
        migrations.RunPython(seed_lookups, reverse_code=noop_reverse),

        # 4. Rename customer_name -> client_name, then resize to 200.
        migrations.RenameField(
            model_name='motorclaimentry',
            old_name='customer_name',
            new_name='client_name',
        ),
        migrations.AlterField(
            model_name='motorclaimentry',
            name='client_name',
            field=models.CharField(max_length=200),
        ),

        # 5. Add the 8 new fields. The three FKs are added nullable so the
        #    migration works against the now-empty table; if any row existed
        #    it would already have been wiped above.
        migrations.AddField(
            model_name='motorclaimentry',
            name='vehicle_number',
            field=models.CharField(default='', max_length=50),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='motorclaimentry',
            name='claim_number',
            field=models.CharField(default='', max_length=100),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='motorclaimentry',
            name='source',
            field=models.ForeignKey(
                null=True,
                on_delete=models.deletion.PROTECT,
                related_name='motor_claim_enquiries_as_source',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AlterField(
            model_name='motorclaimentry',
            name='source',
            field=models.ForeignKey(
                on_delete=models.deletion.PROTECT,
                related_name='motor_claim_enquiries_as_source',
                to=settings.AUTH_USER_MODEL,
            ),
        ),
        migrations.AddField(
            model_name='motorclaimentry',
            name='type_of_accident',
            field=models.ForeignKey(
                null=True,
                on_delete=models.deletion.PROTECT,
                related_name='motor_claims',
                to='entries.typeofaccident',
            ),
        ),
        migrations.AlterField(
            model_name='motorclaimentry',
            name='type_of_accident',
            field=models.ForeignKey(
                on_delete=models.deletion.PROTECT,
                related_name='motor_claims',
                to='entries.typeofaccident',
            ),
        ),
        migrations.AddField(
            model_name='motorclaimentry',
            name='insurance_company',
            field=models.ForeignKey(
                null=True,
                on_delete=models.deletion.PROTECT,
                related_name='motor_claims',
                to='entries.insurancecompany',
            ),
        ),
        migrations.AlterField(
            model_name='motorclaimentry',
            name='insurance_company',
            field=models.ForeignKey(
                on_delete=models.deletion.PROTECT,
                related_name='motor_claims',
                to='entries.insurancecompany',
            ),
        ),
        migrations.AddField(
            model_name='motorclaimentry',
            name='next_call_date',
            field=models.DateField(blank=True, null=True),
        ),
        migrations.AddField(
            model_name='motorclaimentry',
            name='garage_name',
            field=models.CharField(blank=True, default='', max_length=200),
        ),
        migrations.AddField(
            model_name='motorclaimentry',
            name='garage_number',
            field=models.CharField(blank=True, default='', max_length=50),
        ),
    ]
