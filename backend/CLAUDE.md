# Backend - Django REST Framework

## Directory Structure

```
backend/
  backend/          # Project config
    settings.py     # All config: DB, JWT, CORS, email, Vanna/OpenAI
    urls.py         # Root URL routing to 4 apps
    wsgi.py
  auth_app/         # Authentication + user management
    models.py       # CustomUser, MagicLink
    authentication.py # CookieJWTAuthentication (reads JWT from cookies)
    views.py        # RequestMagicLinkView, VerifyMagicLinkView, LogoutView, RefreshTokenView, UserViewSet
    serializers.py
    urls.py
    management/commands/
      seed_superadmin.py  # Creates initial admin user
      seed_data.py        # Sample roles, users, entries for development
  entries/            # KPI data entry (core domain)
    models.py         # BaseEntry (abstract) + 10 concrete entry models
    views.py          # BaseEntryViewSet + 10 concrete viewsets
    serializers.py
    filters.py        # EntryFilter (date range, search)
    urls.py           # DRF router registering all 10 viewsets
  roles/              # RBAC system
    models.py         # Role, RoleModulePermission
    permissions.py    # HasModulePermission, IsAdminUser
    views.py          # RoleViewSet
    serializers.py
    urls.py
  ai_chat/            # AI-powered data queries
    vanna_service.py  # Vanna.ai integration (text-to-SQL)
    sql_validator.py  # Validates generated SQL is safe (SELECT only)
    training_data.py  # DDL/documentation used to train Vanna
    views.py          # AskView (POST /api/ai-chat/ask/)
    urls.py
```

## Auth System

- **CookieJWTAuthentication** (`auth_app/authentication.py`): Reads `access_token` from HTTP-only cookie (not Authorization header). Extends `JWTAuthentication` from `djangorestframework-simplejwt`.
- **Magic links**: User requests link via email -> single-use token created -> token verified -> JWT issued as HTTP-only cookies (`access_token` + `refresh_token`)
- **Token lifetimes**: Access 15 min, Refresh 7 days (30 days with "remember me")
- **No passwords**: `CustomUser` extends `AbstractBaseUser` but auth is entirely magic-link based

## Entry Models

All inherit from `BaseEntry` (abstract):
- Fields: `date`, `added_by` (FK to user), `added_at`, `updated_at`
- Method: `is_editable()` - checks 30-minute window from `added_at`
- Method: `can_edit(user)` - ownership + edit window check

Concrete models:
| Model | Module Key | Extra Fields |
|-------|-----------|-------------|
| GeneralNewEntry | `general_new` | quotations, quotes_revised, quotes_converted, tat, accuracy |
| GeneralRenewalEntry | `general_renewal` | quotations, quotes_revised, quotes_converted, tat, accuracy |
| MotorNewEntry | `motor_new` | quotations, quotes_revised, tat, accuracy |
| MotorRenewalEntry | `motor_renewal` | quotations, retention, tat, accuracy |
| MotorClaimEntry | `motor_claim` | customer_name, status (claims_opened/claims_in_progress/claims_resolved/claims_rejected) |
| MotorClaimStatusTransition | — | entry FK, from_status, to_status, changed_by, changed_at |
| SalesPremiumDataEntry | `sales_premium_data` | gross_booked_premium, target |
| SalesKPIEntry | `sales_kpi` | leads_to_ops_team, quotes_from_ops_team, quotes_to_client, total_conversions, existing_clients, existing_clients_closed, new_clients_acquired |
| MarineNewEntry | `marine_new` | gross_booked_premium, quotes_created, new_clients_acquired, new_policies_issued |
| MarineRenewalEntry | `marine_renewal` | monthly_renewal_quotes_assigned, gross_booked_premium, quotes_created, renewal_policies_issued |
| MedicalClaimEntry | `medical_claim` | customer_name, status (claims_opened/claims_in_progress/claims_resolved/claims_rejected) |

## Viewset Pattern

