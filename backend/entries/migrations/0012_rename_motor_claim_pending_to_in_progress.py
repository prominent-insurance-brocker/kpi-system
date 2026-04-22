from django.db import migrations, models


def forwards(apps, schema_editor):
    MotorClaimEntry = apps.get_model('entries', 'MotorClaimEntry')
    MotorClaimStatusTransition = apps.get_model('entries', 'MotorClaimStatusTransition')
    MotorClaimEntry.objects.filter(status='claims_pending').update(status='claims_in_progress')
    MotorClaimStatusTransition.objects.filter(from_status='claims_pending').update(from_status='claims_in_progress')
    MotorClaimStatusTransition.objects.filter(to_status='claims_pending').update(to_status='claims_in_progress')


def backwards(apps, schema_editor):
    MotorClaimEntry = apps.get_model('entries', 'MotorClaimEntry')
    MotorClaimStatusTransition = apps.get_model('entries', 'MotorClaimStatusTransition')
    MotorClaimEntry.objects.filter(status='claims_in_progress').update(status='claims_pending')
    MotorClaimStatusTransition.objects.filter(from_status='claims_in_progress').update(from_status='claims_pending')
    MotorClaimStatusTransition.objects.filter(to_status='claims_in_progress').update(to_status='claims_pending')


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0011_alter_generalnewentry_unique_together_and_more'),
    ]

    operations = [
        migrations.RunPython(forwards, backwards),
        migrations.AlterField(
            model_name='motorclaimentry',
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
            model_name='motorclaimstatustransition',
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
            model_name='motorclaimstatustransition',
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
