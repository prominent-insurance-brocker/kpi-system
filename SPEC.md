# Employee Performance Tracking System - Technical Specification

## Document Info
- **Generated:** January 7, 2026
- **Based on:** PRD + Stakeholder Interview
- **Status:** Approved for Implementation

---

## 1. Tech Stack

| Layer | Technology |
|-------|------------|
| Frontend | Next.js 16 (App Router), React 19, TypeScript |
| UI Components | Shadcn/ui (Radix-based) |
| Styling | Tailwind CSS v4, Light mode only |
| Backend | Django 4.2, Django REST Framework |
| WebSocket | Django Channels + Redis |
| Database | SQLite (development), PostgreSQL (production) |
| Auth | Passwordless Magic Links + JWT |
| Email | SMTP (Gmail/Outlook) |

---

## 2. Authentication System

### 2.1 Magic Link Flow
1. User enters email on login page
2. Backend generates single-use token (10-15 minute expiry)
3. Email sent via SMTP with personalized greeting
4. User clicks link (cross-device allowed)
5. Backend validates token, issues JWT in HTTP-only cookies
6. User redirected to first accessible module

### 2.2 Token Rules
- **Single-use:** Each token invalidated after use
- **Latest-only:** New token request invalidates all previous tokens for that email
- **Expiry:** 10-15 minutes
- **Cross-device:** Link works on any device/browser

### 2.3 Email Template
```
Subject: Your login link for KPI System

Hi [First Name],

Click the link below to login to your account:
[Magic Link URL]

This link expires in 15 minutes.

If you didn't request this, please ignore this email.
```

### 2.4 Session Management
- **Default duration:** Until explicit logout (browser session)
- **"Remember me" checkbox:** Extends to 30 days
- **JWT Tokens:**
  - Access token: 15 minutes
  - Refresh token: 7 days (or 30 days if "remember me")
- **No session history tracking**

### 2.5 Error Handling
- SMTP failure: Show error "Failed to send email. Please try again."
- Invalid/expired token: Show "Link expired or invalid. Request a new one."
- Account deactivated: API returns error, show warning, redirect after 5 seconds

---

## 3. User Management

### 3.1 User Model
```python
CustomUser:
  - email (unique, required)
  - first_name (optional)
  - last_name (optional)
  - role (FK to Role, single role only)
  - is_active (boolean)
  - is_staff (boolean, for super-admin)
  - date_joined (auto)
  - last_login (auto)
```

### 3.2 User Roles
- **Super-admin:** Single account, full system access, created via DB seed
- **Regular users:** Assigned one role by admin

### 3.3 User Table (Admin Only)
| Column | Description |
|--------|-------------|
| Name | First + Last name |
| Email | User email |
| Role | Badge with role name |
| Status | Active/Inactive badge |
| Created At | Absolute timestamp |
| Updated At | Absolute timestamp |
| Last Login | Absolute timestamp |
| Actions | Menu: Edit, Activate/Deactivate, Delete |

### 3.4 Add/Edit User Modal
- Fields: Name, Email, Role (dropdown)
- No password field
- On create: User must request their own magic link

### 3.5 User Actions
- **Single-user only** (no bulk actions)
- **Hard delete** (no soft delete)
- **Deactivation:** Immediate enforcement, active sessions fail with warning

### 3.6 Profile Page
Users can edit their own:
- First name
- Last name

Users cannot edit:
- Email
- Role (admin-controlled)

---

## 4. Role-Based Access Control (RBAC)

### 4.1 Role Model
```python
Role:
  - name (required, unique)
  - description (optional)
  - data_visibility (enum: 'all' | 'own')
  - created_at (auto)
  - updated_at (auto)

RoleModulePermission:
  - role (FK to Role)
  - module (enum: module identifiers)
```

### 4.2 Modules (Permission Targets)
```
- general_new
- general_renewal
- general_claim (placeholder)
- motor_new
- motor_renewal
- motor_claim
```

