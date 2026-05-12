const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

interface ApiResponse<T> {
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

// Get active users who have a specific module permission (for tracker views)
export async function getUsersForModule(
  moduleKey: string
): Promise<ApiResponse<{ id: number; email: string; full_name: string }[]>> {
  const result = await fetchApi<PaginatedResponse<UserAdmin>>(
    `/api/auth/users/?module=${encodeURIComponent(moduleKey)}&is_active=true&page_size=1000`
  );
  if (result.data) {
    return {
      data: result.data.results.map(u => ({
        id: u.id,
        email: u.email,
        full_name: u.full_name,
      })),
    };
  }
  return { error: result.error };
}

// ─── Motor enquiry (motor_new / motor_renewal share the same shape) ──────────

export interface MotorEnquiryEntry {
  id: number;
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

export type MotorEnquiryModule = 'motor-new' | 'motor-renewal';

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

export async function getCurrentMotorRenewalMonthlyTarget(): Promise<
  ApiResponse<MotorRenewalMonthlyTarget | null>
> {
  return fetchApi<MotorRenewalMonthlyTarget | null>(
    '/api/entries/motor-renewal/monthly-targets/current/'
  );
}

export async function getMotorRenewalMonthlyTargets(params: {
  year: number;
  month?: number;
}): Promise<ApiResponse<MotorRenewalMonthlyTarget[]>> {
  const qs = new URLSearchParams();
  qs.set('year', String(params.year));
  if (params.month != null) qs.set('month', String(params.month));
  const result = await fetchApi<{ results: MotorRenewalMonthlyTarget[] } | MotorRenewalMonthlyTarget[]>(
    `/api/entries/motor-renewal/monthly-targets/?${qs}`
  );
  if (result.data) {
    // DRF returns paginated {results} for list endpoints; unwrap to a flat array.
    const rows = Array.isArray(result.data) ? result.data : result.data.results;
    return { data: rows };
  }
  return { error: result.error };
}

export async function createMotorRenewalMonthlyTarget(payload: {
  year: number;
  month: number;
  clients_assigned: number;
}): Promise<ApiResponse<MotorRenewalMonthlyTarget>> {
  return fetchApi<MotorRenewalMonthlyTarget>(
    '/api/entries/motor-renewal/monthly-targets/',
    { method: 'POST', body: JSON.stringify(payload) }
  );
}

export async function updateMotorRenewalMonthlyTarget(
  id: number,
  payload: { clients_assigned: number }
): Promise<ApiResponse<MotorRenewalMonthlyTarget>> {
  return fetchApi<MotorRenewalMonthlyTarget>(
    `/api/entries/motor-renewal/monthly-targets/${id}/`,
    { method: 'PATCH', body: JSON.stringify(payload) }
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

// Generic fetch helper for other API calls
export { fetchApi, API_BASE_URL };
