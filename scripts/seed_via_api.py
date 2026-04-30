#!/usr/bin/env python3
"""
Seed historical KPI data into a deployed KPI System backend via HTTP API.

Run from any machine (e.g. Windows CMD) with network access to the backend.
No backend code or shell access required.

Usage
-----
    pip install requests
    python scripts/seed_via_api.py --base-url https://api.example.com --email admin@kpisystem.com

Auth
----
The script can authenticate two ways:

  1. Magic link flow (default):
        - It POSTs to /api/auth/magic-link/request/ with --email.
        - You receive an email; copy the link or its `token=` parameter.
        - Paste the token (or full URL) at the prompt.

  2. Pre-fetched access token (skip the magic-link step):
        - Log in via the frontend in your browser.
        - Open DevTools -> Application -> Cookies -> copy `access_token` value.
        - Pass it via --access-token <jwt> (or env KPI_ACCESS_TOKEN).

The user must be a super-admin (`is_staff=True`) so the script can attribute
entries to other users via the on-behalf-of mechanism.

Limitations vs. running the management command on the backend
-------------------------------------------------------------
The API auto-fills `added_at` and the claim status-transition `changed_at`
with the current time, and these fields are read-only on the serializers.
That means:

  * All entries will have `date` in the historical past (correct) but
    `added_at` = "now" (the moment the script ran).
  * Claim TAT will be artificially short (seconds-minutes), not days.
  * SalesMonthlyTarget cannot be seeded for other users via the API
    (its viewset hard-codes user = request.user); the script SKIPS it.

For full historical realism (backdated added_at + multi-day claim TAT),
run the management command on the deployed backend instead:

    docker compose exec backend python manage.py seed_historical_data
"""

import argparse
import os
import random
import sys
import time
from datetime import date, timedelta
from urllib.parse import urlparse, parse_qs

try:
    import requests
except ImportError:
    print("ERROR: 'requests' package is required. Run:  pip install requests", file=sys.stderr)
    sys.exit(1)


# Module slug -> URL endpoint (under /api/entries/)
PER_DAY_ENDPOINTS = {
    'general_new': 'general-new',
    'general_renewal': 'general-renewal',
    'motor_new': 'motor-new',
    'motor_renewal': 'motor-renewal',
    'sales_kpi': 'sales-kpi',
    'marine_new': 'marine-new',
    'marine_renewal': 'marine-renewal',
}

CLAIM_ENDPOINTS = {
    'motor_claim': 'motor-claim',
    'medical_claim': 'medical-claim',
}

# Intermediate (non-terminal, non-initial) status for each claim module
CLAIM_INTERMEDIATE = {
    'motor_claim': 'claims_in_progress',
    'medical_claim': 'claims_in_progress',
}

# Module slugs declared in RBAC but with no concrete entry model
SKIPPED_MODULES = ['general_claim', 'sales_premium_data']

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


# ----------------------- CLI -----------------------

def parse_args():
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument('--base-url', default=os.environ.get('KPI_BASE_URL'),
                   help='Backend URL, e.g. https://kpi-api.example.com (or env KPI_BASE_URL)')
    p.add_argument('--email', default=os.environ.get('KPI_EMAIL'),
                   help='Super-admin email for magic-link auth (or env KPI_EMAIL)')
    p.add_argument('--access-token', default=os.environ.get('KPI_ACCESS_TOKEN'),
                   help='Pre-fetched JWT access token (skip magic-link flow). Env KPI_ACCESS_TOKEN.')
    p.add_argument('--start', default='2025-01-01', help='Start date YYYY-MM-DD (default 2025-01-01)')
    p.add_argument('--end', default=None, help='End date YYYY-MM-DD (default today)')
    p.add_argument('--seed', type=int, default=42, help='Random seed (default 42)')
    p.add_argument('--skip-claims', action='store_true', help='Skip motor_claim & medical_claim')
    p.add_argument('--only', nargs='+', metavar='MODULE', default=None,
                   help='Only seed these module keys (space-separated)')
    p.add_argument('--insecure', action='store_true', help='Skip TLS verification (debug only)')
    p.add_argument('--rate-limit-ms', type=int, default=0,
                   help='Sleep this many ms between requests (default 0)')
    args = p.parse_args()

    if not args.base_url:
        p.error('--base-url is required (or set KPI_BASE_URL).')
    if not args.access_token and not args.email:
        p.error('Either --access-token or --email is required.')

    args.base_url = args.base_url.rstrip('/')
    return args


# ----------------------- Auth -----------------------

def make_session(args):
    session = requests.Session()
    if args.insecure:
        import urllib3
        urllib3.disable_warnings(urllib3.exceptions.InsecureRequestWarning)
        session.verify = False
    return session