`BaseEntryViewSet` handles all shared logic:
- `get_queryset()`: Filters by `data_visibility` (role's `all` vs `own`) and optional `user_id` param
- `perform_create()`: Sets `added_by` to current user
- `update()`: Checks ownership + 30-min edit window
- `destroy()`: Checks ownership (staff can delete any)
- Permission classes: `[IsAuthenticated, HasModulePermission]`
- Each subclass sets `queryset`, `serializer_class`, and `module_key`

## RBAC

- **HasModulePermission** (`roles/permissions.py`): Checks `view.module_key` against user's `role.permissions`. Staff bypasses.
- **IsAdminUser**: Simple `is_staff` check for admin-only endpoints.
- **Data visibility**: Role has `data_visibility` field (`all` | `own`). Enforced in `BaseEntryViewSet.get_queryset()`.
- **Module permissions**: `RoleModulePermission` links Role to module keys. 11 possible modules defined in `MODULE_CHOICES`.

## AI Chat

- Uses Vanna.ai to convert natural language questions to SQL
- **VannaService** (`ai_chat/vanna_service.py`): Wraps Vanna with OpenAI + ChromaDB backend
- **SQL validation** (`ai_chat/sql_validator.py`): Only allows SELECT queries
- **Training data** (`ai_chat/training_data.py`): DDL schemas + example queries
- Single endpoint: `POST /api/ai-chat/ask/` with `{ "question": "..." }`

## Full API URL Structure

```
/api/auth/magic-link/request/     POST   - Request magic link email
/api/auth/magic-link/verify/      GET    - Verify token, set JWT cookies
/api/auth/logout/                  POST   - Clear cookies
/api/auth/refresh/                 POST   - Refresh access token
/api/auth/user/                    GET    - Current user info
/api/auth/csrf/                    GET    - CSRF token
/api/auth/users/                   GET/POST - List/create users (admin)
/api/auth/users/{id}/              GET/PATCH/DELETE - User detail (admin)
/api/auth/users/{id}/activate/     POST   - Activate user (admin)
/api/auth/users/{id}/deactivate/   POST   - Deactivate user (admin)

/api/entries/general-new/          GET/POST
/api/entries/general-new/{id}/     GET/PATCH/DELETE
/api/entries/general-renewal/      (same pattern)
/api/entries/motor-new/            (same pattern)
/api/entries/motor-renewal/        (same pattern)
/api/entries/motor-claim/          (same pattern)
/api/entries/motor-claim/stats/    GET    - Per-status counts (claims_opened, claims_in_progress, claims_resolved, claims_rejected)
/api/entries/motor-claim/{id}/update-status/  PATCH  - Transition status (bypasses 30-min window)
/api/entries/sales-premium-data/   (same pattern)
/api/entries/sales-kpi/            (same pattern)
/api/entries/marine-new/           (same pattern)
/api/entries/marine-renewal/       (same pattern)
/api/entries/medical-claim/       (same pattern)

/api/roles/                        GET/POST
/api/roles/{id}/                   GET/PATCH/DELETE
/api/roles/modules/                GET    - List available modules

/api/ai-chat/ask/                  POST   - Natural language query
```

## Common Commands

```bash
cd backend
source .venv/bin/activate
python manage.py runserver                  # Dev server on :8000
python manage.py migrate                    # Apply migrations
python manage.py makemigrations             # Generate migrations
python manage.py seed_superadmin            # Create admin@example.com
python manage.py seed_data                  # Seed sample data
python manage.py shell                      # Django shell
```

## Config Notes

- `.env` file loaded from `backend/.env` via `python-dotenv`
- `EMAIL_CONSOLE_MODE=true` prints magic links to console (useful for dev)
- `DATABASE_URL` env var switches from SQLite to PostgreSQL
- `CORS_ALLOW_ALL_ORIGINS` is currently `True` (debug override in settings.py)
- Pagination: 20 items per page default (`PAGE_SIZE` in DRF settings)

## Adding a New Module

1. Add model in `entries/models.py` inheriting `BaseEntry`
2. Add serializer in `entries/serializers.py`
3. Add viewset in `entries/views.py` inheriting `BaseEntryViewSet` with `module_key`
4. Register route in `entries/urls.py` router
5. Add module key to `RoleModulePermission.MODULE_CHOICES` in `roles/models.py`
6. Run `makemigrations` + `migrate`
7. Add corresponding frontend page (see frontend CLAUDE.md)
