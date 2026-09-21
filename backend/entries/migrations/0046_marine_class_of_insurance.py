"""Create the MarineClassOfInsurance admin-managed lookup table (TED-596).

Marine classes are a distinct sub-category of Marine Insurance, so Marine New
uses its own lookup table, separate from ClassOfInsurance. Shipped empty —
admins populate it via Settings → Marine Class of Insurance.
"""
from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('entries', '0045_alter_generalnewentry_status_and_more'),
    ]

    operations = [
        migrations.CreateModel(
            name='MarineClassOfInsurance',
            fields=[
                ('id', models.BigAutoField(auto_created=True, primary_key=True, serialize=False, verbose_name='ID')),
                ('name', models.CharField(max_length=200, unique=True)),
                ('is_active', models.BooleanField(default=True)),
                ('created_at', models.DateTimeField(auto_now_add=True)),
                ('updated_at', models.DateTimeField(auto_now=True)),
            ],
            options={
                'verbose_name': 'Marine Class of Insurance',
                'verbose_name_plural': 'Marine Classes of Insurance',
                'ordering': ['name'],
            },
        ),
    ]
