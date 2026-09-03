'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { useAuth } from '@/context/AuthContext';
import type { AuditLogEntry, CarpenterWorkItem, PurchaseOrder, RawMaterial } from '@/types';

function meta(a: AuditLogEntry, key: string): string {
  const value = a.metadata?.[key];
  return typeof value === 'string' ? value : '';
}

const STAGE_LABEL: Record<string, string> = { CARPENTER: 'Carpenter', CARVING: 'Carving', POLISH: 'Polish' };
const STATUS_LABEL: Record<string, string> = {
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  QUALITY_CHECK: 'Quality Check',
  REWORK: 'Rework',
  COMPLETED: 'Completed',
};

const ACTIVITY_LABEL: Record<string, (a: AuditLogEntry) => string> = {
  CUSTOMER_ORDER_CREATED: (a) => `${a.user?.name} created customer order ${meta(a, 'orderId')} for ${meta(a, 'customerName')}`,
  PARTY_ORDER_CREATED: (a) => `${a.user?.name} created a party order for ${meta(a, 'shopName')}`,
  WORK_ITEM_CREATED: (a) => `${a.user?.name} assigned work: ${meta(a, 'productName')}`,
  MATERIAL_ISSUED: (a) => `${a.user?.name} issued material for ${meta(a, 'productName')}`,
  MODEL_NO_UPDATED: (a) =>
    meta(a, 'orderType') === 'PARTY_ORDER'
      ? `${meta(a, 'employeeName') || a.user?.name} updated Model No "${meta(a, 'modelNo')}" for party order (${meta(a, 'shopName')})`
      : `${meta(a, 'employeeName') || a.user?.name} updated Model No "${meta(a, 'modelNo')}" for customer order ${meta(a, 'orderId')}`,
  WORK_ITEM_COMPLETED: (a) => {
    const stage = STAGE_LABEL[meta(a, 'stage')] ?? meta(a, 'stage');
    const modelNo = meta(a, 'modelNo');
    return `${meta(a, 'carpenterName') || a.user?.name} completed ${stage} stage for ${meta(a, 'productName')}${modelNo ? ` (Model No: ${modelNo})` : ''}`;
  },
  // Any other status transition (Assigned -> In Progress, -> Quality
  // Check, -> Rework, ...) - same event for every worker type
  // (Carpenter/Polisher/Carver), so none of them go unnoticed.
  WORK_ITEM_STATUS_CHANGED: (a) => {
    const stage = STAGE_LABEL[meta(a, 'stage')] ?? meta(a, 'stage');
    const from = STATUS_LABEL[meta(a, 'fromStatus')] ?? meta(a, 'fromStatus');
    const to = STATUS_LABEL[meta(a, 'toStatus')] ?? meta(a, 'toStatus');
    const modelNo = meta(a, 'modelNo');
    return `${meta(a, 'carpenterName') || a.user?.name} moved ${stage} work "${meta(a, 'productName')}"${modelNo ? ` (Model No: ${modelNo})` : ''} from ${from} to ${to}`;
  },
};

interface NotificationItem {
  id: string;
  label: string;
  href: string;
  tone: 'warning' | 'danger' | 'info';
}

function readStorageKey(userId: string) {
  return `sss.notifications.read.${userId}`;
}

function loadReadIds(userId: string): Set<string> {
  try {
    const raw = window.localStorage.getItem(readStorageKey(userId));
    return raw ? new Set(JSON.parse(raw)) : new Set();
  } catch {
    return new Set();
  }
}

function saveReadIds(userId: string, ids: Set<string>) {
  try {
    window.localStorage.setItem(readStorageKey(userId), JSON.stringify([...ids]));
  } catch {
    // ignore (private browsing / storage disabled)
  }
}

