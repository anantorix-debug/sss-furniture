'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import type { Role } from '@/types';

export function RoleGate({
  minRole,
  exact,
  children,
}: {
  minRole: Role | Role[];
  // When true, membership is checked literally against minRole - Super
  // Admin's usual "bypasses every check" does not apply. Use for
  // employee-only pages (e.g. My Work) that are meaningless for Admins.
  exact?: boolean;
  children: React.ReactNode;
}) {
  const { user, hasRole, loading } = useAuth();
  const router = useRouter();
  const roles = Array.isArray(minRole) ? minRole : [minRole];
  const allowed = exact ? !!user && roles.includes(user.role) : hasRole(...roles);

  useEffect(() => {
    if (!loading && !allowed) {
      router.replace('/dashboard');
    }
  }, [loading, allowed, router]);

  if (loading || !allowed) return null;
  return <>{children}</>;
}