### 4.3 Permission Rules
- **Category selection:** Selecting "General" selects all General modules
- **Child selection:** Selecting individual child does NOT auto-select parent
- **Indeterminate state:** Parent shows indeterminate if partial selection
- **New modules:** Explicit grant required (no auto-inheritance)
- **Dashboard:** Always accessible to all authenticated users

### 4.4 Data Visibility
| Setting | Behavior |
|---------|----------|
| `all` | User sees all entries from all users in tables |
| `own` | User sees only their own entries in tables |

**Scope:** Applies to module tables only, NOT dashboard (dashboard always shows all)

### 4.5 Role Management UI
- Tree-based checkbox selection for modules
- Radio buttons for data visibility
- No preview of affected users
- Changes take effect immediately

---

## 5. Sidebar Navigation

### 5.1 Structure
```
Dashboard (always visible)
General (category)
  ├─ General New
  ├─ General Renewal
  └─ General Claim (Coming Soon)
Motor (category)
  ├─ Motor New
  ├─ Motor Renewal
  └─ Motor Claim
User Management (admin only)
  ├─ Users
  └─ Roles
```

### 5.2 Visibility Rules
- Show only modules user has permission for
- Show category if user has access to any child
- Hide unauthorized items completely
- **State:** Collapsed on login, not persisted

---

## 6. Data Entry Modules

### 6.1 Module Fields

#### General New
| Field | Type | Validation |
|-------|------|------------|
| Date | Date picker | Any date |
| No. of quotations | Integer | >= 0 |
| No. of quotes revised | Integer | >= 0 |
| No. of quotes converted | Integer | >= 0 |
| TAT | Integer | >= 0 |
| Accuracy | Decimal | 0-100 (percentage) |

#### General Renewal
| Field | Type | Validation |
|-------|------|------------|
| Date | Date picker | Any date |
| No. of quotations | Integer | >= 0 |
| No. of quotes revised | Integer | >= 0 |
| No. of quotes converted | Integer | >= 0 |
| TAT | Integer | >= 0 |
| Accuracy | Decimal | 0-100 (percentage) |

#### General Claim
**Placeholder only** - Show "Coming Soon" message

#### Motor New
| Field | Type | Validation |
|-------|------|------------|
| Date | Date picker | Any date |
| No. of quotations | Integer | >= 0 |
| No. of quotes revised | Integer | >= 0 |
| TAT | Integer | >= 0 |
| Accuracy | Decimal | 0-100 (percentage) |

#### Motor Renewal
| Field | Type | Validation |
|-------|------|------------|
| Date | Date picker | Any date |
| No. of quotations | Integer | >= 0 |
| Retention | Integer | >= 0 (count) |
| TAT | Integer | >= 0 |
| Accuracy | Decimal | 0-100 (percentage) |

#### Motor Claim
| Field | Type | Validation |
|-------|------|------------|
| Date | Date picker | Any date |
| No. of registered claims | Integer | >= 0 |
| No. of claims closed | Integer | >= 0 |
| No. of pending cases | Integer | >= 0 (manual entry) |
| TAT | Integer | >= 0 |

### 6.2 Entry Metadata (Auto-populated)
- `added_by` - User who created entry
- `added_at` - Timestamp of creation
- `updated_at` - Timestamp of last edit

### 6.3 Entry Rules
- **Multiple entries per date:** Allowed
- **Backdating:** Allowed (any date via date picker)
- **Status:** All entries immediately final (no drafts)
- **Orphan entries:** Remain visible if user loses module access

---

## 7. Table Views

### 7.1 Table Columns
All module fields + Added By + Added At + Actions

### 7.2 Actions Column
- **Edit:** Opens edit modal (time-restricted)
- **Delete:** Confirmation dialog, then hard delete

### 7.3 Edit Rules
- Users can only edit their own entries
- **30-minute window** from creation time
- **Lock at modal open:** If user opens modal in time, allow submission even if window expires during editing
- **Concurrency:** Last write wins (no optimistic locking)

