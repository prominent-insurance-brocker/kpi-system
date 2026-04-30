from django.db import migrations, models


def forwards(apps, schema_editor):
    MedicalClaimEntry = apps.get_model('entries', 'MedicalClaimEntry')
    MedicalClaimStatusTransition = apps.get_model('entries', 'MedicalClaimStatusTransition')
    MedicalClaimEntry.objects.filter(status='claims_pending').update(status='claims_in_progress')
    MedicalClaimStatusTransition.objects.filter(from_status='claims_pending').update(from_status='claims_in_progress')
    MedicalClaimStatusTransition.objects.filter(to_status='claims_pending').update(to_status='claims_in_progress')


def backwards(apps, schema_editor):
    MedicalClaimEntry = apps.get_model('entries', 'MedicalClaimEntry')
    MedicalClaimStatusTransition = apps.get_model('entries', 'MedicalClaimStatusTransition')
    MedicalClaimEntry.objects.filter(status='claims_in_progress').update(status='claims_pending')
    MedicalClaimStatusTransition.objects.filter(from_status='claims_in_progress').update(from_status='claims_pending')
    MedicalClaimStatusTransition.objects.filter(to_status='claims_in_progress').update(to_status='claims_pending')


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0015_add_on_behalf_of'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
        migrations.AlterField(
            model_name='medicalclaimentry',
            name='status',
            field=models.CharField(
                choices=[
                    ('claims_opened', 'Claims Opened'),
                    ('claims_in_progress', 'Claims In Progress'),
                    ('claims_resolved', 'Claims Resolved'),
                    ('claims_rejected', 'Claims Rejected'),
                ],
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name='medicalclaimstatustransition',
            name='from_status',
            field=models.CharField(
                blank=True,
                choices=[
                    ('claims_opened', 'Claims Opened'),
                    ('claims_in_progress', 'Claims In Progress'),
                    ('claims_resolved', 'Claims Resolved'),
                    ('claims_rejected', 'Claims Rejected'),
                ],
                max_length=20,
            ),
        ),
        migrations.AlterField(
            model_name='medicalclaimstatustransition',
            name='to_status',
            field=models.CharField(
                choices=[
                    ('claims_opened', 'Claims Opened'),
                    ('claims_in_progress', 'Claims In Progress'),
                    ('claims_resolved', 'Claims Resolved'),
                    ('claims_rejected', 'Claims Rejected'),
                ],
                max_length=20,
            ),
        ),
    ]
