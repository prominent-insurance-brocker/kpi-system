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
    SalesKPIEntry,
    MedicalClaimEntry,
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
        MedicalClaimEntry.objects.all().delete()
        SalesKPIEntry.objects.all().delete()
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
            {
                'name': 'Sales Agent',
                'description': 'Handles sales premium data and KPI tracking',
                'data_visibility': 'own',
            },
            {
                'name': 'Medical Agent',
                'description': 'Handles medical insurance claims processing',
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
                'sales_kpi',
                'medical_claim',
            ],
            'Manager': [
                'general_new', 'general_renewal', 'general_claim',
                'motor_new', 'motor_renewal', 'motor_claim',
                'sales_kpi',
                'medical_claim',
            ],
            'General Agent': [
                'general_new', 'general_renewal', 'general_claim',
            ],
            'Motor Agent': [
                'motor_new', 'motor_renewal', 'motor_claim',
            ],
            'Sales Agent': [
                'sales_kpi',
            ],
            'Medical Agent': [
                'medical_claim',
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
                'full_name': 'Samad PM',
                'is_superuser': True,
                'is_staff': True,
                'role': None,
            },
            {
                'email': 'amaljith64@gmail.com',
                'full_name': 'Amaljith Admin',
                'is_superuser': True,
                'is_staff': True,
                'role': None,
            },
            {
                'email': 'alice@kpisystem.com',
                'full_name': 'Alice Anderson',
                'is_superuser': False,
                'is_staff': False,
                'role': roles.get('General Agent'),
            },
            {
                'email': 'bob@kpisystem.com',
                'full_name': 'Bob Brown',
                'is_superuser': False,
                'is_staff': False,
                'role': roles.get('Motor Agent'),
            },
            {
                'email': 'charlie@kpisystem.com',
                'full_name': 'Charlie Clark',
                'is_superuser': False,
                'is_staff': False,
                'role': roles.get('General Agent'),
            },
            {
                'email': 'diana@kpisystem.com',
                'full_name': 'Diana Davis',
                'is_superuser': False,
                'is_staff': False,
                'role': roles.get('Motor Agent'),
            },
            {
                'email': 'emma@kpisystem.com',
                'full_name': 'Emma Edwards',
                'is_superuser': False,
                'is_staff': False,
                'role': roles.get('Sales Agent'),
            },
            {
                'email': 'frank@kpisystem.com',
                'full_name': 'Frank Fisher',
                'is_superuser': False,
                'is_staff': False,
                'role': roles.get('Sales Agent'),
            },
            {
                'email': 'grace@kpisystem.com',
                'full_name': 'Grace Garcia',
                'is_superuser': False,
                'is_staff': False,
                'role': roles.get('Sales Agent'),
            },
            {
                'email': 'henry@kpisystem.com',
                'full_name': 'Henry Harris',
                'is_superuser': False,
                'is_staff': False,
                'role': roles.get('Sales Agent'),
            },
            {
                'email': 'ivy@kpisystem.com',
                'full_name': 'Ivy Ingram',
                'is_superuser': False,
                'is_staff': False,
                'role': roles.get('Sales Agent'),
            },
            {
                'email': 'jack@kpisystem.com',
                'full_name': 'Jack Johnson',
                'is_superuser': False,
                'is_staff': False,
                'role': roles.get('Medical Agent'),
            },
            {
                'email': 'karen@kpisystem.com',
                'full_name': 'Karen King',
                'is_superuser': False,
                'is_staff': False,
                'role': roles.get('Medical Agent'),
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

        # Sales agents create sales entries
        sales_users = [
            users.get('emma@kpisystem.com'),
            users.get('frank@kpisystem.com'),
            users.get('grace@kpisystem.com'),
            users.get('henry@kpisystem.com'),
            users.get('ivy@kpisystem.com'),
        ]

        today = date.today()
        dates = [today - timedelta(days=i) for i in range(30)]

        # Monthly dates for 2025 and 2026 (first day of each month)
        sales_dates = []
        for year in [2025, 2026]:
            for month in range(1, 13):
                sales_dates.append(date(year, month, 1))

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

        # Seed Sales KPI entries (monthly for 2025-2026)
        count = self._seed_sales_kpi_entries(sales_users, sales_dates)
        self.stdout.write(f'  - Sales KPI entries: {count}')

        # Medical agents create medical entries
        medical_users = [
            users.get('jack@kpisystem.com'),
            users.get('karen@kpisystem.com'),
        ]

        # Seed Medical Claim entries
        count = self._seed_medical_claim_entries(medical_users, dates)
        self.stdout.write(f'  - Medical Claim entries: {count}')

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

    def _seed_sales_kpi_entries(self, users, dates):
        """Seed SalesKPIEntry records."""
        count = 0
        for user in users:
            if not user:
                continue
            for entry_date in dates:
                _, created = SalesKPIEntry.objects.get_or_create(
                    date=entry_date,
                    added_by=user,
                    defaults={
                        'leads_to_ops_team': random.randint(10, 99),
                        'quotes_from_ops_team': random.randint(10, 99),
                        'quotes_to_client': random.randint(10, 99),
                        'total_conversions': random.randint(10, 99),
                        'new_clients_acquired': random.randint(10, 99),
                        'gross_booked_premium': Decimal(str(random.randint(50000, 200000))),
                    }
                )
                if created:
                    count += 1
        return count

    def _seed_medical_claim_entries(self, users, dates):
        """Seed MedicalClaimEntry records."""
        customer_names = [
            'Ahmed Al-Rashid', 'Fatima Hassan', 'Mohammed Al-Sayed',
            'Sara Ibrahim', 'Khalid Omar', 'Noor Ali', 'Yusuf Mahmoud',
            'Layla Ahmed', 'Hassan Mustafa', 'Amira Saleh',
        ]
        statuses = ['claims_opened', 'claims_pending', 'claims_resolved']
        count = 0
        for user in users:
            if not user:
                continue
            for entry_date in dates:
                _, created = MedicalClaimEntry.objects.get_or_create(
                    date=entry_date,
                    added_by=user,
                    defaults={
                        'customer_name': random.choice(customer_names),
                        'status': random.choice(statuses),
                    }
                )
                if created:
                    count += 1
        return count