export function NotificationBell() {
  const { user, hasRole } = useAuth();
  const [open, setOpen] = useState(false);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const ref = useRef<HTMLDivElement>(null);

  const { data: lowStock } = useSWR<RawMaterial[]>('/raw-materials?lowStockOnly=true', fetcher, { refreshInterval: 60000 });
  const { data: workItems } = useSWR<CarpenterWorkItem[]>('/carpenter-work-items', fetcher, { refreshInterval: 60000 });
  const { data: purchaseOrders } = useSWR<PurchaseOrder[]>(hasRole('ADMIN') ? '/purchase-orders?status=PENDING_APPROVAL' : null, fetcher, {
    refreshInterval: 60000,
  });
  const { data: employeeActivity } = useSWR<AuditLogEntry[]>(hasRole('ADMIN') ? '/audit-logs/employee-activity' : null, fetcher, {
    refreshInterval: 60000,
  });

  useEffect(() => {
    if (user) setReadIds(loadReadIds(user.id));
  }, [user]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const items: NotificationItem[] = useMemo(
    () => [
      ...(lowStock ?? []).map(
        (m): NotificationItem => ({
          id: `stock-${m.id}`,
          label: `${m.name} is ${m.inStock <= 0 ? 'out of stock' : 'below minimum'} (${m.inStock} ${m.unit})`,
          href: `/inventory/materials/${m.id}`,
          tone: m.inStock <= 0 ? 'danger' : 'warning',
        }),
      ),
      ...(workItems ?? [])
        .filter((w) => w.status === 'QUALITY_CHECK')
        .map(
          (w): NotificationItem => ({
            id: `qc-${w.id}`,
            label: `${w.productName}${w.carpenter ? ` (${w.carpenter.name})` : ''} is awaiting quality check`,
            href: w.carpenter ? `/carpenters/${w.carpenter.id}` : '/carpenters',
            tone: 'info',
          }),
        ),
      ...(purchaseOrders ?? []).map(
        (po): NotificationItem => ({
          id: `po-${po.id}`,
          label: `Purchase order ${po.poNumber} needs approval`,
          href: '/purchase-orders',
          tone: 'info',
        }),
      ),
      ...(employeeActivity ?? []).map(
        (a): NotificationItem => ({
          id: `activity-${a.id}`,
          label: ACTIVITY_LABEL[a.action]?.(a) ?? `${a.user?.name} - ${a.action}`,
          href:
            a.action === 'CUSTOMER_ORDER_CREATED'
              ? '/customer-orders'
              : a.action === 'PARTY_ORDER_CREATED'
                ? '/party-orders'
                : a.action === 'MODEL_NO_UPDATED'
                  ? meta(a, 'orderType') === 'PARTY_ORDER'
                    ? '/party-orders'
                    : '/customer-orders'
                  : '/carpenters',
          tone: 'info',
        }),
      ),
    ],
    [lowStock, workItems, purchaseOrders, employeeActivity],
  );

  // Keep the stored read-set bounded to notifications that still exist.
  useEffect(() => {
    if (!user || items.length === 0) return;
    const currentIds = new Set(items.map((i) => i.id));
    setReadIds((prev) => {
      const pruned = new Set([...prev].filter((id) => currentIds.has(id)));
      if (pruned.size !== prev.size) saveReadIds(user.id, pruned);
      return pruned.size !== prev.size ? pruned : prev;
    });
  }, [items, user]);

  const unreadCount = items.filter((i) => !readIds.has(i.id)).length;

  function markRead(id: string) {
    if (!user) return;
    setReadIds((prev) => {
      const next = new Set(prev).add(id);
      saveReadIds(user.id, next);
      return next;
    });
  }

  function markAllRead() {
    if (!user) return;
    const all = new Set(items.map((i) => i.id));
    setReadIds(all);
    saveReadIds(user.id, all);
  }

  const toneDot: Record<NotificationItem['tone'], string> = {
    danger: 'bg-red-600',
    warning: 'bg-amber-600',
    info: 'bg-blue-600',
  };

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="relative h-[38px] w-[38px] rounded-[7px] border border-brand-200 bg-brand-50 flex items-center justify-center text-ink text-lg"
        title="Notifications"
      >
        ⚑
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 h-4 min-w-4 px-0.5 rounded-full bg-accent text-white text-[9px] font-medium flex items-center justify-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 mt-2 w-80 max-h-96 overflow-y-auto card z-30 py-2">
          <div className="flex items-center justify-between px-3 py-1.5">
            <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide">Notifications</p>
            {unreadCount > 0 && (
              <button onClick={markAllRead} className="text-[11px] text-brand-600 hover:underline">
                Mark all as read
              </button>
            )}
          </div>
          {items.length === 0 && <p className="px-3 py-4 text-sm text-ink-muted">Nothing needs your attention right now.</p>}
          {items.map((item) => {
            const isUnread = !readIds.has(item.id);
            return (
              <Link
                key={item.id}
                href={item.href}
                onClick={() => {
                  markRead(item.id);
                  setOpen(false);
                }}
                className={`flex items-start gap-2.5 px-3 py-2 hover:bg-brand-50 text-sm ${isUnread ? 'bg-brand-50/60' : ''}`}
              >
                <span className={`h-1.5 w-1.5 rounded-full mt-1.5 shrink-0 ${isUnread ? toneDot[item.tone] : 'bg-brand-200'}`} />
                <span className={isUnread ? 'text-ink font-medium' : 'text-ink-muted'}>{item.label}</span>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