def authenticate(session, args):
    if args.access_token:
        host = urlparse(args.base_url).hostname
        session.cookies.set('access_token', args.access_token, domain=host, path='/')
        print(f'Using pre-fetched access token for {host}.')
        whoami = session.get(f'{args.base_url}/api/auth/user/')
        if whoami.status_code != 200:
            sys.exit(f'Token auth failed: HTTP {whoami.status_code} - {whoami.text[:200]}')
        user = whoami.json()
        print(f'  Logged in as {user.get("email")} (is_staff={user.get("is_staff")})')
        if not user.get('is_staff'):
            sys.exit('ERROR: this user is not a super-admin. Need is_staff=True to seed for other users.')
        return user

    print(f'Requesting magic link for {args.email} ...')
    r = session.post(f'{args.base_url}/api/auth/magic-link/request/',
                     json={'email': args.email})
    if r.status_code != 200:
        sys.exit(f'Magic link request failed: HTTP {r.status_code} - {r.text[:300]}')
    print('  Email sent (or would have been sent if the address is on the system).')

    print()
    raw = input('Paste the verification token (or the full URL from the email): ').strip()
    token = _extract_token(raw)
    if not token:
        sys.exit('Could not extract a token from the provided input.')

    r = session.get(f'{args.base_url}/api/auth/magic-link/verify/', params={'token': token})
    if r.status_code != 200:
        sys.exit(f'Magic link verification failed: HTTP {r.status_code} - {r.text[:300]}')
    user = r.json().get('user', {})
    print(f'  Logged in as {user.get("email")} (is_staff={user.get("is_staff")})')
    if not user.get('is_staff'):
        sys.exit('ERROR: this user is not a super-admin. Need is_staff=True to seed for other users.')
    return user


def _extract_token(raw):
    if raw.startswith('http://') or raw.startswith('https://'):
        qs = parse_qs(urlparse(raw).query)
        if 'token' in qs:
            return qs['token'][0]
    return raw


# ----------------------- Discovery -----------------------

def fetch_paginated(session, url):
    """Fetch every page of a DRF paginated list."""
    items = []
    next_url = url
    while next_url:
        r = session.get(next_url)
        r.raise_for_status()
        data = r.json()
        if isinstance(data, list):
            items.extend(data)
            return items
        items.extend(data.get('results', []))
        next_url = data.get('next')
    return items


def build_module_user_map(session, base_url):
    """Return dict: module_key -> list of {'id': ..., 'email': ..., 'name': ...}"""
    print('Fetching users and roles ...')
    users = fetch_paginated(session, f'{base_url}/api/auth/users/')
    roles = fetch_paginated(session, f'{base_url}/api/roles/')
    print(f'  {len(users)} users, {len(roles)} roles')

    role_modules = {}
    for role in roles:
        perms = role.get('permissions') or []
        modules = []
        for p in perms:
            if isinstance(p, dict):
                modules.append(p.get('module'))
            elif isinstance(p, str):
                modules.append(p)
        role_modules[role['id']] = [m for m in modules if m]

    module_to_users = {}
    for u in users:
        if not u.get('is_active') or u.get('is_staff'):
            continue
        role_id = u.get('role_id') or u.get('role')
        if isinstance(role_id, dict):
            role_id = role_id.get('id')
        if not role_id:
            continue
        for module_key in role_modules.get(role_id, []):
            module_to_users.setdefault(module_key, []).append({
                'id': u['id'],
                'email': u['email'],
                'name': u.get('full_name') or u['email'],
            })
    return module_to_users


# ----------------------- Date pool -----------------------

def build_weekday_pool(start, end, drop_pct=0.10):
    days = []
    d = start
    while d <= end:
        if d.weekday() < 5 and random.random() > drop_pct:
            days.append(d)
        d += timedelta(days=1)
    return days


# ----------------------- POST helpers -----------------------

class Stats:
    def __init__(self):
        self.created = 0
        self.duplicate = 0
        self.errors = 0


def post_entry(session, url, payload, stats, rate_limit_ms=0):
    r = session.post(url, json=payload)
    if rate_limit_ms:
        time.sleep(rate_limit_ms / 1000.0)
    if r.status_code in (200, 201):
        stats.created += 1
        return r.json()
    if r.status_code == 400:
        body = _safe_text(r)
        if 'already exists' in body.lower() or 'unique' in body.lower():
            stats.duplicate += 1
            return None
        stats.errors += 1
        if stats.errors <= 5:
            print(f'    ! 400 {url}: {body[:200]}')
        return None
    stats.errors += 1
    if stats.errors <= 5:
        print(f'    ! HTTP {r.status_code} {url}: {_safe_text(r)[:200]}')
    return None


def _safe_text(r):
    try:
        return r.text
    except Exception:
        return f'<unreadable response status={r.status_code}>'


