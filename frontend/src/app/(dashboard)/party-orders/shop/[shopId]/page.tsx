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
import { SuccessTick } from '@/components/SuccessTick';
import { PartyOrderCard } from '@/components/PartyOrderCard';
import { RoleGate } from '@/components/RoleGate';
import { WhatsAppModal } from '@/components/WhatsAppModal';
import { useWhatsApp } from '@/hooks/useWhatsApp';
import { useForceable } from '@/hooks/useForceable';
import type { PartyOrder, ShopDashboardResult, ShopLedgerRow, ShopOrderLedgerRow, ShopSummary } from '@/types';
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
      {/* Long lists scroll inside the box (header stays visible) instead of
          stretching the page. */}
      <div className="max-h-[700px] overflow-auto">
        <table className="table-shell w-full [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10">
          <thead>
            <tr>
              <th>S.No</th>
              <th>Date</th>
              <th>Order</th>
              <th>Polish Colour</th>
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
                <td>{r.polishColor ?? 'Not specified'}</td>
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

// RIGHT side of the two-column report - the shop statement, in the same
// format as the Purchasing > Supplier page's Payment Ledger: every order
// (adds to what the shop owes) and every payment (reduces it), oldest
// first, with a running balance, filters, a total row, and Edit / Remove
// on payments. A payment is against the shop's overall balance - the
// backend splits it across the shop's orders (and re-splits on edit).
type ShopPaymentPayload = { date: string; amount: number; mode?: string; note?: string };
const PAY_MODES = ['CASH', 'UPI', 'GPAY', 'BANK TRANSFER'];
const emptyLedgerFilter = { q: '', kind: '', mode: '', from: '', to: '' };

