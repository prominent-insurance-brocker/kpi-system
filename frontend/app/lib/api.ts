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
  module_permissions: string[];
}

export interface RoleFull {
  id: number;
  name: string;
  description: string;
  data_visibility: 'all' | 'own';
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

// ─── Motor enquiry (motor_new / motor_renewal share the same shape) ──────────

export interface MotorEnquiryEntry {
  id: number;
  pib_id: string;                    // "PIB-N", globally unique across all entry tables
  date: string;                      // YYYY-MM-DD
  client_name: string;
  agent: number;                     // FK id
  agent_name: string;
  chassis_no: string;
  remarks: string;
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
  added_by: number;
  added_by_name: string;
  on_behalf_of: number | null;
  on_behalf_of_name: string | null;
  added_at: string;
  updated_at: string;
  is_editable: boolean;
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
}

export interface MotorRenewalMonthlyTarget {
  id: number;
  user: number;
  year: number;
  month: number;
  calculated_date: string;             // YYYY-MM-DD (first of the month)
  clients_assigned: number | null;
  created_at: string;
  updated_at: string;
}

export type MotorEnquiryModule = 'motor-new' | 'motor-renewal' | 'motor-fleet-new' | 'motor-fleet-renewal';

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
  payload: { status: 'converted' | 'retained' | 'lost'; revisions?: number }
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
  module: MotorRenewalModule
): Promise<ApiResponse<MotorRenewalMonthlyTarget | null>> {
  return fetchApi<MotorRenewalMonthlyTarget | null>(
    `/api/entries/${module}/monthly-targets/current/`
  );
}

export async function getMotorRenewalMonthlyTargets(
  module: MotorRenewalModule,
  params: { year: number; month?: number }
): Promise<ApiResponse<MotorRenewalMonthlyTarget[]>> {
  const qs = new URLSearchParams();
  qs.set('year', String(params.year));
  if (params.month != null) qs.set('month', String(params.month));
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
  remarks: string;
  status: 'new' | 'retained' | 'lost';
  revisions: number;
  quotes_compared: number;
  status_changed_at: string | null;
  tat_display: string;               // "Xd Yh Zm" or "—"
  accuracy_pct: number | null;
  allowed_transitions: string[];
  is_terminal: boolean;
  added_by: number;
  added_by_name: string;
  on_behalf_of: number | null;
  on_behalf_of_name: string | null;
  added_at: string;
  updated_at: string;
  is_editable: boolean;
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
}

export interface GeneralRenewalMonthlyTarget {
  id: number;
  user: number;
  year: number;
  month: number;
  calculated_date: string;
  clients_assigned: number | null;
  created_at: string;
  updated_at: string;
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
  payload: { status: 'retained' | 'lost'; revisions?: number }
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

export async function getCurrentGeneralRenewalMonthlyTarget(): Promise<
  ApiResponse<GeneralRenewalMonthlyTarget | null>
> {
  return fetchApi<GeneralRenewalMonthlyTarget | null>(
    '/api/entries/general-renewal/monthly-targets/current/'
  );
}

export async function getGeneralRenewalMonthlyTargets(params: {
  year: number;
  month?: number;
}): Promise<ApiResponse<GeneralRenewalMonthlyTarget[]>> {
  const qs = new URLSearchParams();
  qs.set('year', String(params.year));
  if (params.month != null) qs.set('month', String(params.month));
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
  // Index signature for compatibility with shared BaseModuleEntry-based
  // components (PersonalDailyTracker, TrackerView).
  [key: string]: unknown;
}

export interface MotorClaimStats {
  claims_opened: number;
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

async function _listLookup(
  resource: 'accident-types' | 'insurance-companies',
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

// Paginated + searchable variants for SearchableSelect dropdowns.
async function _listLookupPage(
  resource: 'accident-types' | 'insurance-companies',
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

// Generic fetch helper for other API calls
export { fetchApi, API_BASE_URL };
