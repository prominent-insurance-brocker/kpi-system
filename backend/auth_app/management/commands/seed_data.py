import random
from datetime import date, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction

from auth_app.models import CustomUser
from roles.models import Role, RoleModulePermission
from entries.models import (
    GeneralNewEntry,
    GeneralRenewalEntry,
    MotorNewEntry,
    MotorRenewalEntry,
    MotorClaimEntry,
)


class Command(BaseCommand):
    help = 'Seeds the database with sample data for all models'

    def add_arguments(self, parser):
        parser.add_argument(
            '--clear',
            action='store_true',
            help='Clear existing data before seeding',
        )

    def handle(self, *args, **options):
        if options['clear']:
            self.clear_data()

        with transaction.atomic():
            roles = self.seed_roles()
            self.seed_role_permissions(roles)
            users = self.seed_users(roles)
            self.seed_entries(users)

        self.stdout.write(self.style.SUCCESS('Seed data created successfully!'))

    def clear_data(self):
        """Clear existing data in reverse order of dependencies."""
        self.stdout.write('Clearing existing data...')

        # Clear entries first
        MotorClaimEntry.objects.all().delete()
        MotorRenewalEntry.objects.all().delete()
        MotorNewEntry.objects.all().delete()
        GeneralRenewalEntry.objects.all().delete()
        GeneralNewEntry.objects.all().delete()
        self.stdout.write('  - Cleared all entries')

        # Clear users (except superusers)
        CustomUser.objects.filter(is_superuser=False).delete()
        self.stdout.write('  - Cleared non-superuser users')

        # Clear role permissions and roles
        RoleModulePermission.objects.all().delete()
        Role.objects.all().delete()
        self.stdout.write('  - Cleared roles and permissions')

    def seed_roles(self):
        """Create roles."""
        self.stdout.write('Creating roles...')

        roles_data = [
            {
                'name': 'Admin',
                'description': 'Full system access with all data visibility',
                'data_visibility': 'all',
            },
            {
                'name': 'Manager',
                'description': 'Can view all data and manage team performance',
                'data_visibility': 'all',
            },
            {
                'name': 'General Agent',
                'description': 'Handles general insurance quotations and renewals',
                'data_visibility': 'own',
            },
            {
                'name': 'Motor Agent',
                'description': 'Handles motor insurance quotations, renewals, and claims',
                'data_visibility': 'own',
            },
        ]

        roles = {}
        for role_data in roles_data:
            role, created = Role.objects.get_or_create(
                name=role_data['name'],
                defaults={
                    'description': role_data['description'],
                    'data_visibility': role_data['data_visibility'],
                }
            )
            roles[role.name] = role
            status = 'created' if created else 'exists'
            self.stdout.write(f'  - Role "{role.name}": {status}')

        return roles

    def seed_role_permissions(self, roles):
        """Create role module permissions."""
        self.stdout.write('Creating role permissions...')

        # Define module access per role
        permissions_map = {
            'Admin': [
                'general_new', 'general_renewal', 'general_claim',
                'motor_new', 'motor_renewal', 'motor_claim',
            ],
            'Manager': [
                'general_new', 'general_renewal', 'general_claim',
                'motor_new', 'motor_renewal', 'motor_claim',
            ],
            'General Agent': [
                'general_new', 'general_renewal', 'general_claim',
            ],
            'Motor Agent': [
                'motor_new', 'motor_renewal', 'motor_claim',
            ],
        }

        count = 0
        for role_name, modules in permissions_map.items():
            role = roles.get(role_name)
            if not role:
                continue

            for module in modules:
                _, created = RoleModulePermission.objects.get_or_create(
                    role=role,
                    module=module,
                )
                if created:
                    count += 1

        self.stdout.write(f'  - Created {count} role permissions')

    def seed_users(self, roles):
        """Create sample users."""
        self.stdout.write('Creating users...')

        users_data = [
            {
                'email': 'samadpm01@outlook.com',
                'first_name': 'Samad',
                'last_name': 'PM',
                'is_superuser': True,
                'is_staff': True,
                'role': None,
            },
            {
                'email': 'amaljith64@gmail.com',
                'first_name': 'Amaljith',
                'last_name': 'Admin',
                'is_superuser': True,
                'is_staff': True,
                'role': None,
            },
            {
                'email': 'alice@kpisystem.com',
                'first_name': 'Alice',
                'last_name': 'Anderson',
                'is_superuser': False,
                'is_staff': False,
                'role': roles.get('General Agent'),
            },
            {
                'email': 'bob@kpisystem.com',
                'first_name': 'Bob',
                'last_name': 'Brown',
                'is_superuser': False,
                'is_staff': False,
                'role': roles.get('Motor Agent'),
            },
            {
                'email': 'charlie@kpisystem.com',
                'first_name': 'Charlie',
                'last_name': 'Clark',
                'is_superuser': False,
                'is_staff': False,
                'role': roles.get('General Agent'),
            },
            {
                'email': 'diana@kpisystem.com',
                'first_name': 'Diana',
                'last_name': 'Davis',
                'is_superuser': False,
                'is_staff': False,
                'role': roles.get('Motor Agent'),
            },
        ]

        users = {}
        for user_data in users_data:
            email = user_data.pop('email')
            user, created = CustomUser.objects.get_or_create(
                email=email,
                defaults=user_data,
            )
            users[email] = user
            status = 'created' if created else 'exists'
            self.stdout.write(f'  - User "{email}": {status}')

        return users

    def seed_entries(self, users):
        """Create sample KPI entries for the past 30 days."""
        self.stdout.write('Creating entries...')

        # General agents create general entries
        general_users = [
            users.get('alice@kpisystem.com'),
            users.get('charlie@kpisystem.com'),
        ]

        # Motor agents create motor entries
        motor_users = [
            users.get('bob@kpisystem.com'),
            users.get('diana@kpisystem.com'),
        ]

        today = date.today()
        dates = [today - timedelta(days=i) for i in range(30)]

        # Seed General New entries
        count = self._seed_general_new_entries(general_users, dates)
        self.stdout.write(f'  - General New entries: {count}')

        # Seed General Renewal entries
        count = self._seed_general_renewal_entries(general_users, dates)
        self.stdout.write(f'  - General Renewal entries: {count}')

        # Seed Motor New entries
        count = self._seed_motor_new_entries(motor_users, dates)
        self.stdout.write(f'  - Motor New entries: {count}')

        # Seed Motor Renewal entries
        count = self._seed_motor_renewal_entries(motor_users, dates)
        self.stdout.write(f'  - Motor Renewal entries: {count}')

        # Seed Motor Claim entries
        count = self._seed_motor_claim_entries(motor_users, dates)
        self.stdout.write(f'  - Motor Claim entries: {count}')

    def _seed_general_new_entries(self, users, dates):
        """Seed GeneralNewEntry records."""
        count = 0
        for user in users:
            if not user:
                continue
            for entry_date in dates:
                _, created = GeneralNewEntry.objects.get_or_create(
                    date=entry_date,
                    added_by=user,
                    defaults={
                        'quotations': random.randint(5, 25),
                        'quotes_revised': random.randint(1, 10),
                        'quotes_converted': random.randint(1, 8),
                        'tat': random.randint(1, 5),
                        'accuracy': Decimal(str(round(random.uniform(85.0, 99.9), 2))),
                    }
                )
                if created:
                    count += 1
        return count

    def _seed_general_renewal_entries(self, users, dates):
        """Seed GeneralRenewalEntry records."""
        count = 0
        for user in users:
            if not user:
                continue
            for entry_date in dates:
                _, created = GeneralRenewalEntry.objects.get_or_create(
                    date=entry_date,
                    added_by=user,
                    defaults={
                        'quotations': random.randint(10, 30),
                        'quotes_revised': random.randint(2, 12),
                        'quotes_converted': random.randint(5, 20),
                        'tat': random.randint(1, 4),
                        'accuracy': Decimal(str(round(random.uniform(88.0, 99.9), 2))),
                    }
                )
                if created:
                    count += 1
        return count

    def _seed_motor_new_entries(self, users, dates):
        """Seed MotorNewEntry records."""
        count = 0
        for user in users:
            if not user:
                continue
            for entry_date in dates:
                _, created = MotorNewEntry.objects.get_or_create(
                    date=entry_date,
                    added_by=user,
                    defaults={
                        'quotations': random.randint(8, 20),
                        'quotes_revised': random.randint(2, 8),
                        'tat': random.randint(1, 3),
                        'accuracy': Decimal(str(round(random.uniform(90.0, 99.9), 2))),
                    }
                )
                if created:
                    count += 1
        return count

    def _seed_motor_renewal_entries(self, users, dates):
        """Seed MotorRenewalEntry records."""
        count = 0
        for user in users:
            if not user:
                continue
            for entry_date in dates:
                _, created = MotorRenewalEntry.objects.get_or_create(
                    date=entry_date,
                    added_by=user,
                    defaults={
                        'quotations': random.randint(15, 35),
                        'retention': random.randint(10, 30),
                        'tat': random.randint(1, 3),
                        'accuracy': Decimal(str(round(random.uniform(88.0, 99.9), 2))),
                    }
                )
                if created:
                    count += 1
        return count

    def _seed_motor_claim_entries(self, users, dates):
        """Seed MotorClaimEntry records."""
        count = 0
        for user in users:
            if not user:
                continue
            for entry_date in dates:
                registered = random.randint(3, 15)
                closed = random.randint(1, registered)
                pending = random.randint(0, 10)

                _, created = MotorClaimEntry.objects.get_or_create(
                    date=entry_date,
                    added_by=user,
                    defaults={
                        'registered_claims': registered,
                        'claims_closed': closed,
                        'pending_cases': pending,
                        'tat': random.randint(2, 7),
                    }
                )
                if created:
                    count += 1
        return count
