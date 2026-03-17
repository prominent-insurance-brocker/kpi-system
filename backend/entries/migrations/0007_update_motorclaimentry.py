from django.conf import settings
from django.db import migrations, models
import django.db.models.deletion


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0006_remove_medicalclaimentry_claims_opened_and_more'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        migrations.RemoveField(
            model_name='motorclaimentry',
            name='registered_claims',
        ),
        migrations.RemoveField(
            model_name='motorclaimentry',
            name='claims_closed',
        ),
        migrations.RemoveField(
            model_name='motorclaimentry',
            name='pending_cases',
        ),
        migrations.RemoveField(
            model_name='motorclaimentry',
            name='tat',
        ),
        migrations.AddField(
            model_name='motorclaimentry',
            name='customer_name',
            field=models.CharField(default='', max_length=255),
            preserve_default=False,
        ),
        migrations.AddField(
            model_name='motorclaimentry',
            name='status',
            field=models.CharField(
                choices=[
                    ('claims_opened', 'Claims Opened'),
                    ('claims_pending', 'Claims Pending'),
                    ('claims_resolved', 'Claims Resolved'),
                    ('claims_rejected', 'Claims Rejected'),
                ],
                default='claims_opened',
                max_length=20,
            ),
            preserve_default=False,
        ),
        migrations.CreateModel(
            name='MotorClaimStatusTransition',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('from_status', models.CharField(
                    blank=True,
                    choices=[
                        ('claims_opened', 'Claims Opened'),
                        ('claims_pending', 'Claims Pending'),
                        ('claims_resolved', 'Claims Resolved'),
                        ('claims_rejected', 'Claims Rejected'),
                    ],
                    max_length=20,
                )),
                ('to_status', models.CharField(
                    choices=[
                        ('claims_opened', 'Claims Opened'),
                        ('claims_pending', 'Claims Pending'),
                        ('claims_resolved', 'Claims Resolved'),
                        ('claims_rejected', 'Claims Rejected'),
                    ],
                    max_length=20,
                )),
                ('changed_at', models.DateTimeField(auto_now_add=True)),
                ('changed_by', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='motor_claim_status_changes',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('entry', models.ForeignKey(
                    on_delete=django.db.models.deletion.CASCADE,
                    related_name='status_transitions',
                    to='entries.motorclaimentry',
                )),
            ],
            options={
                'ordering': ['changed_at'],
            },
        ),
    ]
