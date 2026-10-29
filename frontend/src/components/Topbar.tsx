'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { formatCurrency } from '@/lib/format';
import { useAuth } from '@/context/AuthContext';
import { NotificationBell } from './NotificationBell';
import type { Role } from '@/types';

interface LiveSensex {
  monthProfit: number;
  monthRevenue: number;
  monthCosts: number;
  profitMargin: number;
  lifetimeProfit: number;
  lifetimeRevenue: number;
  activeInvestors: number;
  netActiveCapital: number;
  isProfit: boolean;
  timestamp: string;
}

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
  '/investors': { title: 'Investors Management', crumb: 'Investors › P&L & Dividends' },
  '/reports': { title: 'Reports', crumb: 'Reports' },
  '/users': { title: 'Users', crumb: 'Users & Roles › Users' },
  '/audit-log': { title: 'Audit Log', crumb: 'Users & Roles › Audit Log' },
  '/settings/whatsapp': { title: 'Settings', crumb: 'Settings › WhatsApp' },
  '/profile': { title: 'My Profile', crumb: 'My Profile & Security' },
  '/track': { title: 'Track', crumb: 'Global Search' },
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
  const [modelSearch, setModelSearch] = useState('');
  const [voucherSearch, setVoucherSearch] = useState('');

  const isManagement = user?.role === 'SUPERADMIN' || user?.role === 'ADMIN';
  const { data: sensex } = useSWR<LiveSensex>(
    isManagement ? '/investors/live-sensex' : null,
    fetcher,
    { refreshInterval: 30000, revalidateOnFocus: true }
  );

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

  function handleModelSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = modelSearch.trim();
    if (!q) return;
    router.push(`/track/${encodeURIComponent(q)}`);
  }

  function handleVoucherSearch(e: React.FormEvent) {
    e.preventDefault();
    const q = voucherSearch.trim();
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

      {/* Live Sensex / Profit & Loss Ticker */}
      {isManagement && sensex && (
        <Link
          href="/investors"
          className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-50 hover:bg-slate-100 border border-slate-200 transition-all text-xs group shrink-0 shadow-2xs"
          title={`Live P&L this month. Revenue: ${formatCurrency(sensex.monthRevenue)} | Costs: ${formatCurrency(sensex.monthCosts)}. Click to open Investors & P&L.`}
        >
          <span className="relative flex h-2 w-2">
            <span
              className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                sensex.isProfit ? 'bg-emerald-400' : 'bg-red-400'
              }`}
            />
            <span
              className={`relative inline-flex rounded-full h-2 w-2 ${
                sensex.isProfit ? 'bg-emerald-500' : 'bg-red-500'
              }`}
            />
          </span>
          <span className="font-bold text-[10px] tracking-wider uppercase text-slate-500 group-hover:text-brand-700 transition-colors">
            P&amp;L SENSEX
          </span>
          <span
            className={`font-mono font-bold text-xs ${
              sensex.isProfit ? 'text-emerald-700' : 'text-red-600'
            }`}
          >
            {formatCurrency(sensex.monthProfit)}
          </span>
          <span
            className={`text-[10px] px-1.5 py-0.2 rounded font-semibold ${
              sensex.isProfit
                ? 'bg-emerald-100/80 text-emerald-800'
                : 'bg-red-100/80 text-red-800'
            }`}
          >
            {sensex.profitMargin > 0 ? `+${sensex.profitMargin}%` : `${sensex.profitMargin}%`}
          </span>
        </Link>
      )}

      {/* Dual Global Search: Model No & Voucher No */}
      <div className="flex items-center gap-1.5 sm:gap-2 shrink min-w-0">
        <form onSubmit={handleModelSearch} className="w-[125px] sm:w-[155px] md:w-[170px]">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted text-xs">⌕</span>
            <input
              className="input h-8 pl-7 pr-2 text-xs w-full bg-brand-50/50 border-brand-200 focus:bg-white"
              placeholder="Model No..."
              value={modelSearch}
              onChange={(e) => setModelSearch(e.target.value)}
            />
          </div>
        </form>

        <form onSubmit={handleVoucherSearch} className="w-[125px] sm:w-[155px] md:w-[170px]">
          <div className="relative">
            <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-muted text-xs">🧾</span>
            <input
              className="input h-8 pl-7 pr-2 text-xs w-full bg-brand-50/50 border-brand-200 focus:bg-white"
              placeholder="Voucher No..."
              value={voucherSearch}
              onChange={(e) => setVoucherSearch(e.target.value)}
            />
          </div>
        </form>
      </div>

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