# ----------------------- Field generators -----------------------

def kpi_funnel_payload(date_iso, added_by_id, qmin, qmax, acc_min, acc_max):
    quotations = random.randint(qmin, qmax)
    quotes_revised = random.randint(0, quotations)
    quotes_converted = random.randint(0, quotes_revised)
    return {
        'date': date_iso,
        'added_by': added_by_id,
        'quotations': quotations,
        'quotes_revised': quotes_revised,
        'quotes_converted': quotes_converted,
        'tat': random.randint(1, 7),
        'accuracy': str(round(random.uniform(acc_min, acc_max), 2)),
    }


def motor_renewal_payload(date_iso, added_by_id):
    quotations = random.randint(15, 35)
    retention = random.randint(0, quotations)
    return {
        'date': date_iso,
        'added_by': added_by_id,
        'quotations': quotations,
        'retention': retention,
        'tat': random.randint(1, 7),
        'accuracy': str(round(random.uniform(85.0, 99.5), 2)),
    }


def sales_kpi_payload(date_iso, added_by_id):
    leads = random.randint(15, 40)
    quotes_from_ops = random.randint(0, leads)
    quotes_to_client = random.randint(0, quotes_from_ops)
    conversions = random.randint(0, quotes_to_client)
    new_clients = random.randint(0, conversions)
    existing = random.randint(20, 80)
    return {
        'date': date_iso,
        'added_by': added_by_id,
        'leads_to_ops_team': leads,
        'quotes_from_ops_team': quotes_from_ops,
        'quotes_to_client': quotes_to_client,
        'total_conversions': conversions,
        'new_clients_acquired': new_clients,
        'existing_clients': existing,
        'existing_clients_closed': random.randint(0, existing),
        'gross_booked_premium': str(round(random.uniform(50_000, 500_000), 2)),
    }


def marine_new_payload(date_iso, added_by_id):
    return {
        'date': date_iso,
        'added_by': added_by_id,
        'gross_booked_premium': str(round(random.uniform(2_000, 80_000), 2)),
        'quotes_created': random.randint(2, 15),
        'new_clients_acquired': random.randint(0, 5),
        'new_policies_issued': random.randint(0, 8),
    }


def marine_renewal_payload(date_iso, added_by_id):
    return {
        'date': date_iso,
        'added_by': added_by_id,
        'monthly_renewal_quotes_assigned': random.randint(50, 200),
        'gross_booked_premium': str(round(random.uniform(5_000, 100_000), 2)),
        'quotes_created': random.randint(2, 20),
        'renewal_policies_issued': random.randint(0, 12),
    }


# ----------------------- Module seeders -----------------------

