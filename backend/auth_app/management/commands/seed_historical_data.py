"""
Seed historical KPI data from a start date (default 2025-01-01) to today
across every implemented entry module.

Idempotent: re-running skips rows that already exist (uses get_or_create).
Designed to be run on the deployed backend, e.g.:

    docker compose exec backend python manage.py seed_historical_data

Prereq: run `python manage.py seed_data` first so users and roles exist.
"""

import random
from datetime import date, datetime, time, timedelta
from decimal import Decimal

from django.core.management.base import BaseCommand
from django.db import transaction
from django.utils import timezone

from auth_app.models import CustomUser
from roles.models import Role, RoleModulePermission
from entries.models import (
    GeneralNewEntry,
    GeneralRenewalEntry,
    MotorNewEntry,
    MotorRenewalEntry,
    MotorClaimEntry,
    MotorClaimStatusTransition,
    SalesKPIEntry,
    SalesMonthlyTarget,
    MarineNewEntry,
    MarineRenewalEntry,
    MedicalClaimEntry,
    MedicalClaimStatusTransition,
)


# Module slugs that exist in RoleModulePermission.MODULE_CHOICES but have no
# concrete entry model.
SKIPPED_MODULES = ['general_claim', 'sales_premium_data']

ALL_MODULES = [
    'general_new', 'general_renewal',
    'motor_new', 'motor_renewal', 'motor_claim',
    'sales_kpi',
    'marine_new', 'marine_renewal',
    'medical_claim',
]

# Mixed pool: Indian individuals + corporate names. Used for claim modules.
CUSTOMER_NAMES = [
    'Aarav Sharma', 'Priya Patel', 'Rohan Kumar', 'Anjali Singh',
    'Vikram Reddy', 'Meera Iyer', 'Arjun Mehta', 'Kavya Nair',
    'Rajesh Gupta', 'Sunita Joshi', 'Karan Malhotra', 'Pooja Rao',
    'Sanjay Verma', 'Ritu Desai', 'Amit Bose', 'Neha Kapoor',
    'Aditya Shetty', 'Tara Krishnan', 'Manish Pillai', 'Divya Menon',
    'Ahmed Al-Rashid', 'Fatima Hassan', 'Mohammed Al-Sayed',
    'Sara Ibrahim', 'Khalid Omar', 'Noor Ali', 'Yusuf Mahmoud',
    'Layla Ahmed', 'Hassan Mustafa', 'Amira Saleh',
    'Acme Logistics', 'Global Tech Solutions', 'Prime Motors LLC',
    'Star Insurance Brokers', 'Atlas Holdings', 'Nova Industries',
    'City Transport Co.', 'Royal Trading', 'Delta Enterprises',
    'Metro Realty', 'Sapphire Group', 'Emerald Corp',
    'Falcon Shipping', 'Harbor Marine Ltd', 'Phoenix Auto',
    'Summit Construction', 'Crescent Pharma', 'Beacon Energy',
]


def _aware_dt(d, hour=None, minute=None):
    h = hour if hour is not None else random.randint(9, 17)
    m = minute if minute is not None else random.randint(0, 59)
    s = random.randint(0, 59)
    return timezone.make_aware(datetime.combine(d, time(h, m, s)))