### 7.4 Filtering & Search
| Feature | Availability |
|---------|--------------|
| Date range filter | All users |
| Search (all fields) | All users |
| User filter ("Added by") | Only users with "see all" visibility |

### 7.5 Pagination
- **Type:** Traditional pagination (Page 1, 2, 3...)
- **Items per page selector:** Yes
- **URL state:** Filters encoded in URL params (shareable/bookmarkable)

### 7.6 Empty State
Simple message: "No entries yet"

---

## 8. Dashboard

### 8.1 Scope (MVP)
**Summary cards only** - No charts, no tables

### 8.2 Dashboard Cards
- Total quotations (per module category)
- Total conversions
- Average TAT
- Average accuracy
- Claims summary (registered, closed, pending)

### 8.3 Data Rules
- **Visibility:** Always shows all data (not filtered by role visibility)
- **Refresh:** Manual refresh only (not real-time)
- **Export:** Not available in MVP

---

## 9. Notifications

### 9.1 Technology
- **Backend:** Django Channels with Redis channel layer
- **Frontend:** WebSocket connection
- **Scope:** Real-time for notifications only

### 9.2 Notification Events
Admin receives notification when any user adds an entry:
- User name
- Module name
- Timestamp
- Entry summary

### 9.3 UI
- **Bell icon** in header with unread count badge
- **Click:** Opens notification dropdown/panel
- **Live updates** via WebSocket
- **In-app only** (no email notifications)

---

## 10. Audit Logging

### 10.1 Scope
- **Log:** Edits and deletes only
- **Skip:** Views/reads

### 10.2 Audit Record
```python
AuditLog:
  - action (enum: 'edit' | 'delete')
  - entity_type (string: model name)
  - entity_id (integer)
  - user (FK to User)
  - timestamp (auto)
  - old_values (JSON, for edits)
  - new_values (JSON, for edits)
```

---

## 11. UI/UX Standards

### 11.1 Component Library
- **Shadcn/ui** components (Button, Input, Select, Table, Modal, etc.)
- Built on Radix primitives for accessibility

### 11.2 Theme
- **Light mode only**
- Generic placeholder branding ("KPI System")

### 11.3 Loading States
- **Spinner overlay** for data fetching and form submission

### 11.4 Form Validation
- **Inline per field** - Error message below invalid field
- **Validation timing:** On submit

### 11.5 Timestamps
- **Format:** Absolute (e.g., "Jan 7, 2026, 2:30 PM")

### 11.6 Keyboard Shortcuts
- **None** - Mouse/touch only

### 11.7 Delete Confirmation
- **Confirmation dialog** required before all deletes

---

## 12. API Endpoints (Backend)

### 12.1 Authentication
```
POST /api/auth/magic-link/request/    # Request magic link
GET  /api/auth/magic-link/verify/     # Verify token, issue JWT
POST /api/auth/logout/                 # Clear session
POST /api/auth/refresh/                # Refresh access token
GET  /api/auth/user/                   # Get current user
```

### 12.2 Users (Admin)
```
GET    /api/users/                     # List users
POST   /api/users/                     # Create user
GET    /api/users/{id}/                # Get user
PATCH  /api/users/{id}/                # Update user
DELETE /api/users/{id}/                # Delete user
PATCH  /api/users/{id}/activate/       # Activate user
PATCH  /api/users/{id}/deactivate/     # Deactivate user
```

### 12.3 Roles (Admin)
```
GET    /api/roles/                     # List roles
POST   /api/roles/                     # Create role
GET    /api/roles/{id}/                # Get role with permissions
PATCH  /api/roles/{id}/                # Update role
DELETE /api/roles/{id}/                # Delete role
```

### 12.4 Profile
```
GET    /api/profile/                   # Get own profile
PATCH  /api/profile/                   # Update own name
```

