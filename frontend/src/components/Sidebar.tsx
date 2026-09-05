'use client';

import Image from 'next/image';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import type { Role } from '@/types';

interface NavItem {
  href: string;
  label: string;
  icon: string;
  minRole?: Role | Role[];
  // When true, membership is checked literally against the roles list -
  // Super Admin's usual "bypasses every check" behavior does not apply.
  // Used for employee-only items like My Work, which are meaningless for
  // Super Admin/Admin (no linked worker profile to show jobs for).
  exact?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { href: '/dashboard', label: 'Dashboard', icon: '▦', minRole: 'ADMIN' },
  { href: '/my-work', label: 'My Work', icon: '⚒', minRole: ['CARPENTER', 'CARVER', 'POLISHER'], exact: true },
  { href: '/customer-orders', label: 'Customer Orders', icon: '₹', minRole: 'ADMIN' },
  { href: '/party-orders', label: 'Party Orders', icon: '◉', minRole: 'ADMIN' },
  { href: '/inventory', label: 'Inventory', icon: '▤' },
  { href: '/suppliers', label: 'Suppliers', icon: '⇩', minRole: 'ADMIN' },
  { href: '/purchase-orders', label: 'Purchase Orders', icon: '⇩', minRole: 'ADMIN' },
  { href: '/carpenters', label: 'Production', icon: '✦' },
  { href: '/production-control', label: 'Production Control', icon: '⏻', minRole: 'ADMIN' },
  { href: '/payments', label: 'Payments', icon: '▣', minRole: 'ADMIN' },
  { href: '/expenses', label: 'Expenses', icon: '⛁', minRole: 'SUPERADMIN' },
  { href: '/reports', label: 'Reports', icon: '▥', minRole: 'ADMIN' },
  { href: '/users', label: 'Users & Roles', icon: '◍', minRole: 'SUPERADMIN' },
  { href: '/audit-log', label: 'Audit Log', icon: '◪', minRole: 'SUPERADMIN' },
  { href: '/settings/whatsapp', label: 'Settings', icon: '✱', minRole: 'ADMIN' },
];

const ROLE_LABEL: Record<Role, string> = {
  SUPERADMIN: 'Super Admin',
  ADMIN: 'Admin',
  CARPENTER: 'Carpenter Team',
  CARVER: 'Carving Team',
  POLISHER: 'Polish Team',
};

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const { user, hasRole, logout } = useAuth();
  const pathname = usePathname();

  if (!user) return null;

  return (
    <aside className="w-[240px] shrink-0 bg-brand-700 text-white flex flex-col h-full">
      <div className="flex items-center gap-[11px] px-4 py-[16px]">
        <div className="bg-white rounded-[8px] p-1.5 shrink-0">
          <Image src="/logo1.jpeg" alt="SSS Company" width={594} height={339} className="h-8 w-auto" priority />
        </div>
        <div className="min-w-0 flex-1">
          <p className="font-bold text-white text-sm leading-tight tracking-wide">SSS Company</p>
          <p className="text-brand-400 text-[9px] tracking-wide">Retail &middot; Wholesale</p>
        </div>
        <button onClick={onNavigate} className="md:hidden text-white/60 hover:text-white text-lg leading-none px-1" aria-label="Close menu">
          &times;
        </button>
      </div>
      <div className="h-px bg-white/10 mx-0" />

      <nav className="flex-1 px-2.5 py-3.5 space-y-0.5 overflow-y-auto">
        <p className="text-[9px] font-medium text-white/40 tracking-[1.2px] px-2 pb-1">MENU</p>
        {NAV_ITEMS.filter((item) => {
          if (!item.minRole) return true;
          const roles = Array.isArray(item.minRole) ? item.minRole : [item.minRole];
          return item.exact ? roles.includes(user.role) : hasRole(...roles);
        }).map((item) => {
          const active = pathname === item.href || pathname?.startsWith(item.href + '/');
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onNavigate}
              className={`flex items-center gap-2.5 h-[38px] rounded-[7px] pr-2.5 transition-colors ${
                active ? 'bg-white/[0.18]' : 'hover:bg-white/[0.08]'
              }`}
            >
              <span className={`h-5 w-[3px] rounded-[2px] shrink-0 ${active ? 'bg-brand-400' : ''}`} />
              <span
                className={`flex items-center justify-center h-[26px] w-[26px] text-[19px] leading-none shrink-0 ${
                  active ? 'text-brand-400' : 'text-white/75'
                }`}
              >
                {item.icon}
              </span>
              <span className={`flex-1 text-[12.5px] truncate ${active ? 'text-white font-medium' : 'text-white/80'}`}>
                {item.label}
              </span>
            </Link>
          );
        })}
      </nav>

      <div className="px-3 pt-3.5 pb-4 space-y-2.5">
        <div className="h-px bg-white/10" />
        <div className="flex items-center gap-2.5 bg-white/[0.07] rounded-lg p-2.5">
          <div className="h-8 w-8 rounded-full bg-brand-400 flex items-center justify-center text-brand-700 text-xs font-medium shrink-0">
            {user.name
              .split(' ')
              .map((p) => p[0])
              .slice(0, 2)
              .join('')
              .toUpperCase()}
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-medium text-white truncate">{user.name}</p>
            <p className="text-brand-400 text-[9.5px] truncate">{ROLE_LABEL[user.role]}</p>
          </div>
          <button onClick={() => logout()} className="text-white/60 hover:text-white text-xs" title="Sign out">
            ⏻
          </button>
        </div>
      </div>
    </aside>
  );
}
