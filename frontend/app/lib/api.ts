const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export interface ApiResponse<T> {
  data?: T;
  error?: string;
}

async function fetchApi<T>(
  endpoint: string,
  options: RequestInit = {}
): Promise<ApiResponse<T>> {
  const url = `${API_BASE_URL}${endpoint}`;

  const defaultOptions: RequestInit = {
    credentials: 'include', // Send cookies with every request
    headers: {
      'Content-Type': 'application/json',
      ...options.headers,
    },
  };

  try {
    const response = await fetch(url, { ...defaultOptions, ...options });

    // Handle 401 - try to refresh token
    if (response.status === 401 && !endpoint.includes('/refresh')) {
      const refreshed = await refreshAccessToken();
      if (refreshed) {
        // Retry the original request
        const retryResponse = await fetch(url, { ...defaultOptions, ...options });
        if (retryResponse.ok) {
          const data = await retryResponse.json();
          return { data };
        }
      }
      return { error: 'Session expired. Please login again.' };
    }

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      return { error: errorData.error || `Request failed with status ${response.status}` };
    }

    if (response.status === 204) {
      return { data: undefined as unknown as T };
    }
    const data = await response.json();
    return { data };
  } catch (error) {
    return { error: error instanceof Error ? error.message : 'Network error' };
  }
}

async function refreshAccessToken(): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/refresh/`, {
      method: 'POST',
      credentials: 'include',
      headers: {
        'Content-Type': 'application/json',
      },
    });
    return response.ok;
  } catch {
    return false;
  }
}

// Types
export interface Role {
  id: number;
  name: string;
  data_visibility: 'all' | 'own';
  is_hod: boolean;
  module_permissions: string[];
}

export interface RoleFull {
  id: number;
  name: string;
  description: string;
  data_visibility: 'all' | 'own';
  is_hod: boolean;
  permissions: { module: string }[];
  user_count: number;
  created_at: string;
  updated_at: string;
}

export interface User {
  id: number;
  email: string;
  full_name: string;
  date_joined: string;
  is_staff: boolean;
  is_active: boolean;
  role?: Role;
}

export interface UserAdmin {
  id: number;
  email: string;
  full_name: string;
  is_staff: boolean;
  is_active: boolean;
  // TED-477: per-user opt-out for the daily login-reminder email.
  daily_email_enabled: boolean;
  role_id: number | null;
  role_name: string | null;
  date_joined: string;
  last_login: string | null;
}

export interface LoginResponse {
  message: string;
  user: User;
}

export interface MagicLinkResponse {
  message: string;
  error?: string;
  redirect_after?: number;
}

export interface PaginatedResponse<T> {
  count: number;
  next: string | null;
  previous: string | null;
  results: T[];
}

export interface ModuleInfo {
  key: string;
  label: string;
}

// Audit log -------------------------------------------------------------
export interface AuditLogChange {
  old: unknown;
  new: unknown;
}

export interface AuditLog {
  id: number;
  timestamp: string;
  category: string;
  category_label: string;
  model_label: string;
  action: 'create' | 'update' | 'delete';
  action_display: string;
  actor: number | null;
  actor_name: string;
  actor_email: string | null;
  object_label: string;
  content_type: number | null;
  object_id: number | null;
  changes: Record<string, AuditLogChange>;
  ip_address: string | null;
}

export interface AuditLogParams {
  category?: string;
  action?: string;
  actor_id?: string | number;
  date_from?: string;
  date_to?: string;
  search?: string;
  page?: number;
  page_size?: number;
}

// Admin-only audit trail. Defaults (newest-first, all users) live on the
// backend; pass `category` to scope to one Audit sidebar section.
export async function getAuditLogs(
  params: AuditLogParams = {}
): Promise<ApiResponse<PaginatedResponse<AuditLog>>> {
  const qs = new URLSearchParams();
  if (params.category) qs.set('category', params.category);
  if (params.action) qs.set('action', params.action);
  if (params.actor_id) qs.set('actor_id', String(params.actor_id));
  if (params.date_from) qs.set('date_from', params.date_from);
  if (params.date_to) qs.set('date_to', params.date_to);
  if (params.search) qs.set('search', params.search);
  if (params.page) qs.set('page', String(params.page));
  if (params.page_size) qs.set('page_size', String(params.page_size));
  const suffix = qs.toString() ? `?${qs}` : '';
  return fetchApi<PaginatedResponse<AuditLog>>(`/api/audit/logs/${suffix}`);
}

// Magic Link API functions
export async function requestMagicLink(email: string): Promise<ApiResponse<MagicLinkResponse>> {
  return fetchApi<MagicLinkResponse>('/api/auth/magic-link/request/', {
    method: 'POST',
    body: JSON.stringify({ email }),
  });
}

export async function verifyMagicLink(
  token: string,
  rememberMe: boolean
): Promise<ApiResponse<LoginResponse>> {
  // POST so corp inbox link-scanners (which only do GET) can't consume the
  // token before the user clicks "Sign in" on the verify page.
  return fetchApi<LoginResponse>('/api/auth/magic-link/verify/', {
    method: 'POST',
    body: JSON.stringify({ token, remember_me: rememberMe }),
  });
}

export async function logout(): Promise<ApiResponse<{ message: string }>> {
  return fetchApi<{ message: string }>('/api/auth/logout/', {
    method: 'POST',
  });
}

export async function getCurrentUser(): Promise<ApiResponse<User>> {
  return fetchApi<User>('/api/auth/user/');
}

// Admin - Users API
export async function getUsers(params?: URLSearchParams): Promise<ApiResponse<PaginatedResponse<UserAdmin>>> {
  const query = params ? `?${params.toString()}` : '';
  return fetchApi<PaginatedResponse<UserAdmin>>(`/api/auth/users/${query}`);
}

export async function createUser(userData: Partial<UserAdmin>): Promise<ApiResponse<UserAdmin>> {
  return fetchApi<UserAdmin>('/api/auth/users/', {
    method: 'POST',
    body: JSON.stringify(userData),
  });
}

export async function updateUser(id: number, userData: Partial<UserAdmin>): Promise<ApiResponse<UserAdmin>> {
  return fetchApi<UserAdmin>(`/api/auth/users/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(userData),
  });
}