### 12.5 Module Entries
```
GET    /api/modules/{module}/entries/           # List entries (filtered)
POST   /api/modules/{module}/entries/           # Create entry
GET    /api/modules/{module}/entries/{id}/      # Get entry
PATCH  /api/modules/{module}/entries/{id}/      # Update entry (time-restricted)
DELETE /api/modules/{module}/entries/{id}/      # Delete entry
```

### 12.6 Dashboard
```
GET    /api/dashboard/summary/         # Get summary cards data
```

### 12.7 Notifications
```
WebSocket /ws/notifications/           # Real-time notification stream
GET       /api/notifications/          # Get notification history
PATCH     /api/notifications/{id}/read/ # Mark as read
```

---

## 13. Database Models (Django)

### 13.1 Core Models
```python
# auth_app/models.py
class CustomUser(AbstractBaseUser, PermissionsMixin):
    email = EmailField(unique=True)
    first_name = CharField(max_length=30, blank=True)
    last_name = CharField(max_length=30, blank=True)
    role = ForeignKey('Role', null=True, on_delete=SET_NULL)
    is_active = BooleanField(default=True)
    is_staff = BooleanField(default=False)
    date_joined = DateTimeField(auto_now_add=True)

class MagicLink(Model):
    user = ForeignKey(CustomUser, on_delete=CASCADE)
    token = CharField(max_length=64, unique=True)
    created_at = DateTimeField(auto_now_add=True)
    expires_at = DateTimeField()
    is_used = BooleanField(default=False)

class Role(Model):
    name = CharField(max_length=100, unique=True)
    description = TextField(blank=True)
    data_visibility = CharField(choices=[('all', 'All'), ('own', 'Own')], default='own')
    created_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)

class RoleModulePermission(Model):
    role = ForeignKey(Role, on_delete=CASCADE, related_name='permissions')
    module = CharField(max_length=50)  # e.g., 'general_new', 'motor_claim'

    class Meta:
        unique_together = ['role', 'module']
```

### 13.2 Module Entry Models
```python
# entries/models.py
class BaseEntry(Model):
    date = DateField()
    added_by = ForeignKey(CustomUser, on_delete=CASCADE)
    added_at = DateTimeField(auto_now_add=True)
    updated_at = DateTimeField(auto_now=True)

    class Meta:
        abstract = True

class GeneralNewEntry(BaseEntry):
    quotations = PositiveIntegerField()
    quotes_revised = PositiveIntegerField()
    quotes_converted = PositiveIntegerField()
    tat = PositiveIntegerField()
    accuracy = DecimalField(max_digits=5, decimal_places=2)

class GeneralRenewalEntry(BaseEntry):
    quotations = PositiveIntegerField()
    quotes_revised = PositiveIntegerField()
    quotes_converted = PositiveIntegerField()
    tat = PositiveIntegerField()
    accuracy = DecimalField(max_digits=5, decimal_places=2)

class MotorNewEntry(BaseEntry):
    quotations = PositiveIntegerField()
    quotes_revised = PositiveIntegerField()
    tat = PositiveIntegerField()
    accuracy = DecimalField(max_digits=5, decimal_places=2)

class MotorRenewalEntry(BaseEntry):
    quotations = PositiveIntegerField()
    retention = PositiveIntegerField()
    tat = PositiveIntegerField()
    accuracy = DecimalField(max_digits=5, decimal_places=2)

class MotorClaimEntry(BaseEntry):
    registered_claims = PositiveIntegerField()
    claims_closed = PositiveIntegerField()
    pending_cases = PositiveIntegerField()
    tat = PositiveIntegerField()
```

