"""Cross-module per-entry comments.

Adds the new `EntryRemark` table (GenericForeignKey, one table serves all
seven supported modules), back-fills the existing single-string `remarks`
column on each enquiry model into a single seed EntryRemark per row
(attributed to the entry's `added_by`, back-dated to `added_at`), then drops
the now-redundant `remarks` column from the six legacy models.

This migration is safe to run in a single transaction on Postgres — we
INSERT and ALTER but never DELETE rows, so deferred FK trigger events from
DELETEs (the bug that forced the motor_claim 0023/0024 split) don't apply.
"""
from django.conf import settings
from django.db import migrations, models


def backfill_remarks_from_legacy_columns(apps, schema_editor):
    """Copy each non-empty legacy `remarks` string into a new EntryRemark row."""
    EntryRemark = apps.get_model('entries', 'EntryRemark')
    ContentType = apps.get_model('contenttypes', 'ContentType')
    legacy_models = [
        ('GeneralNewEntry', 'generalnewentry'),
        ('GeneralRenewalEntry', 'generalrenewalentry'),
        ('MotorNewEntry', 'motornewentry'),
        ('MotorRenewalEntry', 'motorrenewalentry'),
        ('MotorFleetNewEntry', 'motorfleetnewentry'),
        ('MotorFleetRenewalEntry', 'motorfleetrenewalentry'),
    ]
    for model_name, ct_model in legacy_models:
        Model = apps.get_model('entries', model_name)
        # get_or_create — content types for entries' models are normally
        # created via the post_migrate signal, which hasn't fired yet during
        # this migration. Creating the row here is safe; the signal will
        # find it already-present and skip.
        ct, _ = ContentType.objects.get_or_create(app_label='entries', model=ct_model)
        legacy_qs = Model.objects.exclude(remarks='').only(
            'id', 'remarks', 'added_by_id', 'added_at'
        )
        for entry in legacy_qs:
            # Create one EntryRemark per non-empty legacy remarks string.
            # bulk_create with explicit created_at is unreliable because
            # auto_now_add overrides — create then UPDATE created_at.
            remark = EntryRemark.objects.create(
                content_type=ct,
                object_id=entry.id,
                text=entry.remarks,
                author_id=entry.added_by_id,
            )
            EntryRemark.objects.filter(pk=remark.pk).update(created_at=entry.added_at)


def noop_reverse(apps, schema_editor):
    pass


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0031_general_new_revamp'),
        ('contenttypes', '0002_remove_content_type_name'),
        migrations.swappable_dependency(settings.AUTH_USER_MODEL),
    ]

    operations = [
        # 1. Create the EntryRemark table.
        migrations.CreateModel(
            name='EntryRemark',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('object_id', models.PositiveIntegerField()),
                ('text', models.TextField()),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
                ('author', models.ForeignKey(
                    on_delete=models.deletion.PROTECT,
                    related_name='entry_remarks',
                    to=settings.AUTH_USER_MODEL,
                )),
                ('content_type', models.ForeignKey(
                    on_delete=models.deletion.CASCADE,
                    to='contenttypes.contenttype',
                )),
            ],
            options={
                'ordering': ['-created_at'],
                'indexes': [
                    models.Index(
                        fields=['content_type', 'object_id', '-created_at'],
                        name='entries_er_ct_obj_cr_idx',
                    ),
                ],
            },
        ),

        # 2. Back-fill existing single-string remarks into the new table.
        migrations.RunPython(backfill_remarks_from_legacy_columns, reverse_code=noop_reverse),

        # 3. Drop the legacy `remarks` column from each of the six models.
        migrations.RemoveField(model_name='generalnewentry', name='remarks'),
        migrations.RemoveField(model_name='generalrenewalentry', name='remarks'),
        migrations.RemoveField(model_name='motornewentry', name='remarks'),
        migrations.RemoveField(model_name='motorrenewalentry', name='remarks'),
        migrations.RemoveField(model_name='motorfleetnewentry', name='remarks'),
        migrations.RemoveField(model_name='motorfleetrenewalentry', name='remarks'),
    ]
