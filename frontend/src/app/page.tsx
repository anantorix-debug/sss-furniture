'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';

export default function RootPage() {
  const { user, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    const isProductionEmployee = user.role === 'CARPENTER' || user.role === 'CARVER' || user.role === 'POLISHER';
    router.replace(isProductionEmployee ? '/my-work' : '/dashboard');
  }, [loading, user, router]);

  return null;
}
