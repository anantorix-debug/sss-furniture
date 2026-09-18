'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError, getAccessToken } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate } from '@/lib/format';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StatCard } from '@/components/StatCard';
import { ShopManagerModal } from '@/components/ShopManagerModal';
import { PartyOrderFormModal } from '@/components/PartyOrderFormModal';
import { PartyOrderCard } from '@/components/PartyOrderCard';
import { RoleGate } from '@/components/RoleGate';
import { WhatsAppModal } from '@/components/WhatsAppModal';
import { useWhatsApp } from '@/hooks/useWhatsApp';
import { useForceable } from '@/hooks/useForceable';
import type { PartyOrder, ShopDashboardResult, ShopSummary } from '@/types';
import { Pagination } from '@/components/Pagination';
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

// LEFT side of the two-column report - one row per product line across
// every order that matches the active filters (dashboard.items is already
// the full filtered set, not just the current order-card page, so this
// table's row count and totals always agree with the PDF/Excel export for
// the same filters). price/value columns are omitted entirely (not zeroed)
// for viewers who can't see financials.
function ProductSupplyTable({ rows }: { rows: ShopDashboardResult['items'] }) {
  const hasFinancials = rows.some((r) => r.value !== undefined) || rows.length === 0;
  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-brand-100">
        <h2 className="text-sm font-semibold text-brand-900">Product Supply Details</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="table-shell w-full">
          <thead>
            <tr>
              <th>S.No</th>
              <th>Date</th>
              <th>Order</th>
              <th>Finish</th>
              <th>Size</th>
              <th>Pattern</th>
              {hasFinancials && <th className="text-right">Price</th>}
              <th>M.No</th>
              {hasFinancials && <th className="text-right">Value</th>}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 && (
              <tr>
                <td colSpan={hasFinancials ? 9 : 7} className="text-center text-brand-400 py-6">
                  No items match the current filters.
                </td>
              </tr>
            )}
            {rows.map((r, idx) => (
              <tr key={`${r.orderId}-${idx}`}>
                <td>{idx + 1}</td>
                <td className="whitespace-nowrap">{formatDate(r.date)}</td>
                <td>{r.order}</td>
                <td>{r.finish ?? 'Not specified'}</td>
                <td>{r.size ?? 'Not specified'}</td>
                <td>{r.pattern ?? 'Not specified'}</td>
                {hasFinancials && <td className="text-right">{r.price != null ? formatCurrency(r.price) : '-'}</td>}
                <td>{r.modelNo ?? '-'}</td>
                {hasFinancials && <td className="text-right font-medium">{r.value != null ? formatCurrency(r.value) : '-'}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// The Total Order Value / Total Paid / Balance row - same StatCard styling
// as the Purchasing/Supplier detail page's Total Purchases/Total Paid/
// Balance Payable row, so the two "statement" screens look consistent.
function PaymentSummaryCards({ summary }: { summary: ShopSummary }) {
  if (summary.totalValue === undefined) return null;
  return (
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
      <StatCard label="Total Order Value" value={formatCurrency(summary.totalValue ?? 0)} />
      <StatCard label="Total Paid" value={formatCurrency(summary.totalPaid ?? 0)} accent="success" />
      <StatCard label="Balance" value={formatCurrency(summary.balanceDue ?? 0)} accent="warning" />
    </div>
  );
}

// RIGHT side of the two-column report - the running-balance payment
// ledger, same column set as the Purchasing/Supplier detail page's own
// Payment Ledger (Date/Voucher No/Amount/Balance/Mode), plus the same
// "Record Payment" inline form that page has. A shop can have several
// orders, so this form has one extra field the Supplier one doesn't need -
// which order the payment applies to - and posts to that order's own
// existing POST /party-orders/:id/payments (no new payment model/endpoint).
function PaymentLedgerPanel({
  summary,
  ledger,
  orders,
  canAdd,
  onAddPayment,
}: {
  summary: ShopSummary;
  ledger: ShopDashboardResult['paymentLedger'];
  orders: PartyOrder[];
  canAdd: boolean;
  onAddPayment: (orderId: string, payload: { date: string; amount: number; mode?: string; note?: string }) => Promise<void>;
}) {
  const [orderId, setOrderId] = useState('');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [voucherNo, setVoucherNo] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('CASH');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const numAmount = parseFloat(amount);
    if (!orderId) {
      setError('Select which order this payment is for');
      return;
    }
    if (!numAmount || numAmount <= 0) {
      setError('Enter a valid amount');
      return;
    }
    setSubmitting(true);
    try {
      await onAddPayment(orderId, { date, amount: numAmount, mode, note: voucherNo || undefined });
      setAmount('');
      setVoucherNo('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record payment');
    } finally {
      setSubmitting(false);
    }
  }

  const hasFinancials = summary.totalValue !== undefined;
  if (!hasFinancials) {
    return (
      <div className="card p-4">
        <h2 className="text-sm font-semibold text-brand-900 mb-2">Payment Ledger</h2>
        <p className="text-xs text-brand-400">Payment details are not visible for your role.</p>
      </div>
    );
  }
  return (
    <div className="card p-0 overflow-hidden">
      <div className="px-4 py-3 border-b border-brand-100">
        <h2 className="text-sm font-semibold text-brand-900">Payment Ledger</h2>
      </div>
      <div className="max-h-96 overflow-y-auto overflow-x-auto">
        <table className="table-shell w-full">
          <thead>
            <tr>
              <th>Date</th>
              <th>V.No</th>
              <th className="text-right">Amount</th>
              <th className="text-right">Balance</th>
              <th>Mode</th>
            </tr>
          </thead>
          <tbody>
            {ledger.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center text-brand-400 py-6">
                  No payments recorded yet.
                </td>
              </tr>
            )}
            {ledger.map((p, idx) => (
              <tr key={idx}>
                <td className="whitespace-nowrap">{formatDate(p.date)}</td>
                <td>{p.voucherNo ?? '-'}</td>
                <td className="text-right font-medium">{formatCurrency(p.amount)}</td>
                <td className="text-right">{formatCurrency(p.balance)}</td>
                <td>{p.mode ?? '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canAdd && (
        <form onSubmit={handleAdd} className="p-4 border-t border-brand-100 space-y-2">
          <select className="input" required value={orderId} onChange={(e) => setOrderId(e.target.value)}>
            <option value="">Select order...</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.jobNumber ?? o.cotNo ?? o.id} - {formatCurrency(o.balanceAmount ?? 0)} due
              </option>
            ))}
          </select>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input type="date" className="input" required value={date} onChange={(e) => setDate(e.target.value)} />
            <input className="input" placeholder="Voucher No." value={voucherNo} onChange={(e) => setVoucherNo(e.target.value)} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <input
              type="number"
              step="0.01"
              min="0.01"
              className="input"
              placeholder="Amount"
              required
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option>CASH</option>
              <option>UPI</option>
              <option>GPAY</option>
              <option>BANK TRANSFER</option>
            </select>
          </div>
          {error && <p className="text-xs text-red-600">{error}</p>}
          <button type="submit" disabled={submitting} className="btn-primary w-full">
            {submitting ? 'Recording...' : 'Record Payment'}
          </button>
        </form>
      )}
    </div>
  );
}