export async function deleteUser(id: number): Promise<ApiResponse<void>> {
  return fetchApi<void>(`/api/auth/users/${id}/`, {
    method: 'DELETE',
  });
}

export async function activateUser(id: number): Promise<ApiResponse<{ message: string }>> {
  return fetchApi<{ message: string }>(`/api/auth/users/${id}/activate/`, {
    method: 'POST',
  });
}

export async function deactivateUser(id: number): Promise<ApiResponse<{ message: string }>> {
  return fetchApi<{ message: string }>(`/api/auth/users/${id}/deactivate/`, {
    method: 'POST',
  });
}

// Admin - Roles API
export async function getRoles(params?: URLSearchParams): Promise<ApiResponse<PaginatedResponse<RoleFull>>> {
  const query = params ? `?${params.toString()}` : '';
  return fetchApi<PaginatedResponse<RoleFull>>(`/api/roles/${query}`);
}

export async function getRolesSimple(): Promise<ApiResponse<{ id: number; name: string }[]>> {
  const result = await fetchApi<PaginatedResponse<{ id: number; name: string }>>('/api/roles/?simple=true');
  if (result.data) {
    return { data: result.data.results };
  }
  return { error: result.error };
}

export async function getRole(id: number): Promise<ApiResponse<RoleFull>> {
  return fetchApi<RoleFull>(`/api/roles/${id}/`);
}

export async function createRole(roleData: {
  name: string;
  description?: string;
  data_visibility: 'all' | 'own';
  is_hod?: boolean;
  module_permissions: string[];
}): Promise<ApiResponse<RoleFull>> {
  return fetchApi<RoleFull>('/api/roles/', {
    method: 'POST',
    body: JSON.stringify(roleData),
  });
}

