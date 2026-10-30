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
- List search box sends `?q=` (`EntrySearchMixin` in `entries/filters.py`): exact `pib_id` match ('12' / 'PIB-12' -> only PIB-12) OR icontains on the filterset's `search_text_fields`; `?search=` stays DRF's added_by search

## Marine New clients: `client_name` vs `client` (mid-migration)

Marine New is moving from a free-text client name to a saved client record, and **both columns exist on purpose**:

| Column | Status | Meaning |
|---|---|---|
| `client` (`client_id` FK → `entries_client`) | **Use this.** The source of truth from now on. | The saved `Client` (name, unique `@username`, notes, `is_<category>` flags). New enquiries must pick one from the dropdown (`ClientSelect`). |
| `client_name` (text) | **Legacy, read-only.** Being phased out. | The old typed name on enquiries created before `MARINE_CLIENT_LINK_CUTOFF` (env, default `2026-11-01`). New rows save `''`. When the creator links an old row through the "Link client" action, `client_name` is cleared to `''` (permanent). |

Rules for all future work:
- **Build every new Marine feature on `client`** (search, filters, reports, exports, Metabase questions, dashboards, AI chat), never on `client_name`.
- To display a name, use `client_display` (the `client.name` if linked, else the legacy `client_name`) until every legacy row is linked.
- Don't write to `client_name` from new code. Only the link-client action may clear it.
- Metabase and SQL should join `entries_client` on `entries_marinenewentry.client_id`. Questions that read `client_name` show blanks for new and linked rows.
- Once every legacy row is linked, `client_name` can be dropped in a later, separate migration, but only after confirming with the user, because the system is in production.

## Adding a New Module — checklist (update ALL of these)

Module keys are listed in several hand-maintained places. Missing one silently breaks access, the sidebar, audit, the tracker, or the client list. When adding a module (e.g. `marine_renewal` becoming per-enquiry, or a new `medical_*` module), check every item:

**Backend**
- [ ] `backend/roles/models.py`: add the key to `RoleModulePermission.MODULE_CHOICES`, then run `makemigrations roles`.
- [ ] `backend/entries/models.py`: add the model (extends `BaseEntry`; per-enquiry modules also use `StoredQualityMixin` and a `*StatusTransition` model).
- [ ] `backend/entries/models.py`: add the key to `CATEGORY_MODULES` under its parent category (general / motor / sales / marine / medical). This decides which saved-client list (`Client.is_<category>`) the module's users can see and create in.
- [ ] `backend/entries/serializers.py`, `views.py` (set `module_key`), `filters.py` and `urls.py` (router).
- [ ] `backend/entries/views.py`: add the module to `ALLOWED_REMARK_MODELS` if it shows the comments panel.
- [ ] `backend/entries/tracker_common.py`: add it to the module → model and module → label maps (Team Daily Tracker).
- [ ] `backend/audit/registry.py`: add it to `MODEL_TO_CATEGORY` and `CATEGORY_ORDER`.
- [ ] Dashboards are gated by their own permission key (e.g. `marine_dashboard`), not by the entry modules. A new module does not grant its category's dashboard; admins tick that separately.
- [ ] `backend/auth_app/management/commands/seed_historical_data.py`: seed support (optional, keeps dev data realistic).
- [ ] `backend/ai_chat/training_data.py`: add the table's DDL and docs so AI chat can query it.

**Frontend**
- [ ] `frontend/app/components/Sidebar.tsx`: add a nav item under the right parent group, with `moduleKey`.
- [ ] `frontend/app/lib/navigation.ts`: add it to `MODULE_ROUTES` (first-accessible-route redirect).
- [ ] `frontend/app/lib/audit.ts`: add it to `AUDIT_CATEGORIES` (must mirror `backend/audit/registry.py`).
- [ ] `frontend/app/(dashboard)/<group>/<module>/page.tsx`: the page.
- [ ] If the module picks a saved client: use `ClientSelect` with `category="<parent category>"` (see `MarineNewEnquiryPage.tsx`) and add a link-client flow for legacy rows if needed.

**Docs**
- [ ] This file's module list, plus `backend/CLAUDE.md` and `frontend/CLAUDE.md`.

### Adding a new parent category (a new sidebar group)
- [ ] `backend/entries/models.py`: add it to `CLIENT_CATEGORIES` and `CATEGORY_MODULES`, and add an `is_<category>` BooleanField to `Client` (additive migration, default False).
- [ ] `frontend/app/components/Sidebar.tsx`: add the new group.
