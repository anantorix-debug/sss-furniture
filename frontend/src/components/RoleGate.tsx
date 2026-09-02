'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import type { Role } from '@/types';

export function RoleGate({ minRole, children }: { minRole: Role; children: React.ReactNode }) {
  const { hasRole, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading && !hasRole(minRole)) {
      router.replace('/dashboard');
    }
  }, [loading, hasRole, minRole, router]);

  if (loading || !hasRole(minRole)) return null;
  return <>{children}</>;
}