export async function updateRole(
  id: number,
  roleData: {
    name?: string;
    description?: string;
    data_visibility?: 'all' | 'own';
    is_hod?: boolean;
    module_permissions?: string[];
  }
): Promise<ApiResponse<RoleFull>> {
  return fetchApi<RoleFull>(`/api/roles/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(roleData),
  });
}

export async function deleteRole(id: number): Promise<ApiResponse<void>> {
  return fetchApi<void>(`/api/roles/${id}/`, {
    method: 'DELETE',
  });
}

export async function getModules(): Promise<ApiResponse<{ modules: ModuleInfo[] }>> {
  return fetchApi<{ modules: ModuleInfo[] }>('/api/roles/modules/');
}

// Get users for filter dropdown (simple list)
export async function getUsersForFilter(): Promise<ApiResponse<{ id: number; email: string; full_name: string }[]>> {
  const result = await fetchApi<PaginatedResponse<UserAdmin>>('/api/auth/users/?page_size=1000');
  if (result.data) {
    return {
      data: result.data.results.map(u => ({
        id: u.id,
        email: u.email,
        full_name: u.full_name,
      }))
    };
  }
  return { error: result.error };
}

// Get active users who have a specific module permission (for tracker views
// and "load all" use cases). Requests a large page so existing callers keep
// receiving every user in one response. For paginated/searchable dropdown
// usage call getUsersForModulePage instead.
export async function getUsersForModule(
  moduleKey: string
): Promise<ApiResponse<{ id: number; email: string; full_name: string }[]>> {
  const result = await fetchApi<{ results: { id: number; email: string; full_name: string }[] }>(
    `/api/auth/users/module-members/?module=${encodeURIComponent(moduleKey)}&page_size=200`
  );
  if (result.data) {
    return { data: result.data.results };
  }
  return { error: result.error };
}

// Paginated + searchable variant for the SearchableSelect combobox component.
export async function getUsersForModulePage(
  moduleKey: string,
  params: { search?: string; page?: number; page_size?: number } = {}
): Promise<ApiResponse<{
  results: { id: number; email: string; full_name: string }[];
  count: number;
  has_more: boolean;
}>> {
  const qs = new URLSearchParams();
  qs.set('module', moduleKey);
  if (params.search) qs.set('search', params.search);
  if (params.page) qs.set('page', String(params.page));
  if (params.page_size) qs.set('page_size', String(params.page_size));
  return fetchApi<{
    results: { id: number; email: string; full_name: string }[];
    count: number;
    has_more: boolean;
  }>(`/api/auth/users/module-members/?${qs}`);
}

// TED-513: paginated + searchable list of ALL active users, regardless of
// module permission. Same response shape as getUsersForModulePage so
// SearchableSelect pickers can swap between the two without other changes.
export async function getActiveUsersPage(
  params: { search?: string; page?: number; page_size?: number } = {}
): Promise<ApiResponse<{
  results: { id: number; email: string; full_name: string }[];
  count: number;
  has_more: boolean;
}>> {
  const qs = new URLSearchParams();
  if (params.search) qs.set('search', params.search);
  if (params.page) qs.set('page', String(params.page));
  if (params.page_size) qs.set('page_size', String(params.page_size));
  const suffix = qs.toString() ? `?${qs}` : '';
  return fetchApi<{
    results: { id: number; email: string; full_name: string }[];
    count: number;
    has_more: boolean;
  }>(`/api/auth/users/active/${suffix}`);
}

// ─── Motor enquiry (motor_new / motor_renewal / general_new share the same
//     shape — general_new omits chassis_no). ───────────────────────────────

export interface MotorEnquiryEntry {
  id: number;
  pib_id: string;                    // "PIB-N", globally unique across all entry tables
  date: string;                      // YYYY-MM-DD
  client_name: string;
  agent: number;                     // FK id
  agent_name: string;
  // chassis_no is set on the motor variants only — general_new has no chassis.
  chassis_no?: string;
  // Motor New uses 'converted'; Motor Renewal uses 'retained'. Both modules
  // share the same row type; the page's per-module STATUS_CONFIG narrows it.
  status: 'new' | 'converted' | 'retained' | 'lost';
  revisions: number;
  quotes_compared: number;
  status_changed_at: string | null;
  tat_display: string;               // "Xd Yh Zm" or "—"
  accuracy_pct: number | null;       // 100 × 0.9^revisions when terminal; null otherwise
  allowed_transitions: string[];     // possible next statuses
  is_terminal: boolean;
  // Per-module dropdowns added 2026-05-24. DecimalField → string; choice key + display.
  potential_premium?: string | null;
  // TED-440: actual converted premium captured at status-transition time.
  converted_premium?: string | null;
  // Motor variants use class_of_enquiry (comprehensive / tpl).
  class_of_enquiry?: string;
  class_of_enquiry_display?: string;
  // general_new uses class_of_insurance — FK to the admin-managed ClassOfInsurance lookup.
  class_of_insurance?: number | null;
  class_of_insurance_display?: string | null;
  // Insurance Company FK to the admin-managed lookup table.
  insurance_company?: number | null;
  insurance_company_name?: string | null;
  added_by: number;
  added_by_name: string;
  on_behalf_of: number | null;
  on_behalf_of_name: string | null;
  added_at: string;
  updated_at: string;
  is_editable: boolean;
  // Count of EntryRemark rows. Tints the Notes icon indigo when > 0.
  remark_count: number;
  // Index signature required for compatibility with shared BaseModuleEntry-based
  // components (PersonalDailyTracker, TrackerView).
  [key: string]: unknown;
}

export interface MotorEnquiryStats {
  total: number;
  revised: number;
  // Only one of these is non-zero for any given module — `converted` for
  // motor_new, `retained` for motor_renewal. Both are always present in the
  // payload so the frontend reads whichever applies.
  converted: number;
  retained: number;
  lost: number;
  avg_tat_minutes: number | null;
  avg_accuracy: number | null;
  // Premium aggregates (sums of `potential_premium`). converted_premium is
  // the success-status total — populated for whichever of converted/retained
  // applies to the module.
  converted_premium: number;
  lost_premium: number;
  total_potential_premium: number;
}

export interface MotorRenewalMonthlyTarget {
  // When `aggregated` is true, this row is a team total (HOD oversight view);
  // `id` and `user` are null and the row is not editable.
  id: number | null;
  user: number | null;
  year: number;
  month: number;
  calculated_date: string;             // YYYY-MM-DD (first of the month)
  clients_assigned: number | null;
  created_at: string | null;
  updated_at: string | null;
  aggregated?: boolean;
}

export type MotorEnquiryModule =
  | 'motor-new'
  | 'motor-renewal'
  | 'motor-fleet-new'
  | 'motor-fleet-renewal'
  | 'general-new';  // general_new shares the per-enquiry shape (minus chassis_no)

// Renewal-style modules that have monthly retention targets (clients_assigned).
export type MotorRenewalModule = 'motor-renewal' | 'motor-fleet-renewal';

interface StatsParams {
  date_from?: string;
  date_to?: string;
  user_id?: string;
  agent_id?: string;
  status?: string;
}

function buildQS(params: Record<string, string | undefined>) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v) qs.set(k, v);
  }
  return qs.toString();
}

export async function getMotorEnquiryStats(
  module: MotorEnquiryModule,
  params: StatsParams = {}
): Promise<ApiResponse<MotorEnquiryStats>> {
  return fetchApi<MotorEnquiryStats>(`/api/entries/${module}/stats/?${buildQS(params as Record<string, string | undefined>)}`);
}

export async function updateMotorEnquiryStatus(
  module: MotorEnquiryModule,
  id: number,
  // TED-530: the confirmation modal confirms/edits all of these while closing.
  // class_of_enquiry is used by the Motor modules, class_of_insurance by
  // general-new; converted_premium is now saved on every transition incl. Lost.
  payload: {
    status: 'converted' | 'retained' | 'lost';
    revisions?: number;
    quotes_compared?: number;
    class_of_enquiry?: string;
    class_of_insurance?: number | null;
    converted_premium?: string | number;
  }
): Promise<ApiResponse<MotorEnquiryEntry>> {
  return fetchApi<MotorEnquiryEntry>(`/api/entries/${module}/${id}/update-status/`, {
    method: 'PATCH',
    body: JSON.stringify(payload),
  });
}

export async function updateMotorEnquiryRevisions(
  module: MotorEnquiryModule,
  id: number,
  revisions: number
): Promise<ApiResponse<MotorEnquiryEntry>> {
  return fetchApi<MotorEnquiryEntry>(`/api/entries/${module}/${id}/update-revisions/`, {
    method: 'PATCH',
    body: JSON.stringify({ revisions }),
  });
}

// ─── Motor Renewal monthly target (Client Retention) ─────────────────────────
// Shared between motor-renewal and motor-fleet-renewal: both expose an
// identically-shaped `/monthly-targets/` sub-resource. Each call takes the
// module slug so the same functions service both routes.

export async function getCurrentMotorRenewalMonthlyTarget(
  module: MotorRenewalModule,
  // Pass the viewer's own user_id so aggregator viewers (HOD/admin) get their
  // OWN current-month row instead of the default team-aggregated response.
  params: { user_id?: number | string } = {}
): Promise<ApiResponse<MotorRenewalMonthlyTarget | null>> {
  const qs = new URLSearchParams();
  if (params.user_id != null && params.user_id !== '') {
    qs.set('user_id', String(params.user_id));
  }
  const suffix = qs.toString() ? `?${qs}` : '';
  return fetchApi<MotorRenewalMonthlyTarget | null>(
    `/api/entries/${module}/monthly-targets/current/${suffix}`
  );
}

export async function getMotorRenewalMonthlyTargets(
  module: MotorRenewalModule,
  // TED-464: `user_id` scopes an aggregator viewer (HOD/admin) to a single
  // user's per-user rows instead of the default team-summed response.
  params: { year: number; month?: number; user_id?: number | string }
): Promise<ApiResponse<MotorRenewalMonthlyTarget[]>> {
  const qs = new URLSearchParams();
  qs.set('year', String(params.year));
  if (params.month != null) qs.set('month', String(params.month));
  if (params.user_id != null && params.user_id !== '') {
    qs.set('user_id', String(params.user_id));
  }
  const result = await fetchApi<{ results: MotorRenewalMonthlyTarget[] } | MotorRenewalMonthlyTarget[]>(
    `/api/entries/${module}/monthly-targets/?${qs}`
  );
  if (result.data) {
    // DRF returns paginated {results} for list endpoints; unwrap to a flat array.
    const rows = Array.isArray(result.data) ? result.data : result.data.results;
    return { data: rows };
  }
  return { error: result.error };
}

export async function createMotorRenewalMonthlyTarget(
  module: MotorRenewalModule,
  payload: { year: number; month: number; clients_assigned: number }
): Promise<ApiResponse<MotorRenewalMonthlyTarget>> {
  return fetchApi<MotorRenewalMonthlyTarget>(
    `/api/entries/${module}/monthly-targets/`,
    { method: 'POST', body: JSON.stringify(payload) }
  );
}

export async function updateMotorRenewalMonthlyTarget(
  module: MotorRenewalModule,
  id: number,
  payload: { clients_assigned: number }
): Promise<ApiResponse<MotorRenewalMonthlyTarget>> {
  return fetchApi<MotorRenewalMonthlyTarget>(
    `/api/entries/${module}/monthly-targets/${id}/`,
    { method: 'PATCH', body: JSON.stringify(payload) }
  );
}

// ─── General Renewal (per-enquiry, mirrors Motor Renewal sans chassis_no) ────

export interface GeneralRenewalEntry {
  id: number;
  pib_id: string;
  date: string;                      // YYYY-MM-DD
  client_name: string;
  agent: number;                     // FK id
  agent_name: string;
  status: 'new' | 'retained' | 'lost';
  revisions: number;
  quotes_compared: number;
  status_changed_at: string | null;
  tat_display: string;               // "Xd Yh Zm" or "—"
  accuracy_pct: number | null;
  allowed_transitions: string[];
  is_terminal: boolean;
  // Per-module dropdowns added 2026-05-24.
  potential_premium?: string | null;
  // TED-440: actual converted (here: retained) premium captured at status-transition time.
  converted_premium?: string | null;
  // FK to the admin-managed ClassOfInsurance lookup (TED-446 migration 0035).
  class_of_insurance?: number | null;
  class_of_insurance_display?: string | null;
  insurance_company?: number | null;
  insurance_company_name?: string | null;
  added_by: number;
  added_by_name: string;
  on_behalf_of: number | null;
  on_behalf_of_name: string | null;
  added_at: string;
  updated_at: string;
  is_editable: boolean;
  // Count of EntryRemark rows. Tints the Notes icon indigo when > 0.
  remark_count: number;
  // Index signature for compatibility with shared tracker components.
  [key: string]: unknown;
}

export interface GeneralRenewalStats {
  total: number;
  revised: number;
  converted: number;                 // always 0 for general_renewal
  retained: number;
  lost: number;
  avg_tat_minutes: number | null;
  avg_accuracy: number | null;
  // Premium aggregates (sums of `potential_premium`).
  converted_premium: number;
  lost_premium: number;
  total_potential_premium: number;
}

export interface GeneralRenewalMonthlyTarget {
  // When `aggregated` is true, this row is a team total (HOD oversight view);
  // `id` and `user` are null and the row is not editable.
  id: number | null;
  user: number | null;
  year: number;
  month: number;
  calculated_date: string;
  clients_assigned: number | null;
  created_at: string | null;
  updated_at: string | null;
  aggregated?: boolean;
}

export async function getGeneralRenewalStats(
  params: StatsParams = {}
): Promise<ApiResponse<GeneralRenewalStats>> {
  return fetchApi<GeneralRenewalStats>(
    `/api/entries/general-renewal/stats/?${buildQS(params as Record<string, string | undefined>)}`
  );
}

export async function updateGeneralRenewalStatus(
  id: number,
  // TED-530: the confirmation modal confirms/edits all of these while closing.
  payload: {
    status: 'retained' | 'lost';
    revisions?: number;
    quotes_compared?: number;
    class_of_insurance?: number | null;
    converted_premium?: string | number;
  }
): Promise<ApiResponse<GeneralRenewalEntry>> {
  return fetchApi<GeneralRenewalEntry>(
    `/api/entries/general-renewal/${id}/update-status/`,
    { method: 'PATCH', body: JSON.stringify(payload) }
  );
}

export async function updateGeneralRenewalRevisions(
  id: number,
  revisions: number
): Promise<ApiResponse<GeneralRenewalEntry>> {
  return fetchApi<GeneralRenewalEntry>(
    `/api/entries/general-renewal/${id}/update-revisions/`,
    { method: 'PATCH', body: JSON.stringify({ revisions }) }
  );
}

export async function getCurrentGeneralRenewalMonthlyTarget(
  // Pass the viewer's own user_id so aggregator viewers (HOD/admin) get their
  // OWN current-month row instead of the default team-aggregated response.
  params: { user_id?: number | string } = {}
): Promise<ApiResponse<GeneralRenewalMonthlyTarget | null>> {
  const qs = new URLSearchParams();
  if (params.user_id != null && params.user_id !== '') {
    qs.set('user_id', String(params.user_id));
  }
  const suffix = qs.toString() ? `?${qs}` : '';
  return fetchApi<GeneralRenewalMonthlyTarget | null>(
    `/api/entries/general-renewal/monthly-targets/current/${suffix}`
  );
}

export async function getGeneralRenewalMonthlyTargets(params: {
  year: number;
  month?: number;
  // TED-464: `user_id` scopes an aggregator viewer (HOD/admin) to a single
  // user's per-user rows instead of the default team-summed response.
  user_id?: number | string;
}): Promise<ApiResponse<GeneralRenewalMonthlyTarget[]>> {
  const qs = new URLSearchParams();
  qs.set('year', String(params.year));
  if (params.month != null) qs.set('month', String(params.month));
  if (params.user_id != null && params.user_id !== '') {
    qs.set('user_id', String(params.user_id));
  }
  const result = await fetchApi<{ results: GeneralRenewalMonthlyTarget[] } | GeneralRenewalMonthlyTarget[]>(
    `/api/entries/general-renewal/monthly-targets/?${qs}`
  );
  if (result.data) {
    const rows = Array.isArray(result.data) ? result.data : result.data.results;
    return { data: rows };
  }
  return { error: result.error };
}

export async function createGeneralRenewalMonthlyTarget(payload: {
  year: number;
  month: number;
  clients_assigned: number;
}): Promise<ApiResponse<GeneralRenewalMonthlyTarget>> {
  return fetchApi<GeneralRenewalMonthlyTarget>(
    '/api/entries/general-renewal/monthly-targets/',
    { method: 'POST', body: JSON.stringify(payload) }
  );
}

export async function updateGeneralRenewalMonthlyTarget(
  id: number,
  payload: { clients_assigned: number }
): Promise<ApiResponse<GeneralRenewalMonthlyTarget>> {
  return fetchApi<GeneralRenewalMonthlyTarget>(
    `/api/entries/general-renewal/monthly-targets/${id}/`,
    { method: 'PATCH', body: JSON.stringify(payload) }
  );
}

// ─── Motor Claim (revamped: client_name + lookup FKs + 8 new fields) ─────────

export interface MotorClaimEntry {
  id: number;
  pib_id: string;                    // "PIB-N", globally unique across all entry tables
  date: string;
  client_name: string;
  vehicle_number: string;
  claim_number: string;
  source: number;
  source_name: string;
  type_of_accident: number;
  type_of_accident_name: string;
  insurance_company: number;
  insurance_company_name: string;
  next_call_date: string | null;
  garage_name: string;
  garage_number: string;
  status: 'claims_opened' | 'claims_in_progress' | 'claims_resolved' | 'claims_rejected';
  added_by: number;
  added_by_name: string;
  on_behalf_of: number | null;
  on_behalf_of_name: string | null;
  added_at: string;
  updated_at: string;
  is_editable: boolean;
  tat_display: string;
  allowed_transitions: string[];
  is_terminal: boolean;
  // Count of EntryRemark rows. Tints the Notes icon indigo when > 0.
  remark_count: number;
  // Index signature for compatibility with shared BaseModuleEntry-based
  // components (PersonalDailyTracker, TrackerView).
  [key: string]: unknown;
}

export interface MotorClaimStats {
  // Overview aggregates
  claims_opened: number;   // total rows
  claims_pending: number;  // status in (opened, in_progress)
  claims_closed: number;   // status in (resolved, rejected)
  // Breakdown — single-status current counts
  claims_in_progress: number;
  claims_resolved: number;
  claims_rejected: number;
}

// ─── Settings: lookup tables (Type of Accident + Insurance Company) ──────────

export interface SettingsLookup {
  id: number;
  name: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export type AccidentType = SettingsLookup;
export type InsuranceCompany = SettingsLookup;
export type ClassOfInsurance = SettingsLookup;

type LookupResource = 'accident-types' | 'insurance-companies' | 'class-of-insurance';

async function _listLookup(
  resource: LookupResource,
  params: { is_active?: boolean } = {}
): Promise<ApiResponse<SettingsLookup[]>> {
  const qs = new URLSearchParams();
  if (params.is_active != null) qs.set('is_active', String(params.is_active));
  qs.set('page_size', '200');
  const result = await fetchApi<
    { results: SettingsLookup[] } | SettingsLookup[]
  >(`/api/entries/settings/${resource}/?${qs}`);
  if (result.data) {
    const rows = Array.isArray(result.data) ? result.data : result.data.results;
    return { data: rows };
  }
  return { error: result.error };
}

export const getAccidentTypes = (params?: { is_active?: boolean }) =>
  _listLookup('accident-types', params);

export const getInsuranceCompanies = (params?: { is_active?: boolean }) =>
  _listLookup('insurance-companies', params);

export const getClassOfInsurance = (params?: { is_active?: boolean }) =>
  _listLookup('class-of-insurance', params);

// Paginated + searchable variants for SearchableSelect dropdowns.
async function _listLookupPage(
  resource: LookupResource,
  params: { search?: string; page?: number; page_size?: number; is_active?: boolean } = {}
): Promise<ApiResponse<{ results: SettingsLookup[]; count: number; has_more: boolean }>> {
  const qs = new URLSearchParams();
  qs.set('is_active', String(params.is_active ?? true));
  if (params.search) qs.set('search', params.search);
  qs.set('page', String(params.page ?? 1));
  qs.set('page_size', String(params.page_size ?? 20));
  const result = await fetchApi<{ results: SettingsLookup[]; count: number; next: string | null }>(
    `/api/entries/settings/${resource}/?${qs}`
  );
  if (result.data) {
    return {
      data: {
        results: result.data.results,
        count: result.data.count,
        has_more: !!result.data.next,
      },
    };
  }
  return { error: result.error };
}

export const getAccidentTypesPage = (
  params: { search?: string; page?: number; page_size?: number; is_active?: boolean } = {}
) => _listLookupPage('accident-types', params);

export const getInsuranceCompaniesPage = (
  params: { search?: string; page?: number; page_size?: number; is_active?: boolean } = {}
) => _listLookupPage('insurance-companies', params);

export const getClassOfInsurancePage = (
  params: { search?: string; page?: number; page_size?: number; is_active?: boolean } = {}
) => _listLookupPage('class-of-insurance', params);

export async function createClassOfInsurance(
  name: string,
): Promise<ApiResponse<ClassOfInsurance>> {
  return fetchApi<ClassOfInsurance>('/api/entries/settings/class-of-insurance/', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function updateClassOfInsurance(
  id: number,
  data: { name?: string; is_active?: boolean },
): Promise<ApiResponse<ClassOfInsurance>> {
  return fetchApi<ClassOfInsurance>(
    `/api/entries/settings/class-of-insurance/${id}/`,
    { method: 'PATCH', body: JSON.stringify(data) },
  );
}

export async function createAccidentType(
  name: string
): Promise<ApiResponse<AccidentType>> {
  return fetchApi<AccidentType>('/api/entries/settings/accident-types/', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function updateAccidentType(
  id: number,
  data: { name?: string; is_active?: boolean }
): Promise<ApiResponse<AccidentType>> {
  return fetchApi<AccidentType>(`/api/entries/settings/accident-types/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify(data),
  });
}

