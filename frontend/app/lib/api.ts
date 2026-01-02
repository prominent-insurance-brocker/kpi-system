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

// Auth API functions
export interface User {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  date_joined: string;
}

export interface LoginResponse {
  message: string;
  user: User;
}

export async function login(email: string, password: string): Promise<ApiResponse<LoginResponse>> {
  return fetchApi<LoginResponse>('/api/auth/login/', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
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
