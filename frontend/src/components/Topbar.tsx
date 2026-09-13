'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import { NotificationBell } from './NotificationBell';
import type { Role } from '@/types';

const TITLES: Record<string, { title: string; crumb: string }> = {
  '/dashboard': { title: 'Dashboard', crumb: 'Dashboard' },
  '/customer-orders': { title: 'Customer Orders', crumb: 'Sales › Customer Orders' },
  '/party-orders': { title: 'Party Orders', crumb: 'Sales › Party Orders' },
  '/inventory': { title: 'Inventory', crumb: 'Inventory' },
  '/suppliers': { title: 'Purchasing', crumb: 'Purchasing › Suppliers' },
  '/purchase-orders': { title: 'Purchasing', crumb: 'Purchasing › Purchase Orders' },
  '/carpenters': { title: 'Production', crumb: 'Production › Carpenter Work' },
  '/payments': { title: 'Payments', crumb: 'Payments' },
  '/expenses': { title: 'Expenses', crumb: 'Expenses' },
  '/reports': { title: 'Reports', crumb: 'Reports' },
  '/users': { title: 'Users', crumb: 'Users & Roles › Users' },
  '/audit-log': { title: 'Audit Log', crumb: 'Users & Roles › Audit Log' },
  '/settings/whatsapp': { title: 'Settings', crumb: 'Settings › WhatsApp' },
  '/profile': { title: 'My Profile', crumb: 'My Profile & Security' },
  '/track': { title: 'Track', crumb: 'Search by Model No' },
};

const ROLE_LABEL: Record<Role, string> = {
  SUPERADMIN: 'Super Admin',
  ADMIN: 'Admin',
  CARPENTER: 'Carpenter Team',
  CARVER: 'Carving Team',
  POLISHER: 'Polish Team',
};

export function Topbar({ onMenuClick }: { onMenuClick?: () => void }) {
  const { user } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [search, setSearch] = useState('');

  const entry =
    TITLES[pathname ?? ''] ??
    Object.entries(TITLES).find(([key]) => pathname?.startsWith(key))?.[1] ??
    { title: 'SSS Company', crumb: '' };

  if (!user) return null;

  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  function handleSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = search.trim();
    if (!q) return;
    router.push(`/track/${encodeURIComponent(q)}`);
  }

  return (
    <header className="h-16 bg-white border-b border-brand-200 flex items-center gap-2 sm:gap-4 px-3 sm:px-6 shrink-0">
      <button
        onClick={onMenuClick}
        className="md:hidden h-9 w-9 shrink-0 rounded-[7px] border border-brand-200 bg-brand-50 flex items-center justify-center text-ink text-base"
        aria-label="Open menu"
      >
        ☰
      </button>

      <div className="hidden lg:block shrink-0 min-w-0">
        <p className="font-bold text-ink text-[15px] sm:text-[17px] leading-tight truncate">{entry.title}</p>
        {entry.crumb && <p className="text-ink-muted text-[11px]">{entry.crumb}</p>}
      </div>

      <div className="flex-1" />

      <form onSubmit={handleSearch} className="w-full max-w-[220px] sm:max-w-xs shrink min-w-0">
        <div className="relative">
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-muted text-base">⌕</span>
          <input
            className="input h-9 pl-8 text-xs w-full"
            placeholder="Search by Model No..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </form>

      <NotificationBell />

      <Link href="/profile" className="flex items-center gap-2.5 h-[38px] rounded-[7px] border border-brand-200 bg-brand-50 pl-1.5 pr-2.5 hover:bg-brand-100">
        <div className="h-[26px] w-[26px] rounded-full bg-brand-700 flex items-center justify-center text-white text-[10px] font-medium shrink-0">
          {initials}
        </div>
        <div className="hidden sm:block leading-tight">
          <p className="text-[11.5px] font-medium text-ink">{user.name}</p>
          <p className="text-[9.5px] text-brand-700">{ROLE_LABEL[user.role]}</p>
        </div>
        <span className="hidden sm:inline text-ink-muted text-[10px]">▾</span>
      </Link>
    </header>
  );
}
