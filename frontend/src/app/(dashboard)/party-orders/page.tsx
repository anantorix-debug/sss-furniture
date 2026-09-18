'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { getAccessToken } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import { BalanceBadge } from '@/components/StatusBadge';
import { ShopManagerModal } from '@/components/ShopManagerModal';
import { PartyOrderFormModal } from '@/components/PartyOrderFormModal';
import { RoleGate } from '@/components/RoleGate';
import type { PartyOrder, Shop, ShopSummary } from '@/types';
import { Pagination, type PaginatedResult } from '@/components/Pagination';
import { FilterBar } from '@/components/FilterBar';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const emptyFilters: Record<string, string> = {};
const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'CANCELLED', label: 'Cancelled' },
];
const PAYMENT_STATUS_OPTIONS = [
  { value: 'DUE', label: 'Due' },
  { value: 'SETTLED', label: 'Settled' },
];

function ShopCard({ shop, onNewOrder }: { shop: ShopSummary; onNewOrder: (shopId: string) => void }) {
  const hasFinancials = shop.totalValue !== undefined;
  return (
    <div className="card p-5 hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-semibold text-brand-900 truncate">{shop.shopName}</p>
          {shop.contactPhone && <p className="text-xs text-brand-400">{shop.contactPhone}</p>}
        </div>
        {!shop.isActive && (
          <span className="text-[10px] px-2 py-0.5 rounded-full bg-brand-100 text-brand-500 shrink-0">Inactive</span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
        <div>
          <p className="text-brand-400 text-xs">Total Orders</p>
          <p className="font-medium">{shop.orderCount}</p>
        </div>
        <div>
          <p className="text-brand-400 text-xs">Last Order</p>
          <p className="font-medium">{shop.lastOrderDate ? formatDate(shop.lastOrderDate) : '-'}</p>
        </div>
        {hasFinancials && (
          <>
            <div>
              <p className="text-brand-400 text-xs">Total Value</p>
              <p className="font-medium">{formatCurrency(shop.totalValue ?? 0)}</p>
            </div>
            <div>
              <p className="text-brand-400 text-xs">Paid</p>
              <p className="font-medium">{formatCurrency(shop.totalPaid ?? 0)}</p>
            </div>
            <div className="col-span-2 pt-2 border-t border-brand-100 flex items-center justify-between">
              <div>
                <p className="text-brand-400 text-xs">Balance</p>
                <p className={`font-semibold ${(shop.balanceDue ?? 0) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                  {formatCurrency(shop.balanceDue ?? 0)}
                </p>
              </div>
              <BalanceBadge amount={shop.balanceDue ?? 0} />
            </div>
          </>
        )}
        <div className="col-span-2 pt-2 border-t border-brand-100 flex items-center gap-3 text-xs text-brand-500">
          <span>Pending: {shop.pendingCount}</span>
          <span>Delivered: {shop.deliveredCount}</span>
        </div>
      </div>

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-brand-100">
        <Link href={`/party-orders/shop/${shop.shopId}`} className="text-brand-600 hover:underline text-xs font-medium">
          View Shop
        </Link>
        {shop.shopId && (
          <button className="text-brand-600 hover:underline text-xs" onClick={() => onNewOrder(shop.shopId as string)}>
            + New Order
          </button>
        )}
      </div>
    </div>
  );
}

function PartyOrdersContent() {
  const [page, setPage] = useState(1);
  const [values, setValues] = useState<Record<string, string>>(emptyFilters);
  const [applied, setApplied] = useState<Record<string, string>>(emptyFilters);
  const [downloadingList, setDownloadingList] = useState(false);
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const { data: shops, mutate: mutateShops } = useSWR<Shop[]>('/shops', fetcher);
  const queryParams = new URLSearchParams({ ...applied, page: String(page), limit: '20' });
  const { data: result, isLoading, mutate } = useSWR<PaginatedResult<ShopSummary>>(
    `/party-orders/shops-summary?${queryParams}`,
    fetcher,
  );
  const data = result?.data;
  const [shopManagerOpen, setShopManagerOpen] = useState(false);

  function applyFilters() {
    setApplied(values);
    setPage(1);
  }
  function resetFilters() {
    setValues(emptyFilters);
    setApplied(emptyFilters);
    setPage(1);
  }

  async function downloadListPdf() {
    setDownloadingList(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${API_BASE_URL}/party-orders/pdf?${new URLSearchParams(applied)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `party-orders-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingList(false);
    }
  }

  async function downloadListCsv() {
    setDownloadingCsv(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${API_BASE_URL}/party-orders/export?${new URLSearchParams(applied)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `party-orders-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingCsv(false);
    }
  }

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PartyOrder | null>(null);
  const [formInitialShopId, setFormInitialShopId] = useState<string | undefined>(undefined);

  function openCreate() {
    setEditing(null);
    setFormInitialShopId(undefined);
    setFormOpen(true);
  }

  function openCreateForShop(shopId: string) {
    setEditing(null);
    setFormInitialShopId(shopId);
    setFormOpen(true);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">Party Orders</h1>
          <p className="text-sm text-brand-500 mt-1">Wholesale / shop orders, grouped by shop.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={downloadListPdf} disabled={downloadingList}>
            {downloadingList ? 'Preparing...' : 'Download PDF'}
          </button>
          <button className="btn-secondary" onClick={downloadListCsv} disabled={downloadingCsv}>
            {downloadingCsv ? 'Preparing...' : 'Export Excel'}
          </button>
          <button className="btn-secondary" onClick={() => setShopManagerOpen(true)}>
            Manage Shops
          </button>
          <button className="btn-primary" onClick={openCreate}>
            + New Party Order
          </button>
        </div>
      </div>

      <FilterBar
        fields={[
          { key: 'search', label: 'Search', type: 'search', placeholder: 'Search shop, product, Model No, Job No...' },
          { key: 'dateFrom', label: 'Date From', type: 'date' },
          { key: 'dateTo', label: 'Date To', type: 'date' },
          { key: 'shopId', label: 'Shop', type: 'select', options: (shops ?? []).map((s) => ({ value: s.id, label: s.name })) },
          { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
          { key: 'paymentStatus', label: 'Payment Status', type: 'select', options: PAYMENT_STATUS_OPTIONS },
        ]}
        values={values}
        onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
        onApply={applyFilters}
        onReset={resetFilters}
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading && <p className="text-brand-400 text-sm">Loading shops...</p>}
        {!isLoading && data?.length === 0 && (
          <p className="text-brand-400 text-sm">
            {Object.keys(applied).length > 0 ? 'No shops match the current filters.' : 'No shops found.'}
          </p>
        )}
        {data?.map((shop) => (
          <ShopCard key={shop.shopId ?? shop.shopName} shop={shop} onNewOrder={openCreateForShop} />
        ))}
      </div>
      {result && (
        <Pagination page={result.page} totalPages={result.totalPages} total={result.total} limit={result.limit} onPageChange={setPage} />
      )}

      {formOpen && (
        <PartyOrderFormModal
          editing={editing}
          initialShopId={formInitialShopId}
          onClose={() => setFormOpen(false)}
          onSaved={() => mutate()}
        />
      )}

      {shopManagerOpen && <ShopManagerModal onClose={() => setShopManagerOpen(false)} onChange={() => mutateShops()} />}
    </div>
  );
}

export default function PartyOrdersPage() {
  return (
    <RoleGate minRole="ADMIN">
      <PartyOrdersContent />
    </RoleGate>
  );
}
