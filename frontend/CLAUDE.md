# Frontend - Next.js 16 (App Router)

## Directory Structure

```
frontend/
  app/
    (dashboard)/              # Route group for authenticated pages
      layout.tsx              # Sidebar + auth guard + AI chat widget
      dashboard/page.tsx      # Metabase embedded dashboard
      general/
        new/page.tsx          # General New entries
        renewal/page.tsx      # General Renewal entries
        claim/page.tsx        # Placeholder "Coming Soon"
      motor/
        new/page.tsx          # Motor New entries
        renewal/page.tsx      # Motor Renewal entries
        claim/page.tsx        # Motor Claim entries
      sales/
        premium-data/page.tsx # Sales Premium Data entries
        kpi/page.tsx          # Sales KPI entries
      marine/
        new/page.tsx          # Marine New entries
        renewal/page.tsx      # Marine Renewal entries
      medical/
        claim/page.tsx        # Medical Claim entries
      admin/
        users/page.tsx        # User management (admin only)
        roles/page.tsx        # Role management (admin only)
    components/
      DataTable.tsx           # Reusable table with pagination, filters, add/edit dialog
      Sidebar.tsx             # Navigation sidebar (permission-aware)
      AiChat/                 # AI chat widget components
        ChatWidget.tsx        # Floating chat button + panel
        ChatInput.tsx
        ChatMessages.tsx
        MessageBubble.tsx
        DataTableModal.tsx    # Shows SQL query results in table
        SqlCollapsible.tsx    # Expandable SQL display
        SuggestedQuestions.tsx
    context/
      AuthContext.tsx          # Auth state, user info, login/logout, permission checks
    lib/
      api.ts                  # API client (fetch wrapper, types, all API functions)
      date.ts                 # Date formatting utilities
    login/page.tsx            # Magic link request form
    auth/verify/page.tsx      # Magic link token verification
    api/metabase/token/route.ts  # Server-side Metabase JWT signing
    layout.tsx                # Root layout (AuthProvider wrapper)
    page.tsx                  # Redirect to first accessible module
  components/
    ui/                       # Shadcn/ui primitives (button, input, dialog, table, etc.)
    metabase-frame.tsx        # Metabase iframe embed component
  lib/
    utils.ts                  # cn() utility for class merging
    metabase.ts               # Metabase token generation
```

## Auth Pattern

- **AuthContext** (`app/context/AuthContext.tsx`): Provides `user`, `loading`, `login()`, `logout()`, `hasModulePermission()`, `canSeeAllData()`
- JWT stored in HTTP-only cookies (set by backend, not accessible to JS)
- `api.ts` sends `credentials: 'include'` on every request
- On 401 response, `api.ts` automatically attempts token refresh via `POST /api/auth/refresh/`, then retries the original request
- `(dashboard)/layout.tsx` wraps all authenticated routes with auth guard

## API Client (`app/lib/api.ts`)

- `fetchApi<T>(endpoint, options)`: Core wrapper. Adds `credentials: 'include'` and `Content-Type: application/json`. Handles 401 auto-refresh.
- All API functions are typed and exported: `requestMagicLink()`, `getCurrentUser()`, `getUsers()`, `getRoles()`, `askAiChat()`, etc.
- Types defined inline: `User`, `Role`, `RoleFull`, `UserAdmin`, `PaginatedResponse<T>`, `AiChatResponse`
- `API_BASE_URL` from `NEXT_PUBLIC_API_URL` env var (defaults to `http://localhost:8000`)

## Module Page Pattern

All entry module pages (general/new, motor/claim, sales/kpi, etc.) follow the same structure:
1. Define column config and form fields for that module
2. Use `DataTable` component with the module's API endpoint
3. DataTable handles: fetching, pagination, search, date range filter, user filter (if `canSeeAllData`), add/edit dialog with form validation

## Key Components

- **DataTable** (`app/components/DataTable.tsx`): Generic table supporting pagination, search, date range filtering, user filtering, inline add/edit modals. Each module page configures it with columns and fields.
- **Sidebar** (`app/components/Sidebar.tsx`): Shows navigation based on user's module permissions from `AuthContext`. Categories (General, Motor, Sales, Marine, Medical) shown if user has any child permission.
- **AiChat** (`app/components/AiChat/ChatWidget.tsx`): Floating chat widget. Sends questions to `/api/ai-chat/ask/`, displays markdown summaries and SQL result tables.

## Commands

```bash
npm run dev     # Dev server on :3000
npm run build   # Production build
npm run start   # Start production server
npm run lint    # ESLint
```

## Environment Variables

| Variable | Description |
|----------|-----------|
| `NEXT_PUBLIC_API_URL` | Backend URL (default: `http://localhost:8000`) |
| `NEXT_PUBLIC_METABASE_DASHBOARD_ID` | Metabase dashboard ID for embedded dashboard |
| `METABASE_SECRET_KEY` | Server-side Metabase JWT signing key |
| `METABASE_SITE_URL` | Metabase instance URL |

## Adding a New Module Page

1. Create `app/(dashboard)/<category>/<module>/page.tsx`
2. Define columns array and form fields for the module
3. Use `DataTable` component with the matching backend endpoint (`/api/entries/<module-slug>/`)
4. Add the module to `Sidebar.tsx` navigation config
5. The module key must exist in the backend's `RoleModulePermission.MODULE_CHOICES`
6. Use `hasModulePermission(key)` from AuthContext if you need to conditionally render anything
