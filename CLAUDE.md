# KPI System

Employee performance tracking system for an insurance company. Staff enter daily KPI data across 10 modules; admins manage users, roles, and permissions.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | Next.js 16 (App Router), React 19, TypeScript |
| UI | Shadcn/ui (Radix), Tailwind CSS v4, light mode only |
| Backend | Django 4.2, Django REST Framework |
| Auth | Passwordless magic links + JWT (HTTP-only cookies) |
| Database | SQLite (dev), PostgreSQL (prod via `dj-database-url`) |
| AI Chat | Vanna.ai + OpenAI + ChromaDB (natural language SQL queries) |
| Dashboard | Metabase (embedded iframe, separate container) |

## Quick Start

### Backend
```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_superadmin   # creates admin@example.com
python manage.py seed_data          # optional: sample roles, users, entries
python manage.py runserver
```

### Frontend
```bash
cd frontend
npm install
npm run dev   # http://localhost:3000
```

### Docker (production-like)
```bash
# Requires .env with DB_PASSWORD, SECRET_KEY, etc.
docker compose up --build
```
Services: PostgreSQL, Metabase (:3001), backend (:8000), frontend (:3000). A reverse proxy (Traefik/nginx) sits in front.

## Key Domain Concepts

- **11 Modules**: general_new, general_renewal, general_claim (placeholder), motor_new, motor_renewal, motor_claim, sales_premium_data, sales_kpi, marine_new, marine_renewal, medical_claim
- **Claim modules** (motor_claim, medical_claim): Per-customer status tracking with state machine (claims_opened → claims_in_progress → claims_resolved/claims_rejected), calculated TAT, and status transition history
- **RBAC**: Each user has one Role. Roles grant per-module access + data visibility (`all` or `own`)
- **30-minute edit window**: Users can only edit their own entries within 30 minutes of creation
- **Magic link auth**: No passwords. Users enter email, receive a single-use login link
- **Super-admin**: `is_staff=True`, full access, created via `seed_superadmin`

## API Routes

| Prefix | App |
|--------|-----|
| `/api/auth/` | auth_app - magic links, login, users CRUD |
| `/api/entries/` | entries - all 10 module entry endpoints (DRF routers) |
| `/api/roles/` | roles - role CRUD + module permissions |
| `/api/ai-chat/` | ai_chat - natural language query endpoint |

## Project Structure

```
backend/
  auth_app/     # CustomUser, MagicLink, CookieJWTAuthentication, UserViewSet
  entries/      # BaseEntry + 10 concrete models, BaseEntryViewSet + 10 viewsets
  roles/        # Role, RoleModulePermission, HasModulePermission
  ai_chat/      # Vanna service, SQL validation, training data
  backend/      # settings.py, urls.py, wsgi.py
frontend/
  app/
    (dashboard)/  # All authenticated pages (layout with sidebar)
    components/   # DataTable, Sidebar, AiChat/
    context/      # AuthContext (JWT cookie auth)
    lib/          # api.ts (fetch wrapper with auto-refresh), date.ts
    login/        # Magic link request page
    auth/verify/  # Magic link verification
  components/ui/  # Shadcn/ui primitives
```

## Conventions

- Backend uses `BaseEntry` abstract model + `BaseEntryViewSet` pattern for all modules
- Frontend module pages follow identical structure: DataTable + add/edit dialog
- API client (`app/lib/api.ts`) wraps fetch with cookie credentials and automatic 401 token refresh
- All entry viewsets require `IsAuthenticated` + `HasModulePermission`
- No WebSocket/Redis/Django Channels (despite what SPEC.md said) - notifications not implemented
