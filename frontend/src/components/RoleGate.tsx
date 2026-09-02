'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import type { Role } from '@/types';

export function RoleGate({ minRole, children }: { minRole: Role | Role[]; children: React.ReactNode }) {
  const { hasRole, loading } = useAuth();
  const router = useRouter();
  const roles = Array.isArray(minRole) ? minRole : [minRole];
  const allowed = hasRole(...roles);

  useEffect(() => {
    if (!loading && !allowed) {
      router.replace('/dashboard');
    }
  }, [loading, allowed, router]);

  if (loading || !allowed) return null;
  return <>{children}</>;
}
