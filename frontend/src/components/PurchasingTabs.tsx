'use client';

import Link from 'next/link';

// Suppliers and Purchase Orders are two separate route trees (kept as-is to
// avoid a mass link migration - see NotificationBell, inventory material
// deep-links, and the supplier<->PO cross-links that already point at these
// exact paths) but should feel like one "Purchasing" module. This renders
// the same tab-bar look as Inventory's internal tabs, with each tab being a
// real page navigation rather than client-side state.
export function PurchasingTabs({ active }: { active: 'suppliers' | 'purchase-orders' }) {
  const tabs: { key: 'suppliers' | 'purchase-orders'; label: string; href: string }[] = [
    { key: 'suppliers', label: 'Suppliers', href: '/suppliers' },
    { key: 'purchase-orders', label: 'Purchase Orders', href: '/purchase-orders' },
  ];
  return (
    <div className="flex gap-1 border-b border-brand-200 overflow-x-auto">
      {tabs.map((t) => (
        <Link
          key={t.key}
          href={t.href}
          className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px whitespace-nowrap transition-colors ${
            active === t.key ? 'border-brand-700 text-brand-900' : 'border-transparent text-ink-muted hover:text-ink'
          }`}
        >
          {t.label}
        </Link>
      ))}
    </div>
  );
}