export async function createInsuranceCompany(
  name: string
): Promise<ApiResponse<InsuranceCompany>> {
  return fetchApi<InsuranceCompany>('/api/entries/settings/insurance-companies/', {
    method: 'POST',
    body: JSON.stringify({ name }),
  });
}

export async function updateInsuranceCompany(
  id: number,
  data: { name?: string; is_active?: boolean }
): Promise<ApiResponse<InsuranceCompany>> {
  return fetchApi<InsuranceCompany>(
    `/api/entries/settings/insurance-companies/${id}/`,
    { method: 'PATCH', body: JSON.stringify(data) }
  );
}

export async function getMotorClaimStats(params: {
  date_from?: string;
  date_to?: string;
  user_id?: string;
}): Promise<ApiResponse<MotorClaimStats>> {
  const qs = new URLSearchParams();
  if (params.date_from) qs.set('date_from', params.date_from);
  if (params.date_to) qs.set('date_to', params.date_to);
  if (params.user_id) qs.set('user_id', params.user_id);
  return fetchApi<MotorClaimStats>(`/api/entries/motor-claim/stats/?${qs}`);
}

export async function updateMotorClaimStatus(
  id: number,
  status: MotorClaimEntry['status']
): Promise<ApiResponse<MotorClaimEntry>> {
  return fetchApi<MotorClaimEntry>(`/api/entries/motor-claim/${id}/update-status/`, {
    method: 'PATCH',
    body: JSON.stringify({ status }),
  });
}