def seed_per_day(session, base_url, module_key, users, dates, payload_fn, rate_limit_ms):
    url = f'{base_url}/api/entries/{PER_DAY_ENDPOINTS[module_key]}/'
    stats = Stats()
    total = len(users) * len(dates)
    progress_every = max(50, total // 20) if total else 1
    i = 0
    for user in users:
        for d in dates:
            payload = payload_fn(d.isoformat(), user['id'])
            post_entry(session, url, payload, stats, rate_limit_ms)
            i += 1
            if i % progress_every == 0:
                _print_progress(module_key, i, total, stats)
    print(f'  [{module_key}] created={stats.created} duplicate={stats.duplicate} errors={stats.errors}')
    return stats


def seed_claims(session, base_url, module_key, users, start, end, rate_limit_ms):
    url = f'{base_url}/api/entries/{CLAIM_ENDPOINTS[module_key]}/'
    intermediate = CLAIM_INTERMEDIATE[module_key]
    stats = Stats()

    today = date.today()
    cursor = start
    weeks = []
    while cursor <= end:
        week_end = min(cursor + timedelta(days=6), end)
        weekdays = [
            cursor + timedelta(days=i)
            for i in range((week_end - cursor).days + 1)
            if (cursor + timedelta(days=i)).weekday() < 5
        ]
        if weekdays:
            weeks.append(weekdays)
        cursor = week_end + timedelta(days=1)

    total_estimate = len(weeks) * len(users) * 4
    progress_every = max(50, total_estimate // 20) if total_estimate else 1
    i = 0
    for weekdays in weeks:
        for user in users:
            for _ in range(random.randint(3, 5)):
                d = random.choice(weekdays)
                customer_name = random.choice(CUSTOMER_NAMES)
                payload = {
                    'date': d.isoformat(),
                    'added_by': user['id'],
                    'customer_name': customer_name,
                    'status': 'claims_opened',
                }
                created = post_entry(session, url, payload, stats, rate_limit_ms)
                i += 1
                if i % progress_every == 0:
                    _print_progress(module_key, i, total_estimate, stats)
                if not created:
                    continue

                rand_val = random.random()
                if rand_val < 0.70:
                    # full lifecycle: opened -> intermediate -> terminal
                    _patch_status(session, base_url, module_key, created['id'], intermediate, stats, rate_limit_ms)
                    terminal = 'claims_resolved' if random.random() < 0.75 else 'claims_rejected'
                    _patch_status(session, base_url, module_key, created['id'], terminal, stats, rate_limit_ms)
                elif rand_val < 0.85:
                    _patch_status(session, base_url, module_key, created['id'], intermediate, stats, rate_limit_ms)
    print(f'  [{module_key}] created={stats.created} duplicate={stats.duplicate} errors={stats.errors}')
    return stats


def _patch_status(session, base_url, module_key, entry_id, new_status, stats, rate_limit_ms):
    url = f'{base_url}/api/entries/{CLAIM_ENDPOINTS[module_key]}/{entry_id}/update-status/'
    r = session.patch(url, json={'status': new_status})
    if rate_limit_ms:
        time.sleep(rate_limit_ms / 1000.0)
    if r.status_code not in (200, 201):
        stats.errors += 1
        if stats.errors <= 5:
            print(f'    ! status patch HTTP {r.status_code}: {_safe_text(r)[:200]}')


def _print_progress(module_key, i, total, stats):
    pct = (i / total * 100) if total else 0
    print(f'    {module_key}: {i}/{total} ({pct:.0f}%)  '
          f'created={stats.created} dup={stats.duplicate} err={stats.errors}')


# ----------------------- Main -----------------------

def main():
    args = parse_args()
    random.seed(args.seed)

    start = date.fromisoformat(args.start)
    end = date.fromisoformat(args.end) if args.end else date.today()
    if start > end:
        sys.exit(f'Start ({start}) is after end ({end}).')

    only_filter = set(args.only) if args.only else None

    print(f'\n=== KPI seed via API ===')
    print(f'Backend: {args.base_url}')
    print(f'Date range: {start} -> {end}')
    print(f'Random seed: {args.seed}')
    print('Note: All entries get added_at = "now" (API limitation). '
          'Claim TATs will be near-zero. For backdated data, run the '
          'seed_historical_data management command on the backend.\n')

    for slug in SKIPPED_MODULES:
        print(f'  ! Skipping "{slug}" (RBAC-only, no model)')

    session = make_session(args)
    authenticate(session, args)

    module_to_users = build_module_user_map(session, args.base_url)

    weekday_dates = build_weekday_pool(start, end)
    print(f'\nDate pool: {len(weekday_dates)} weekdays\n')

    payload_fns = {
        'general_new': lambda d, u: kpi_funnel_payload(d, u, 5, 25, 85.0, 99.5),
        'general_renewal': lambda d, u: kpi_funnel_payload(d, u, 10, 30, 88.0, 99.5),
        'motor_new': lambda d, u: kpi_funnel_payload(d, u, 8, 20, 90.0, 99.5),
        'motor_renewal': motor_renewal_payload,
        'sales_kpi': sales_kpi_payload,
        'marine_new': marine_new_payload,
        'marine_renewal': marine_renewal_payload,
    }

    grand_stats = Stats()

    for module_key, payload_fn in payload_fns.items():
        if only_filter and module_key not in only_filter:
            continue
        users = module_to_users.get(module_key) or []
        if not users:
            print(f'  ! No active non-staff users have "{module_key}" — '
                  f'attribute via the role permissions, or skip.')
            continue
        print(f'Seeding {module_key} ({len(users)} users x {len(weekday_dates)} days = '
              f'{len(users)*len(weekday_dates)} requests)')
        s = seed_per_day(session, args.base_url, module_key, users, weekday_dates,
                         payload_fn, args.rate_limit_ms)
        grand_stats.created += s.created
        grand_stats.duplicate += s.duplicate
        grand_stats.errors += s.errors

    if not args.skip_claims:
        for module_key in CLAIM_ENDPOINTS:
            if only_filter and module_key not in only_filter:
                continue
            users = module_to_users.get(module_key) or []
            if not users:
                print(f'  ! No users have "{module_key}" — skipping')
                continue
            print(f'Seeding {module_key} (claim lifecycle, {len(users)} users)')
            s = seed_claims(session, args.base_url, module_key, users, start, end,
                            args.rate_limit_ms)
            grand_stats.created += s.created
            grand_stats.duplicate += s.duplicate
            grand_stats.errors += s.errors

    print(f'\n=== Done ===')
    print(f'Total: created={grand_stats.created} '
          f'duplicate={grand_stats.duplicate} errors={grand_stats.errors}')

    if grand_stats.errors:
        sys.exit(1)


if __name__ == '__main__':
    main()