function ShopDashboardContent({ shopId }: { shopId: string }) {
  const { hasRole } = useAuth();
  const { forcePrompt, closeForcePrompt, runForceable } = useForceable();
  const [page, setPage] = useState(1);
  const [values, setValues] = useState<Record<string, string>>(emptyFilters);
  const [applied, setApplied] = useState<Record<string, string>>(emptyFilters);
  const [downloadingList, setDownloadingList] = useState(false);
  const [downloadingCsv, setDownloadingCsv] = useState(false);
  const [shopManagerOpen, setShopManagerOpen] = useState(false);

  const queryParams = new URLSearchParams({ ...applied, page: String(page), limit: '20' });
  const { data: dashboard, isLoading, mutate } = useSWR<ShopDashboardResult>(
    `/party-orders/shops-summary/${shopId}?${queryParams}`,
    fetcher,
  );

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
      const params = new URLSearchParams(applied);
      const res = await fetch(`${API_BASE_URL}/party-orders/shops-summary/${shopId}/pdf?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `party-orders-${dashboard?.shop.name ?? shopId}-${new Date().toISOString().slice(0, 10)}.pdf`;
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
      const params = new URLSearchParams(applied);
      const res = await fetch(`${API_BASE_URL}/party-orders/shops-summary/${shopId}/export?${params}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `party-orders-${dashboard?.shop.name ?? shopId}-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingCsv(false);
    }
  }

  const { showModal, whatsappOptions, openWhatsApp, closeWhatsApp } = useWhatsApp();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PartyOrder | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PartyOrder | null>(null);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    await runForceable(async (force) => {
      await api.delete(`/party-orders/${target.id}${force ? '?force=true' : ''}`);
      setDeleteTarget(null);
      mutate();
    }, hasRole('SUPERADMIN'));
  }

  async function handleAddPayment(orderId: string, payload: { date: string; amount: number; mode?: string; note?: string }) {
    await api.post(`/party-orders/${orderId}/payments`, payload);
    mutate();
  }

  if (isLoading && !dashboard) {
    return <p className="text-brand-400 text-sm">Loading shop...</p>;
  }

  if (!dashboard) {
    return <p className="text-brand-400 text-sm">Shop not found.</p>;
  }

  const { shop, overallSummary, filteredSummary, orders, items, paymentLedger } = dashboard;
  const hasFilters = Object.keys(applied).length > 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <Link href="/party-orders" className="text-xs text-brand-500 hover:underline">
            ← All Shops
          </Link>
          <h1 className="text-2xl font-bold text-brand-900 mt-1">{shop.name}</h1>
          <p className="text-sm text-brand-500 mt-0.5">
            {[shop.contactPerson, shop.contactPhone, shop.address].filter(Boolean).join(' · ') || 'No contact details'}
            {' · '}
            {overallSummary.orderCount} order{overallSummary.orderCount === 1 ? '' : 's'} overall
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={downloadListPdf} disabled={downloadingList}>
            {downloadingList ? 'Preparing...' : 'Download PDF'}
          </button>
          <button className="btn-secondary" onClick={downloadListCsv} disabled={downloadingCsv}>
            {downloadingCsv ? 'Preparing...' : 'Export Excel'}
          </button>
          <button className="btn-secondary" onClick={() => setShopManagerOpen(true)}>
            Edit Shop
          </button>
          <button className="btn-primary" onClick={openCreate}>
            + New Order
          </button>
        </div>
      </div>

      <PaymentSummaryCards summary={filteredSummary} />

      <FilterBar
        fields={[
          { key: 'search', label: 'Search', type: 'search', placeholder: 'Search product, Model No, Job No...' },
          { key: 'dateFrom', label: 'Date From', type: 'date' },
          { key: 'dateTo', label: 'Date To', type: 'date' },
          { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
          { key: 'paymentStatus', label: 'Payment Status', type: 'select', options: PAYMENT_STATUS_OPTIONS },
        ]}
        values={values}
        onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
        onApply={applyFilters}
        onReset={resetFilters}
      />
      {hasFilters && <p className="text-xs text-brand-500 -mt-3">Showing filtered results only. Reset to view the shop&apos;s complete data.</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
        <ProductSupplyTable rows={items} />
        <PaymentLedgerPanel
          summary={filteredSummary}
          ledger={paymentLedger}
          orders={orders.data}
          canAdd={hasRole('ADMIN')}
          onAddPayment={handleAddPayment}
        />
      </div>

      <div className="border-t border-brand-100 pt-4">
        <h2 className="text-sm font-semibold text-brand-900 mb-3">Orders</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {orders.data.length === 0 && (
            <p className="text-brand-400 text-sm">{hasFilters ? 'No orders match the current filters.' : 'No orders yet for this shop.'}</p>
          )}
          {orders.data.map((order) => (
            <PartyOrderCard
              key={order.id}
              order={order}
              onEdit={(o) => {
                setEditing(o);
                setFormOpen(true);
              }}
              onDeleteRequest={setDeleteTarget}
              openWhatsApp={openWhatsApp}
              onUpdated={() => mutate()}
            />
          ))}
        </div>
        <Pagination page={orders.page} totalPages={orders.totalPages} total={orders.total} limit={orders.limit} onPageChange={setPage} />
      </div>

      {formOpen && (
        <PartyOrderFormModal
          editing={editing}
          initialShopId={shop.id}
          onClose={() => setFormOpen(false)}
          onSaved={() => mutate()}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Party Order"
          message={`Delete this order for ${deleteTarget.shopName}? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {forcePrompt && (
        <ConfirmDialog
          title="Force This Through?"
          message={`${forcePrompt.message}\n\nAs Super Admin you can force this through anyway - this permanently removes the connected production/stock history rather than just losing the link to it. This cannot be undone.`}
          confirmLabel="Force Through Anyway"
          danger
          onConfirm={forcePrompt.onForce}
          onCancel={closeForcePrompt}
        />
      )}

      {shopManagerOpen && (
        <ShopManagerModal
          onClose={() => setShopManagerOpen(false)}
          onChange={() => mutate()}
          initialSearch={shop.name}
          focusShopId={shop.id}
        />
      )}

      {showModal && whatsappOptions && (
        <WhatsAppModal
          onClose={closeWhatsApp}
          recipientInfo={{
            name: whatsappOptions.recipientName,
            phone: whatsappOptions.recipientPhone,
          }}
          defaultMessage={whatsappOptions.defaultMessage}
          defaultImageUrl={whatsappOptions.defaultImageUrl}
          pdfUrl={whatsappOptions.pdfUrl}
          pdfFilename={whatsappOptions.pdfFilename}
          autoAttachPdf={whatsappOptions.autoAttachPdf}
          messageVariants={whatsappOptions.messageVariants}
          defaultRecipientType={whatsappOptions.defaultRecipientType}
          onSuccess={() => mutate()}
        />
      )}
    </div>
  );
}

export default function ShopDashboardPage() {
  const { shopId } = useParams<{ shopId: string }>();
  return (
    <RoleGate minRole="ADMIN">
      <ShopDashboardContent shopId={shopId} />
    </RoleGate>
  );
}