// Inline edit for next_call_date — bypasses the 30-min edit window.
// Pass an empty string or null to clear the date.
export async function updateMotorClaimNextCallDate(
  id: number,
  next_call_date: string | null
): Promise<ApiResponse<MotorClaimEntry>> {
  return fetchApi<MotorClaimEntry>(`/api/entries/motor-claim/${id}/update-next-call-date/`, {
    method: 'PATCH',
    body: JSON.stringify({ next_call_date: next_call_date || null }),
  });
}

// ─── Sales KPI (per-ticket revamp, TED-446) ──────────────────────────────────

// TED-533: the single 'in_progress' stage was split into 'awaiting_quote' and
// 'shared_with_client'. The three non-terminal stages are freely interchangeable.
export type SalesKPIStatus =
  | 'lead'
  | 'awaiting_quote'
  | 'shared_with_client'
  | 'won'
  | 'lost';
export type SalesKPIEntryType = 'new' | 'renewal';

export interface SalesKPIStatusTransition {
  id: number;
  from_status: SalesKPIStatus | '';
  to_status: SalesKPIStatus;
  changed_at: string;             // ISO
  changed_by: number;
  changed_by_name: string;
}

export interface SalesKPIEntry {
  id: number;
  pib_id: string;
  date: string;                          // YYYY-MM-DD
  customer_name: string;
  entry_type: SalesKPIEntryType;
  entry_type_display: string;
  class_of_insurance: number;            // FK id
  class_of_insurance_name: string;
  assignee: number;                      // FK id (user)
  assignee_name: string;
  potential_premium: string | null;      // DecimalField → string
  status: SalesKPIStatus;
  status_display: string;
  status_changed_at: string | null;
  // Workflow flags captured when the deal closes. TED-533: forced to true on
  // 'won' (not asked); supplied by the user on 'lost'.
  sent_for_quote: boolean | null;
  quote_received: boolean | null;
  submitted_to_client: boolean | null;
  // Captured on 'won' (required) and optionally on 'lost' (TED-533).
  converted_premium: string | null;
  allowed_transitions: SalesKPIStatus[];
  is_terminal: boolean;
  // Optional initial remark (write-only on create; not returned on subsequent reads).
  initial_remark?: string;
  added_by: number;
  added_by_name: string;
  on_behalf_of: number | null;
  on_behalf_of_name: string | null;
  added_at: string;
  updated_at: string;
  is_editable: boolean;
  // Count of EntryRemark rows. Tints the Notes icon indigo when > 0.
  remark_count: number;
  // Index signature for compatibility with shared tracker components.
  [key: string]: unknown;
}

