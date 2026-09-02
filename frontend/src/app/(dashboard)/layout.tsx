'use client';

import { useEffect, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { Sidebar } from '@/components/Sidebar';
import { Topbar } from '@/components/Topbar';
import { PageLoader } from '@/components/PageLoader';

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [slowLoad, setSlowLoad] = useState(false);

  useEffect(() => {
    if (!loading && !user) {
      router.replace('/login');
    }
  }, [loading, user, router]);

  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!loading) {
      setSlowLoad(false);
      return;
    }
    const timer = setTimeout(() => setSlowLoad(true), 8000);
    return () => clearTimeout(timer);
  }, [loading]);

  if (loading) {
    return (
      <PageLoader
        label={
          slowLoad
            ? "This is taking longer than usual - check that the API server is running, then refresh."
            : 'Signing you in...'
        }
      />
    );
  }

  if (!user) return null;

  return (
    <div className="flex min-h-screen bg-brand-50">
      {sidebarOpen && (
        <div className="fixed inset-0 z-40 bg-black/40 md:hidden" onClick={() => setSidebarOpen(false)} aria-hidden="true" />
      )}

      <div
        className={`fixed inset-y-0 left-0 z-50 h-screen shrink-0 transition-transform duration-200 md:sticky md:top-0 md:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <Sidebar onNavigate={() => setSidebarOpen(false)} />
      </div>

      <div className="flex-1 min-w-0 flex flex-col">
        <div className="sticky top-0 z-20">
          <Topbar onMenuClick={() => setSidebarOpen((v) => !v)} />
        </div>
        <main className="flex-1 min-w-0 p-4 md:p-[22px]">{children}</main>
      </div>
    </div>
  );
}
