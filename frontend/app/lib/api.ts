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
  first_name: string;
  last_name: string;
  date_joined: string;
  is_staff: boolean;
  is_active: boolean;
  role?: Role;
}

export interface UserAdmin {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
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
  const params = new URLSearchParams({
    token,
    remember_me: rememberMe.toString(),
  });
  return fetchApi<LoginResponse>(`/api/auth/magic-link/verify/?${params}`, {
    method: 'GET',
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
export async function getUsersForFilter(): Promise<ApiResponse<{ id: number; email: string; first_name: string; last_name: string }[]>> {
  const result = await fetchApi<PaginatedResponse<UserAdmin>>('/api/auth/users/?page_size=1000');
  if (result.data) {
    return {
      data: result.data.results.map(u => ({
        id: u.id,
        email: u.email,
        first_name: u.first_name,
        last_name: u.last_name,
      }))
    };
  }
  return { error: result.error };
}

// Generic fetch helper for other API calls
export { fetchApi, API_BASE_URL };