export interface SalesKPIStats {
  total: number;
  lead: number;
  // TED-540: the two non-terminal sub-stages, each shown as its own card.
  awaiting_quote: number;
  shared_with_client: number;
  // Rollup of the two stages above (awaiting_quote + shared_with_client).
  in_progress: number;
  won: number;
  lost: number;
  // TED-494: won deals where entry_type === 'new'.
  new_clients_acquired: number;
  potential_premium_total: number;
  converted_premium_total: number;
}

export async function getSalesKPIStats(params: {
  date_from?: string;
  date_to?: string;
  user_id?: string;
  assignee?: string;
  status?: string;
} = {}): Promise<ApiResponse<SalesKPIStats>> {
  return fetchApi<SalesKPIStats>(
    `/api/entries/sales-kpi/stats/?${buildQS(params as Record<string, string | undefined>)}`,
  );
}

// Payload mirrors the backend SalesKPIStatusUpdateSerializer (TED-533).
// Non-terminal moves send only `status`. 'won' sends `converted_premium`
// (required; the three booleans are forced true server-side). 'lost' sends the
// three booleans plus an optional `converted_premium`.
export interface SalesKPIStatusUpdatePayload {
  status: SalesKPIStatus;
  sent_for_quote?: boolean;
  quote_received?: boolean;
  submitted_to_client?: boolean;
  converted_premium?: string | number;
}