function PaymentLedgerPanel({
  summary,
  ledger,
  orderLedger,
  canEdit,
  onAddPayment,
  onUpdatePayment,
  onRemovePayment,
}: {
  summary: ShopSummary;
  ledger: ShopDashboardResult['paymentLedger'];
  orderLedger: ShopDashboardResult['orderLedger'];
  canEdit: boolean;
  onAddPayment: (payload: ShopPaymentPayload) => Promise<void>;
  onUpdatePayment: (paymentIds: string[], payload: ShopPaymentPayload) => Promise<void>;
  onRemovePayment: (paymentIds: string[]) => Promise<void>;
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [voucherNo, setVoucherNo] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('CASH');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState(emptyLedgerFilter);
  const [editingKey, setEditingKey] = useState<string | null>(null);
  const [editForm, setEditForm] = useState({ date: '', voucherNo: '', amount: '', mode: 'CASH' });
  const [removeTarget, setRemoveTarget] = useState<ShopLedgerRow | null>(null);

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const numAmount = parseFloat(amount);
    if (!numAmount || numAmount <= 0) {
      setError('Enter a valid amount');
      return;
    }
    setSubmitting(true);
    try {
      await onAddPayment({ date, amount: numAmount, mode, note: voucherNo || undefined });
      setAmount('');
      setVoucherNo('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record payment');
    } finally {
      setSubmitting(false);
    }
  }

  async function saveEdit(p: ShopLedgerRow) {
    setError(null);
    const numAmount = parseFloat(editForm.amount);
    if (!numAmount || numAmount <= 0) {
      setError('Enter a valid amount');
      return;
    }
    try {
      await onUpdatePayment(p.paymentIds, { date: editForm.date, amount: numAmount, mode: editForm.mode, note: editForm.voucherNo || undefined });
      setEditingKey(null);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update payment');
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

  // Statement: orders add to the balance, payments reduce it - oldest
  // first, an order before a payment on the same day. The last balance
  // equals the Balance card above.
  type Row =
    | { kind: 'order'; key: string; date: string; ref: string; amount: number; order: ShopOrderLedgerRow; balance: number }
    | { kind: 'payment'; key: string; date: string; ref: string; amount: number; payment: ShopLedgerRow; balance: number };
  const statement: Row[] = [
    ...orderLedger.map((o) => ({ kind: 'order' as const, key: `o-${o.orderId}`, date: o.date, ref: o.ref ?? '-', amount: o.total, order: o, balance: 0 })),
    ...ledger.map((p) => ({ kind: 'payment' as const, key: `p-${p.paymentIds.join('.')}`, date: p.date, ref: p.voucherNo ?? '-', amount: p.amount, payment: p, balance: 0 })),
  ].sort((a, b) => a.date.slice(0, 10).localeCompare(b.date.slice(0, 10)) || (a.kind === b.kind ? 0 : a.kind === 'order' ? -1 : 1));
  let running = 0;
  for (const row of statement) {
    running += row.kind === 'order' ? row.amount : -row.amount;
    row.balance = Math.round(running * 100) / 100;
  }

  const norm = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();
  const modes = [...new Set(ledger.map((p) => norm(p.mode)).filter(Boolean))].sort();
  const filterOn = Object.values(filter).some(Boolean);
  const filtered = statement.filter((r) => {
    if (filter.q.trim()) {
      const q = norm(filter.q);
      const text = r.kind === 'order' ? `${r.ref} ${r.order.particulars}` : `${r.ref} ${r.payment.mode ?? ''}`;
      if (!norm(text).includes(q)) return false;
    }
    if (filter.kind && r.kind !== filter.kind) return false;
    if (filter.mode && (r.kind !== 'payment' || norm(r.payment.mode) !== filter.mode)) return false;
    const d = r.date.slice(0, 10);
    return (!filter.from || d >= filter.from) && (!filter.to || d <= filter.to);
  });
  const totalOrders = filtered.filter((r) => r.kind === 'order').reduce((t, r) => t + r.amount, 0);
  const totalPaid = filtered.filter((r) => r.kind === 'payment').reduce((t, r) => t + r.amount, 0);
  const cols = canEdit ? 8 : 7;

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-brand-100">
        <h2 className="font-semibold text-brand-900 whitespace-nowrap">Payment Ledger</h2>
      </div>
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-2 mb-2 text-sm">
        <input className="input !py-1.5 text-sm" placeholder="Ref No. / notes" value={filter.q} onChange={(e) => setFilter((f) => ({ ...f, q: e.target.value }))} />
        <select className="input !py-1.5 text-sm" value={filter.kind} onChange={(e) => setFilter((f) => ({ ...f, kind: e.target.value }))}>
          <option value="">All types</option>
          <option value="order">Order</option>
          <option value="payment">Payment</option>
        </select>
        <select className="input !py-1.5 text-sm" value={filter.mode} onChange={(e) => setFilter((f) => ({ ...f, mode: e.target.value }))}>
          <option value="">All modes</option>
          {modes.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
        <input type="date" className="input !py-1.5 text-sm" title="From date" value={filter.from} onChange={(e) => setFilter((f) => ({ ...f, from: e.target.value }))} />
        <input type="date" className="input !py-1.5 text-sm" title="To date" value={filter.to} onChange={(e) => setFilter((f) => ({ ...f, to: e.target.value }))} />
        <button type="button" className="btn-secondary text-xs" disabled={!filterOn} onClick={() => setFilter(emptyLedgerFilter)}>
          Clear filters
        </button>
      </div>
      <p className="text-xs text-ink-muted mb-2">{filterOn ? `Showing ${filtered.length} of ${statement.length}` : `${statement.length} entries`}</p>
      {error && <p className="text-xs text-red-600 mb-2">{error}</p>}
      <div className="max-h-[700px] overflow-y-auto pr-1">
        <div className="overflow-x-auto rounded-lg border border-brand-100 mb-4">
          <table className="table-shell text-sm [&_th]:!px-2 [&_td]:!px-2">
            <thead>
              <tr>
                <th>Date</th>
                <th>Txn Type</th>
                <th>Ref No.</th>
                <th className="!text-right">Total</th>
                <th className="!text-right">Paid</th>
                <th className="!text-right" title="Amount still owed on this order">Txn Bal.</th>
                <th className="!text-right" title="Total still owed by this shop after this entry">Balance</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {statement.length === 0 && (
                <tr>
                  <td colSpan={cols} className="text-center text-brand-400 py-4">
                    No orders or payments yet
                  </td>
                </tr>
              )}
              {filterOn && filtered.length === 0 && statement.length > 0 && (
                <tr>
                  <td colSpan={cols} className="text-center text-brand-400 py-4">
                    No entries match these filters
                  </td>
                </tr>
              )}
              {filtered.map((row) => {
                if (row.kind === 'order') {
                  return (
                    <tr key={row.key}>
                      <td className="whitespace-nowrap">{formatDate(row.date)}</td>
                      <td className="font-medium">
                        {row.order.status === 'CANCELLED' ? 'Order (Cancelled)' : 'Order'}
                        <div className="text-[11px] font-normal text-ink-muted max-w-[140px] truncate" title={row.order.particulars}>
                          {row.order.particulars}
                        </div>
                      </td>
                      <td className="whitespace-nowrap">
                        <Link href={`/party-orders/${row.order.orderId}`} className="text-brand-700 hover:underline">
                          {row.ref}
                        </Link>
                      </td>
                      <td className="text-right whitespace-nowrap">{formatCurrency(row.amount)}</td>
                      <td className="text-right whitespace-nowrap">{formatCurrency(0)}</td>
                      <td className="text-right whitespace-nowrap">{formatCurrency(row.order.balance)}</td>
                      <td className="text-right whitespace-nowrap font-medium">{formatCurrency(row.balance)}</td>
                      {canEdit && <td></td>}
                    </tr>
                  );
                }
                const p = row.payment;
                return editingKey === row.key ? (
                  <tr key={row.key} className="bg-blue-50">
                    <td>
                      <input type="date" className="input py-1 text-xs" value={editForm.date} onChange={(e) => setEditForm((f) => ({ ...f, date: e.target.value }))} />
                    </td>
                    <td>
                      <select className="input py-1 text-xs" value={editForm.mode} onChange={(e) => setEditForm((f) => ({ ...f, mode: e.target.value }))}>
                        {[...new Set([...PAY_MODES, editForm.mode])].map((m) => (
                          <option key={m}>{m}</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input className="input py-1 text-xs w-20" placeholder="V.No" value={editForm.voucherNo} onChange={(e) => setEditForm((f) => ({ ...f, voucherNo: e.target.value }))} />
                    </td>
                    <td colSpan={2}>
                      <input type="number" step="0.01" min="0.01" className="input py-1 text-xs w-28 ml-auto" value={editForm.amount} onChange={(e) => setEditForm((f) => ({ ...f, amount: e.target.value }))} />
                    </td>
                    <td></td>
                    <td></td>
                    <td className="whitespace-nowrap">
                      <button className="text-emerald-600 hover:text-emerald-800 text-xs mr-2" onClick={() => saveEdit(p)}>
                        Save
                      </button>
                      <button className="text-brand-400 hover:text-brand-600 text-xs" onClick={() => setEditingKey(null)}>
                        Cancel
                      </button>
                    </td>
                  </tr>
                ) : (
                  <tr key={row.key} className="bg-emerald-50/40">
                    <td className="whitespace-nowrap">{formatDate(row.date)}</td>
                    <td className="font-medium">
                      Payment
                      <div className="text-[11px] font-normal text-ink-muted">Payment Type: {p.mode ?? '-'}</div>
                    </td>
                    <td className="whitespace-nowrap">{row.ref}</td>
                    <td className="text-right whitespace-nowrap">{formatCurrency(row.amount)}</td>
                    <td className="text-right whitespace-nowrap text-emerald-700">{formatCurrency(row.amount)}</td>
                    <td></td>
                    <td className="text-right whitespace-nowrap font-medium">{formatCurrency(row.balance)}</td>
                    {canEdit && (
                      <td className="whitespace-nowrap">
                        <button
                          className="text-brand-600 hover:underline text-xs mr-2"
                          onClick={() => {
                            setError(null);
                            setEditingKey(row.key);
                            setEditForm({ date: p.date.slice(0, 10), voucherNo: p.voucherNo ?? '', amount: String(p.amount), mode: p.mode ?? 'CASH' });
                          }}
                        >
                          Edit
                        </button>
                        <button className="text-red-500 hover:text-red-700 text-xs" onClick={() => setRemoveTarget(p)}>
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                );
              })}
              {filtered.length > 0 && (
                <tr className="bg-brand-50 font-semibold">
                  <td></td>
                  <td>Total</td>
                  <td></td>
                  <td className="text-right whitespace-nowrap">{formatCurrency(totalOrders)}</td>
                  <td className="text-right whitespace-nowrap text-emerald-700">{formatCurrency(totalPaid)}</td>
                  <td></td>
                  <td className="text-right whitespace-nowrap">{!filterOn && formatCurrency(running)}</td>
                  {canEdit && <td></td>}
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <form onSubmit={handleAdd} className="space-y-2">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input type="date" className="input" required value={date} onChange={(e) => setDate(e.target.value)} />
              <input className="input" placeholder="Voucher No." value={voucherNo} onChange={(e) => setVoucherNo(e.target.value)} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input type="number" step="0.01" min="0.01" className="input" placeholder="Amount" required value={amount} onChange={(e) => setAmount(e.target.value)} />
              <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
                {PAY_MODES.map((m) => (
                  <option key={m}>{m}</option>
                ))}
              </select>
            </div>
            <button type="submit" disabled={submitting} className="btn-primary w-full">
              {submitting ? 'Recording...' : 'Record Payment'}
            </button>
          </form>
        )}
      </div>

      {removeTarget && (
        <ConfirmDialog
          title="Remove Payment"
          message={`Remove the payment of ${formatCurrency(removeTarget.amount)} on ${formatDate(removeTarget.date)}${removeTarget.voucherNo ? ` (V.No ${removeTarget.voucherNo})` : ''}? The shop's balance goes back up by this amount.`}
          confirmLabel="Remove"
          danger
          onConfirm={async () => {
            const target = removeTarget;
            setRemoveTarget(null);
            try {
              await onRemovePayment(target.paymentIds);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Failed to remove payment');
            }
          }}
          onCancel={() => setRemoveTarget(null)}
        />
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
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

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

  async function handleAddPayment(payload: ShopPaymentPayload) {
    await api.post(`/party-orders/shops-summary/${shopId}/payments`, payload);
    mutate();
    setSuccessMessage('Payment Recorded');
  }

  async function handleUpdatePayment(paymentIds: string[], payload: ShopPaymentPayload) {
    await api.patch(`/party-orders/shops-summary/${shopId}/payments`, { ...payload, paymentIds });
    mutate();
    setSuccessMessage('Payment Updated');
  }

  async function handleRemovePayment(paymentIds: string[]) {
    await api.post(`/party-orders/shops-summary/${shopId}/payments/remove`, { paymentIds });
    mutate();
  }

  if (isLoading && !dashboard) {
    return <p className="text-brand-400 text-sm">Loading shop...</p>;
  }

  if (!dashboard) {
    return <p className="text-brand-400 text-sm">Shop not found.</p>;
  }

  const { shop, overallSummary, filteredSummary, orders, items, paymentLedger, orderLedger } = dashboard;
  const hasFilters = Object.keys(applied).length > 0;

  return (
    <div className="space-y-6">
      {successMessage && <SuccessTick message={successMessage} onDone={() => setSuccessMessage(null)} />}
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
          orderLedger={orderLedger ?? []}
          canEdit={hasRole('ADMIN')}
          onAddPayment={handleAddPayment}
          onUpdatePayment={handleUpdatePayment}
          onRemovePayment={handleRemovePayment}
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
