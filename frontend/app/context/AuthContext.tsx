'use client';

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
import {
  User,
  getCurrentUser,
  requestMagicLink as apiRequestMagicLink,
  verifyMagicLink as apiVerifyMagicLink,
  logout as apiLogout,
} from '../lib/api';

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  requestMagicLink: (email: string) => Promise<{ success: boolean; error?: string }>;
  verifyMagicLink: (token: string, rememberMe: boolean) => Promise<{ success: boolean; error?: string }>;
  logout: () => Promise<void>;
  checkAuth: () => Promise<void>;
  hasModulePermission: (moduleKey: string) => boolean;
  canSeeAllData: () => boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  const checkAuth = useCallback(async () => {
    setIsLoading(true);
    const response = await getCurrentUser();
    if (response.data) {
      setUser(response.data);
    } else {
      setUser(null);
    }
    setIsLoading(false);
  }, []);

  useEffect(() => {
    checkAuth();
  }, [checkAuth]);

  const requestMagicLink = async (email: string) => {
    const response = await apiRequestMagicLink(email);
    if (response.error) {
      return { success: false, error: response.error };
    }
    return { success: true };
  };

  const verifyMagicLink = async (token: string, rememberMe: boolean) => {
    const response = await apiVerifyMagicLink(token, rememberMe);
    if (response.data) {
      setUser(response.data.user);
      return { success: true };
    }
    return { success: false, error: response.error };
  };

  const logout = async () => {
    await apiLogout();
    setUser(null);
  };

  const hasModulePermission = (moduleKey: string): boolean => {
    if (!user) return false;
    // Super admin has access to everything
    if (user.is_staff) return true;
    // Check role permissions
    if (!user.role) return false;
    return user.role.module_permissions.includes(moduleKey);
  };

  const canSeeAllData = (): boolean => {
    if (!user) return false;
    // Super admin can see all data
    if (user.is_staff) return true;
    // Check role data visibility
    return user.role?.data_visibility === 'all';
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAuthenticated: !!user,
        requestMagicLink,
        verifyMagicLink,
        logout,
        checkAuth,
        hasModulePermission,
        canSeeAllData,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
}