export async function updateSalesKPIStatus(
  id: number,
  payload: SalesKPIStatusUpdatePayload,
): Promise<ApiResponse<SalesKPIEntry>> {
  return fetchApi<SalesKPIEntry>(
    `/api/entries/sales-kpi/${id}/update-status/`,
    { method: 'PATCH', body: JSON.stringify(payload) },
  );
}

// Edit converted_premium on a Won deal after it's terminal (creator-only).
export async function updateSalesKPIConvertedPremium(
  id: number,
  converted_premium: string | number,
): Promise<ApiResponse<SalesKPIEntry>> {
  return fetchApi<SalesKPIEntry>(
    `/api/entries/sales-kpi/${id}/update-converted-premium/`,
    { method: 'PATCH', body: JSON.stringify({ converted_premium }) },
  );
}

// AI Chat
export interface AiChatResponse {
  success: boolean;
  summary?: string;
  sql?: string | null;
  columns?: string[] | null;
  data?: (string | number | null)[][] | null;
  total_rows?: number;
  error?: string;
}

export async function askAiChat(question: string): Promise<ApiResponse<AiChatResponse>> {
  return fetchApi<AiChatResponse>('/api/ai-chat/ask/', {
    method: 'POST',
    body: JSON.stringify({ question }),
  });
}

