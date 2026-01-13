from django.core.management.base import BaseCommand
from auth_app.models import CustomUser


class Command(BaseCommand):
    help = 'Seeds the super admin account for KPI System'

    def add_arguments(self, parser):
        parser.add_argument(
            '--email',
            type=str,
            default='admin@kpisystem.com',
            help='Email for the super admin (default: admin@kpisystem.com)'
        )

    def handle(self, *args, **options):
        email = options['email']

        if CustomUser.objects.filter(email=email).exists():
            self.stdout.write(
                self.style.WARNING(f'Super admin with email {email} already exists')
            )
            return

        user = CustomUser.objects.create_superuser(
            email=email,
            first_name='Super',
            last_name='Admin',
        )

        self.stdout.write(
            self.style.SUCCESS(f'Super admin created successfully: {email}')
        )
        self.stdout.write(
            self.style.SUCCESS('To login, request a magic link using this email.')
        )