class Command(BaseCommand):
    help = 'Seed historical KPI data across all implemented modules from a start date to today.'

    def add_arguments(self, parser):
        parser.add_argument('--start', default='2025-01-01',
                            help='Start date YYYY-MM-DD (default: 2025-01-01)')
        parser.add_argument('--end', default=None,
                            help='End date YYYY-MM-DD (default: today)')
        parser.add_argument('--seed', type=int, default=42,
                            help='Random seed (default: 42)')
        parser.add_argument('--skip-claims', action='store_true',
                            help='Skip motor_claim and medical_claim seeding')
        parser.add_argument('--only', nargs='+', default=None,
                            metavar='MODULE',
                            help='Only seed these module keys')

    def handle(self, *args, **options):
        random.seed(options['seed'])

        start = date.fromisoformat(options['start'])
        end = date.fromisoformat(options['end']) if options['end'] else date.today()

        if start > end:
            self.stdout.write(self.style.ERROR(f'Start ({start}) is after end ({end}).'))
            return

        only_filter = set(options['only']) if options['only'] else None
        skip_claims = options['skip_claims']

        self.stdout.write(self.style.NOTICE(
            f'Seeding from {start} to {end}  (random seed = {options["seed"]})'
        ))

        for slug in SKIPPED_MODULES:
            self.stdout.write(self.style.WARNING(
                f'  ! Skipping "{slug}" — declared in RBAC but no concrete entry model'
            ))

        with transaction.atomic():
            self._ensure_marine_permissions()

            weekday_dates = self._build_date_pool(start, end)
            self.stdout.write(
                f'Date pool: {len(weekday_dates)} weekdays (after dropping ~10% as leave/sick days)'
            )

            per_day_seeders = {
                'general_new': self._seed_general_new,
                'general_renewal': self._seed_general_renewal,
                'motor_new': self._seed_motor_new,
                'motor_renewal': self._seed_motor_renewal,
                'sales_kpi': self._seed_sales_kpi,
                'marine_new': self._seed_marine_new,
                'marine_renewal': self._seed_marine_renewal,
            }

            for module_key, seeder in per_day_seeders.items():
                if only_filter and module_key not in only_filter:
                    continue
                users = self._users_for(module_key)
                if not users:
                    self.stdout.write(self.style.WARNING(
                        f'  ! No active non-staff users have "{module_key}" — skipping'
                    ))
                    continue
                count = seeder(users, weekday_dates)
                self.stdout.write(self.style.SUCCESS(
                    f'  + {module_key:<18} {count:>5} new entries  ({len(users)} users)'
                ))

            # Sales monthly targets — same users as sales_kpi
            if not only_filter or 'sales_kpi' in only_filter:
                sales_users = self._users_for('sales_kpi')
                if sales_users:
                    count = self._seed_sales_monthly_targets(sales_users, start, end)
                    self.stdout.write(self.style.SUCCESS(
                        f'  + sales_monthly_target {count:>5} new targets'
                    ))

            if not skip_claims:
                claim_configs = [
                    ('motor_claim', MotorClaimEntry, MotorClaimStatusTransition, 'claims_in_progress'),
                    ('medical_claim', MedicalClaimEntry, MedicalClaimStatusTransition, 'claims_in_progress'),
                ]
                for module_key, EntryModel, TransitionModel, intermediate_status in claim_configs:
                    if only_filter and module_key not in only_filter:
                        continue
                    users = self._users_for(module_key)
                    if not users:
                        self.stdout.write(self.style.WARNING(
                            f'  ! No active non-staff users have "{module_key}" — skipping'
                        ))
                        continue
                    count = self._seed_claims(
                        users, start, end, EntryModel, TransitionModel, intermediate_status
                    )
                    self.stdout.write(self.style.SUCCESS(
                        f'  + {module_key:<18} {count:>5} new claims  ({len(users)} users)'
                    ))

        self.stdout.write(self.style.SUCCESS('Historical seeding complete.'))

    # ------------- helpers -------------

    def _users_for(self, module_key):
        return list(
            CustomUser.objects.filter(
                role__permissions__module=module_key,
                is_active=True,
                is_staff=False,
            ).distinct()
        )

    def _ensure_marine_permissions(self):
        """If no role currently grants marine modules, attach them to General Agent
        so we have someone to attribute marine entries to. Logged loudly."""
        for marine_module in ('marine_new', 'marine_renewal'):
            if RoleModulePermission.objects.filter(module=marine_module).exists():
                continue
            general_agent = Role.objects.filter(name='General Agent').first()
            if not general_agent:
                self.stdout.write(self.style.WARNING(
                    f'  ! No role grants "{marine_module}" and no "General Agent" role exists; '
                    f'marine entries will be skipped.'
                ))
                continue
            RoleModulePermission.objects.create(role=general_agent, module=marine_module)
            self.stdout.write(self.style.WARNING(
                f'  ! Granted "{marine_module}" to "General Agent" role '
                f'(no role had it; needed to seed marine data)'
            ))

    def _build_date_pool(self, start, end):
        days = []
        d = start
        while d <= end:
            if d.weekday() < 5 and random.random() > 0.10:
                days.append(d)
            d += timedelta(days=1)
        return days

    @staticmethod
    def _maybe_none(value, prob_none):
        return None if random.random() < prob_none else value

    @staticmethod
    def _backdate(model, pk, dt):
        model.objects.filter(pk=pk).update(added_at=dt, updated_at=dt)

    @staticmethod
    def _backdate_transition(model, pk, dt):
        model.objects.filter(pk=pk).update(changed_at=dt)

    # ------------- per-day KPI seeders -------------

    def _seed_general_new(self, users, dates):
        return self._seed_funnel_kpi(users, dates, GeneralNewEntry,
                                     qmin=5, qmax=25, acc_min=85.0, acc_max=99.5)

    def _seed_general_renewal(self, users, dates):
        return self._seed_funnel_kpi(users, dates, GeneralRenewalEntry,
                                     qmin=10, qmax=30, acc_min=88.0, acc_max=99.5)

    def _seed_motor_new(self, users, dates):
        return self._seed_funnel_kpi(users, dates, MotorNewEntry,
                                     qmin=8, qmax=20, acc_min=90.0, acc_max=99.5)

    def _seed_funnel_kpi(self, users, dates, Model, qmin, qmax, acc_min, acc_max):
        count = 0
        for user in users:
            for d in dates:
                quotations = random.randint(qmin, qmax)
                quotes_revised = random.randint(0, quotations)
                quotes_converted = random.randint(0, quotes_revised)
                tat = random.randint(1, 7)
                accuracy = Decimal(str(round(random.uniform(acc_min, acc_max), 2)))
                entry, created = Model.objects.get_or_create(
                    date=d, added_by=user,
                    defaults=dict(
                        quotations=quotations,
                        quotes_revised=quotes_revised,
                        quotes_converted=quotes_converted,
                        tat=tat,
                        accuracy=accuracy,
                    ),
                )
                if created:
                    self._backdate(Model, entry.pk, _aware_dt(d))
                    count += 1
        return count

    def _seed_motor_renewal(self, users, dates):
        count = 0
        for user in users:
            for d in dates:
                quotations = random.randint(15, 35)
                retention = random.randint(0, quotations)
                tat = random.randint(1, 7)
                accuracy = Decimal(str(round(random.uniform(85.0, 99.5), 2)))
                entry, created = MotorRenewalEntry.objects.get_or_create(
                    date=d, added_by=user,
                    defaults=dict(
                        quotations=quotations,
                        retention=retention,
                        tat=tat,
                        accuracy=accuracy,
                    ),
                )
                if created:
                    self._backdate(MotorRenewalEntry, entry.pk, _aware_dt(d))
                    count += 1
        return count

    def _seed_sales_kpi(self, users, dates):
        count = 0
        for user in users:
            for d in dates:
                leads = random.randint(15, 40)
                quotes_from_ops = random.randint(0, leads)
                quotes_to_client = random.randint(0, quotes_from_ops)
                conversions = random.randint(0, quotes_to_client)
                new_clients = random.randint(0, conversions)
                premium = Decimal(str(round(random.uniform(50_000, 500_000), 2)))
                entry, created = SalesKPIEntry.objects.get_or_create(
                    date=d, added_by=user,
                    defaults=dict(
                        leads_to_ops_team=leads,
                        quotes_from_ops_team=quotes_from_ops,
                        quotes_to_client=quotes_to_client,
                        total_conversions=conversions,
                        new_clients_acquired=new_clients,
                        gross_booked_premium=premium,
                    ),
                )
                if created:
                    self._backdate(SalesKPIEntry, entry.pk, _aware_dt(d))
                    count += 1
        return count

    def _seed_marine_new(self, users, dates):
        count = 0
        for user in users:
            for d in dates:
                entry, created = MarineNewEntry.objects.get_or_create(
                    date=d, added_by=user,
                    defaults=dict(
                        gross_booked_premium=Decimal(str(round(random.uniform(2_000, 80_000), 2))),
                        quotes_created=random.randint(2, 15),
                        new_clients_acquired=random.randint(0, 5),
                        new_policies_issued=random.randint(0, 8),
                    ),
                )
                if created:
                    self._backdate(MarineNewEntry, entry.pk, _aware_dt(d))
                    count += 1
        return count

    def _seed_marine_renewal(self, users, dates):
        count = 0
        for user in users:
            for d in dates:
                entry, created = MarineRenewalEntry.objects.get_or_create(
                    date=d, added_by=user,
                    defaults=dict(
                        monthly_renewal_quotes_assigned=random.randint(50, 200),
                        gross_booked_premium=Decimal(str(round(random.uniform(5_000, 100_000), 2))),
                        quotes_created=random.randint(2, 20),
                        renewal_policies_issued=random.randint(0, 12),
                    ),
                )
                if created:
                    self._backdate(MarineRenewalEntry, entry.pk, _aware_dt(d))
                    count += 1
        return count

    # ------------- sales monthly targets -------------

    def _seed_sales_monthly_targets(self, users, start, end):
        months = []
        y, m = start.year, start.month
        while (y, m) <= (end.year, end.month):
            months.append((y, m))
            m += 1
            if m > 12:
                m = 1
                y += 1
        count = 0
        for user in users:
            for (year, month) in months:
                _, created = SalesMonthlyTarget.objects.get_or_create(
                    user=user, year=year, month=month,
                    defaults=dict(
                        premium_target=random.randint(200_000, 800_000),
                        clients_assigned=random.randint(10, 50),
                    ),
                )
                if created:
                    count += 1
        return count

    # ------------- claim seeders -------------

    def _seed_claims(self, users, start, end, EntryModel, TransitionModel, intermediate_status):
        today = date.today()
        count = 0
        cursor = start
        while cursor <= end:
            week_end = min(cursor + timedelta(days=6), end)
            week_weekdays = [
                cursor + timedelta(days=i)
                for i in range((week_end - cursor).days + 1)
                if (cursor + timedelta(days=i)).weekday() < 5
            ]
            if not week_weekdays:
                cursor = week_end + timedelta(days=1)
                continue

            for user in users:
                claims_this_week = random.randint(3, 5)
                for _ in range(claims_this_week):
                    d = random.choice(week_weekdays)
                    customer_name = random.choice(CUSTOMER_NAMES)

                    entry, created = EntryModel.objects.get_or_create(
                        date=d,
                        added_by=user,
                        customer_name=customer_name,
                        defaults={'status': 'claims_opened'},
                    )
                    if not created:
                        continue

                    added_at = _aware_dt(d)
                    self._backdate(EntryModel, entry.pk, added_at)

                    initial = TransitionModel.objects.create(
                        entry=entry, from_status='', to_status='claims_opened',
                        changed_by=user,
                    )
                    self._backdate_transition(TransitionModel, initial.pk, added_at)

                    rand_val = random.random()
                    tat_days = random.choices(
                        [1, 2, 3, 5, 7, 10, 14, 21, 30],
                        weights=[5, 8, 15, 20, 18, 12, 10, 7, 5],
                    )[0]
                    intermediate_offset = random.randint(0, min(2, max(tat_days - 1, 0)))
                    intermediate_date = d + timedelta(days=intermediate_offset)
                    terminal_date = d + timedelta(days=tat_days)

                    if rand_val < 0.70 and terminal_date <= today:
                        intermediate_dt = _aware_dt(intermediate_date)
                        if intermediate_dt <= added_at:
                            intermediate_dt = added_at + timedelta(hours=random.randint(1, 6))
                        terminal_dt = _aware_dt(terminal_date)
                        if terminal_dt <= intermediate_dt:
                            terminal_dt = intermediate_dt + timedelta(hours=random.randint(1, 12))

                        t_inter = TransitionModel.objects.create(
                            entry=entry, from_status='claims_opened',
                            to_status=intermediate_status, changed_by=user,
                        )
                        self._backdate_transition(TransitionModel, t_inter.pk, intermediate_dt)

                        terminal_status = (
                            'claims_resolved' if random.random() < 0.75
                            else 'claims_rejected'
                        )
                        t_term = TransitionModel.objects.create(
                            entry=entry, from_status=intermediate_status,
                            to_status=terminal_status, changed_by=user,
                        )
                        self._backdate_transition(TransitionModel, t_term.pk, terminal_dt)

                        EntryModel.objects.filter(pk=entry.pk).update(
                            status=terminal_status, updated_at=terminal_dt,
                        )

                    elif rand_val < 0.85 and intermediate_date <= today:
                        intermediate_dt = _aware_dt(intermediate_date)
                        if intermediate_dt <= added_at:
                            intermediate_dt = added_at + timedelta(hours=random.randint(1, 6))
                        t_inter = TransitionModel.objects.create(
                            entry=entry, from_status='claims_opened',
                            to_status=intermediate_status, changed_by=user,
                        )
                        self._backdate_transition(TransitionModel, t_inter.pk, intermediate_dt)
                        EntryModel.objects.filter(pk=entry.pk).update(
                            status=intermediate_status, updated_at=intermediate_dt,
                        )

                    count += 1
            cursor = week_end + timedelta(days=1)
        return count