// ─── Per-entry comments (EntryRemark, cross-module via GenericFK) ────────────

export interface EntryRemark {
  id: number;
  content_type: number;
  object_id: number;
  text: string;
  author: number;
  author_name: string;
  can_edit: boolean;
  can_delete: boolean;
  created_at: string;   // ISO
  updated_at: string;
}

export async function listRemarks(
  contentType: number,
  objectId: number
): Promise<ApiResponse<PaginatedResponse<EntryRemark>>> {
  return fetchApi<PaginatedResponse<EntryRemark>>(
    `/api/entries/remarks/?content_type=${contentType}&object_id=${objectId}`
  );
}

export async function createRemark(
  contentType: number,
  objectId: number,
  text: string
): Promise<ApiResponse<EntryRemark>> {
  return fetchApi<EntryRemark>('/api/entries/remarks/', {
    method: 'POST',
    body: JSON.stringify({ content_type: contentType, object_id: objectId, text }),
  });
}

export async function updateRemark(
  id: number,
  text: string
): Promise<ApiResponse<EntryRemark>> {
  return fetchApi<EntryRemark>(`/api/entries/remarks/${id}/`, {
    method: 'PATCH',
    body: JSON.stringify({ text }),
  });
}

export async function deleteRemark(id: number): Promise<ApiResponse<void>> {
  return fetchApi<void>(`/api/entries/remarks/${id}/`, { method: 'DELETE' });
}

// Map of {modelname: content_type_id} for the 7 modules that support remarks.
// Frontend fetches once on mount and caches it.
export async function getRemarksContentTypes(): Promise<ApiResponse<Record<string, number>>> {
  return fetchApi<Record<string, number>>('/api/entries/remarks-content-types/');
}

// Maps a module's apiSlug (e.g. 'motor-new') to the ContentType.model string
// that the backend uses (e.g. 'motornewentry'). Keep in sync with
// `ALLOWED_REMARK_MODELS` in backend/entries/views.py.
export const REMARKS_MODEL_NAME_BY_API_SLUG: Record<string, string> = {
  'general-new': 'generalnewentry',
  'general-renewal': 'generalrenewalentry',
  'motor-new': 'motornewentry',
  'motor-renewal': 'motorrenewalentry',
  'motor-fleet-new': 'motorfleetnewentry',
  'motor-fleet-renewal': 'motorfleetrenewalentry',
  'motor-claim': 'motorclaimentry',
  'sales-kpi': 'saleskpientry',
};

// Generic fetch helper for other API calls
export { fetchApi, API_BASE_URL };