### 13.3 Notification & Audit Models
```python
# notifications/models.py
class Notification(Model):
    recipient = ForeignKey(CustomUser, on_delete=CASCADE)
    message = TextField()
    entry_type = CharField(max_length=50)
    entry_id = PositiveIntegerField()
    created_by = ForeignKey(CustomUser, on_delete=CASCADE, related_name='created_notifications')
    created_at = DateTimeField(auto_now_add=True)
    is_read = BooleanField(default=False)

# audit/models.py
class AuditLog(Model):
    action = CharField(choices=[('edit', 'Edit'), ('delete', 'Delete')])
    entity_type = CharField(max_length=100)
    entity_id = PositiveIntegerField()
    user = ForeignKey(CustomUser, on_delete=SET_NULL, null=True)
    timestamp = DateTimeField(auto_now_add=True)
    old_values = JSONField(null=True)
    new_values = JSONField(null=True)
```

---

## 14. Frontend Routes

```
/login                          # Magic link request page
/                               # Redirect to first accessible module
/dashboard                      # Dashboard (summary cards)
/general/new                    # General New module
/general/renewal                # General Renewal module
/general/claim                  # General Claim (Coming Soon)
/motor/new                      # Motor New module
/motor/renewal                  # Motor Renewal module
/motor/claim                    # Motor Claim module
/admin/users                    # User management (admin)
/admin/roles                    # Role management (admin)
/profile                        # User profile settings
```

---

## 15. Implementation Priority

### Phase 1: Authentication
1. Replace password auth with magic link system
2. Implement MagicLink model and token generation
3. Configure SMTP email sending
4. Add "remember me" checkbox with 30-day session
5. Update login page UI
6. Seed super-admin account

### Phase 2: Data Entry Modules
1. Create entry models for all modules
2. Build module page layout with sidebar
3. Implement entry CRUD APIs
4. Build table component with pagination
5. Implement add/edit modals with validation
6. Add 30-minute edit time restriction
7. Implement date/search/user filters
8. URL-encode filter state

### Phase 3: RBAC System
1. Create Role and RoleModulePermission models
2. Build role management UI with tree selection
3. Implement data visibility filtering
4. Build user management CRUD
5. Add permission middleware to APIs
6. Implement sidebar visibility logic

### Phase 4: Notifications & Polish
1. Set up Django Channels with Redis
2. Implement WebSocket notification consumer
3. Build notification bell icon UI
4. Add audit logging for edits/deletes
5. Build basic dashboard with summary cards
6. Add profile page for self-edit
7. Final UI polish with Shadcn/ui

---

## 16. Non-Goals (Out of Scope)

- Password authentication
- Public/unauthenticated access
- Multi-tenant/multi-organization
- Mobile application
- Dark mode
- Keyboard shortcuts
- Complex RBAC hierarchies
- Session history tracking
- Email notifications (beyond magic links)
- CSV/Excel export
- Dashboard charts
- Bulk user actions
- Draft entry status
- Auto-calculated fields (Pending, TAT)
- Soft delete

---

## 17. Security Considerations

1. **Magic links:** Single-use, time-limited, invalidate on new request
2. **JWT tokens:** HTTP-only cookies, secure flag in production
3. **CORS:** Strict allowed origins
4. **CSRF:** Protection enabled
5. **Rate limiting:** Consider for magic link requests (future)
6. **Input validation:** Server-side validation for all fields
7. **SQL injection:** Use Django ORM, avoid raw queries
8. **XSS:** React's built-in escaping + CSP headers
9. **Secrets:** Move to environment variables for production

---

## 18. Environment Variables (Production)

```env
# Django
SECRET_KEY=<secure-random-key>
DEBUG=False
ALLOWED_HOSTS=your-domain.com

# Database
DATABASE_URL=postgres://user:pass@host:5432/dbname

# Email
EMAIL_HOST=smtp.gmail.com
EMAIL_PORT=587
EMAIL_HOST_USER=your-email@gmail.com
EMAIL_HOST_PASSWORD=app-password
EMAIL_USE_TLS=True

# Frontend
NEXT_PUBLIC_API_URL=https://api.your-domain.com
NEXT_PUBLIC_WS_URL=wss://api.your-domain.com/ws

# Redis (for Channels)
REDIS_URL=redis://localhost:6379
```

---

*End of Specification*
