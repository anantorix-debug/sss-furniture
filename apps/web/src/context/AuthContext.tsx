'use client';

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { api, setAccessToken, ApiError } from '@/lib/api';
import type { User, Role } from '@/types';

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  hasRole: (...roles: Role[]) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const router = useRouter();

  const bootstrap = useCallback(async () => {
    try {
      const res = await api.post<{ accessToken: string }>('/auth/refresh');
      setAccessToken(res.accessToken);
      const me = await api.get<User>('/auth/me');
      setUser(me);
    } catch {
      setAccessToken(null);
      setUser(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    bootstrap();
  }, [bootstrap]);

  const login = useCallback(
    async (email: string, password: string) => {
      const res = await api.post<{ accessToken: string; user: User }>('/auth/login', { email, password });
      setAccessToken(res.accessToken);
      setUser(res.user);
      // The Dashboard is a financial overview (order values, balances,
      // supplier totals) with nothing relevant to a production employee -
      // Carpenter/Polisher land on their own workspace instead.
      const isProductionEmployee = res.user.role === 'CARPENTER' || res.user.role === 'POLISHER';
      router.push(isProductionEmployee ? '/carpenters' : '/dashboard');
    },
    [router],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      // ignore
    }
    setAccessToken(null);
    setUser(null);
    router.push('/login');
  }, [router]);

  // Mirrors the backend RolesGuard exactly: SUPERADMIN has full system
  // access and bypasses every check; every other role must be explicitly
  // listed - Carpenter and Polisher are peers, not a ladder.
  const hasRole = useCallback(
    (...roles: Role[]) => {
      if (!user) return false;
      if (user.role === 'SUPERADMIN') return true;
      return roles.includes(user.role);
    },
    [user],
  );

  return <AuthContext.Provider value={{ user, loading, login, logout, hasRole }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

export { ApiError };
