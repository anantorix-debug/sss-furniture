'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError, getAccessToken, assetUrl } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate } from '@/lib/format';
import { StatCard } from '@/components/StatCard';
import { RoleGate } from '@/components/RoleGate';
import { Chip, type ChipColor } from '@/components/StatusBadge';
import { PurchaseFormModal } from '@/components/PurchaseFormModal';
import { WhatsAppModal } from '@/components/WhatsAppModal';
import { WhatsAppActionButton } from '@/components/WhatsAppActionButton';
import { useWhatsApp } from '@/hooks/useWhatsApp';
import { PURCHASE_STATUS_LABEL } from '@/types';
import type { SupplierDetail, SupplierPayment, Purchase, PurchaseStatus } from '@/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const emptyPaymentForm = { date: new Date().toISOString().slice(0, 10), particulars: '', voucherNo: '', amount: '', mode: 'CASH' };

const STATUS_CHIP: Record<PurchaseStatus, ChipColor> = {
  PENDING_APPROVAL: 'amber',
  APPROVED: 'blue',
  RECORDED: 'green',
  CANCELLED: 'red',
};

// Shows material + quantity (whatever category the material is - Board
// Feet, Sheet, Nos, Litre, ...), not just a line count - same pattern as
// the Purchase Orders list's own items summary.
function purchaseItemsSummary(purchase: Purchase): string {
  if (purchase.items.length === 0) return '-';
  const first = purchase.items[0];
  const pieces = first.pieces != null ? `, ${first.pieces} pcs` : '';
  const firstText = `${first.rawMaterial?.name ?? 'Material'} (${first.quantity} ${first.rawMaterial?.unit ?? ''}${pieces})`;
  return purchase.items.length === 1 ? firstText : `${firstText} +${purchase.items.length - 1} more`;
}

function SupplierDetailContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasRole } = useAuth();
  const { data: supplier, isLoading, mutate } = useSWR<SupplierDetail>(`/suppliers/${id}`, fetcher);
  // Every purchase for a supplier immediately books stock + the ledger -
  // this is a read-only history, not another place to enter a purchase
  // from. See PurchasesController for the actual purchasing flow.
  const { data: purchases, mutate: mutatePurchases } = useSWR<Purchase[]>(`/purchase-orders?supplierId=${id}`, fetcher);

  // The New Purchase form is always visible now (no button-click toggle) -
  // bumping this key remounts it with blank fields after a save, or when
  // Cancel/x is clicked to reset an in-progress entry.
  const [purchaseFormKey, setPurchaseFormKey] = useState(0);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editPaymentForm, setEditPaymentForm] = useState(emptyPaymentForm);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  // Which section PDF (Purchases box / Payment Ledger) is being prepared.
  const [downloadingSection, setDownloadingSection] = useState<'purchases' | 'ledger' | null>(null);

  const emptyPurchaseFilter = { purchaseNo: '', q: '', status: '', from: '', to: '' };
  const [purchaseFilter, setPurchaseFilter] = useState(emptyPurchaseFilter);
  const emptyLedgerFilter = { q: '', kind: '', mode: '', from: '', to: '' };
  const [ledgerFilter, setLedgerFilter] = useState(emptyLedgerFilter);

  const canEdit = hasRole('ADMIN');
  const { showModal, whatsappOptions, openWhatsApp, closeWhatsApp } = useWhatsApp();

  // Same "auto-attach and let the sender pick the chat" pattern as the
  // Customer/Party Order PDFs - fetches this same statement PDF the
  // Download PDF button produces and pre-fills the supplier's own phone
  // number from the record, so nothing needs to be typed in manually.
  function handleSendPdfViaWhatsApp() {
    if (!supplier) return;
    openWhatsApp({
      recipientName: supplier.name || 'Supplier',
      recipientPhone: supplier.phone ?? undefined,
      defaultMessage: '',
      pdfUrl: `/suppliers/${id}/pdf`,
      pdfFilename: `${supplier.name}-detail.pdf`,
      autoAttachPdf: true,
    });
  }

  async function downloadPdf() {
    setDownloading(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${API_BASE_URL}/suppliers/${id}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${supplier?.name ?? 'supplier'}-detail.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  // Section PDFs - just the Purchases box or just the Payment Ledger
  // (party statement), separate from the full Download PDF above.
  async function downloadSectionPdf(section: 'purchases' | 'ledger') {
    setDownloadingSection(section);
    setError(null);
    try {
      const token = getAccessToken();
      const res = await fetch(`${API_BASE_URL}/suppliers/${id}/${section === 'ledger' ? 'ledger-pdf' : 'purchases-pdf'}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`Could not create the ${section === 'ledger' ? 'ledger' : 'purchases'} PDF`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${supplier?.name ?? 'supplier'}-${section}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the PDF');
    } finally {
      setDownloadingSection(null);
    }
  }

  async function addPayment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/suppliers/${id}/payments`, {
        date: paymentForm.date,
        particulars: paymentForm.particulars || undefined,
        voucherNo: paymentForm.voucherNo || undefined,
        amount: parseFloat(paymentForm.amount),
        mode: paymentForm.mode,
      });
      setPaymentForm(emptyPaymentForm);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add payment');
    }
  }

  function startEditPayment(p: SupplierPayment) {
    setEditingPaymentId(p.id);
    setEditPaymentForm({
      date: p.date.slice(0, 10),
      particulars: p.particulars ?? '',
      voucherNo: p.voucherNo ?? '',
      amount: String(p.amount),
      mode: p.mode ?? 'CASH',
    });
  }

  async function saveEditPayment(paymentId: string) {
    setError(null);
    try {
      await api.patch(`/suppliers/${id}/payments/${paymentId}`, {
        date: editPaymentForm.date,
        particulars: editPaymentForm.particulars || undefined,
        voucherNo: editPaymentForm.voucherNo || undefined,
        amount: parseFloat(editPaymentForm.amount),
        mode: editPaymentForm.mode,
      });
      setEditingPaymentId(null);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update payment');
    }
  }

  async function removePayment(paymentId: string) {
    await api.delete(`/suppliers/${id}/payments/${paymentId}`);
    mutate();
  }

  if (isLoading || !supplier) return <p className="text-brand-400 text-sm">Loading supplier ledger...</p>;

  // Oldest purchase first.
  const sortedPurchases = [...(purchases ?? [])].sort((a, b) => a.purchaseDate.localeCompare(b.purchaseDate) || a.purchaseNumber.localeCompare(b.purchaseNumber));

  // Party statement: every booked purchase (adds to what we owe) and every
  // payment (reduces it), oldest first, with a running payable balance - a
  // purchase sorts before a payment on the same day. Built from the same
  // ledger entries as the cards above, so the last balance always equals
  // "Balance Payable".
  type StatementRow =
    | { kind: 'purchase'; key: string; date: string; ref: string; amount: number; particulars: string; balance: number }
    | { kind: 'payment'; key: string; date: string; ref: string; amount: number; payment: SupplierPayment; balance: number };
  const statement: StatementRow[] = [
    ...supplier.purchases.map((p) => ({ kind: 'purchase' as const, key: `pu-${p.id}`, date: p.date, ref: p.purchase?.purchaseNumber ?? '-', amount: Number(p.value), particulars: p.particulars, balance: 0 })),
    ...supplier.payments.map((p) => ({ kind: 'payment' as const, key: `pa-${p.id}`, date: p.date, ref: p.voucherNo ?? '-', amount: Number(p.amount), payment: p, balance: 0 })),
  ].sort((a, b) => a.date.slice(0, 10).localeCompare(b.date.slice(0, 10)) || (a.kind === b.kind ? 0 : a.kind === 'purchase' ? -1 : 1));
  let runningBalance = 0;
  for (const row of statement) {
    runningBalance += row.kind === 'purchase' ? row.amount : -row.amount;
    row.balance = runningBalance;
  }
  const statementPurchased = statement.filter((r) => r.kind === 'purchase').reduce((s, r) => s + r.amount, 0);
  const statementPaid = statement.filter((r) => r.kind === 'payment').reduce((s, r) => s + r.amount, 0);

  const norm = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();
  const inDateRange = (d: string, from: string, to: string) => (!from || d.slice(0, 10) >= from) && (!to || d.slice(0, 10) <= to);

  const filteredPurchases = sortedPurchases.filter(p => {
    const f = purchaseFilter;
    if (f.purchaseNo.trim() && !norm(p.purchaseNumber).includes(norm(f.purchaseNo))) return false;
    if (f.q.trim()) {
      const q = norm(f.q);
      const itemsStr = p.items.map(i => `${i.rawMaterial?.name} ${i.quantity}`).join(' ');
      if (!itemsStr.toUpperCase().includes(q)) return false;
    }
    if (f.status && p.status !== f.status) return false;
    return inDateRange(p.purchaseDate, f.from, f.to);
  });
  const purchaseFilterOn = Object.values(purchaseFilter).some(Boolean);
  const filteredPurchasesTotal = filteredPurchases.reduce((t, p) => t + Number(p.totalValue ?? 0), 0);

  const payModes = [...new Set(supplier.payments.map((p) => norm(p.mode)).filter(Boolean))].sort();

  const filteredStatement = statement.filter(r => {
    const f = ledgerFilter;
    if (f.q.trim() && !norm(r.ref).includes(norm(f.q)) && !norm(r.kind === 'purchase' ? r.particulars : (r.payment?.particulars || '')).includes(norm(f.q))) return false;
    if (f.kind && r.kind !== f.kind) return false;
    if (f.mode && r.kind === 'payment' && norm(r.payment.mode) !== f.mode) return false;
    if (f.mode && r.kind === 'purchase') return false;
    return inDateRange(r.date, f.from, f.to);
  });
  const ledgerFilterOn = Object.values(ledgerFilter).some(Boolean);
  const filteredStatementPurchased = filteredStatement.filter((r) => r.kind === 'purchase').reduce((s, r) => s + r.amount, 0);
  const filteredStatementPaid = filteredStatement.filter((r) => r.kind === 'payment').reduce((s, r) => s + r.amount, 0);

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <button className="text-sm text-brand-500 hover:underline mb-2" onClick={() => router.push('/suppliers')}>
            &larr; All suppliers
          </button>
          <h1 className="text-2xl font-bold text-brand-900">{supplier.name}</h1>
          {supplier.phone && <p className="text-sm text-brand-500">{supplier.phone}</p>}
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={downloadPdf} disabled={downloading}>
            {downloading ? 'Preparing...' : 'Download PDF'}
          </button>
          <WhatsAppActionButton
            recipientName={supplier.name || 'Supplier'}
            recipientPhone={supplier.phone ?? undefined}
            onClick={handleSendPdfViaWhatsApp}
            size="md"
          />
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total Purchases" value={formatCurrency(supplier.totalPurchaseValue)} />
        <StatCard label="Total Paid" value={formatCurrency(supplier.totalPaid)} accent="success" />
        <StatCard label="Balance Payable" value={formatCurrency(supplier.balance)} accent="warning" />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-brand-100">
            <h2 className="font-semibold text-brand-900">Purchases</h2>
            <button type="button" className="btn-secondary text-xs px-3 py-1.5" onClick={() => downloadSectionPdf('purchases')} disabled={downloadingSection !== null}>
              {downloadingSection === 'purchases' ? 'Preparing...' : 'Download Purchases PDF'}
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2 text-sm">
            <input className="input !py-1.5 text-sm" placeholder="Purchase No." value={purchaseFilter.purchaseNo} onChange={(e) => setPurchaseFilter((f) => ({ ...f, purchaseNo: e.target.value }))} />
            <input className="input !py-1.5 text-sm" placeholder="Items..." value={purchaseFilter.q} onChange={(e) => setPurchaseFilter((f) => ({ ...f, q: e.target.value }))} />
            <select className="input !py-1.5 text-sm" value={purchaseFilter.status} onChange={(e) => setPurchaseFilter((f) => ({ ...f, status: e.target.value }))}>
              <option value="">All statuses</option>
              {(Object.keys(PURCHASE_STATUS_LABEL) as PurchaseStatus[]).map((st) => (
                <option key={st} value={st}>{PURCHASE_STATUS_LABEL[st]}</option>
              ))}
            </select>
            <input type="date" className="input !py-1.5 text-sm" title="From date" value={purchaseFilter.from} onChange={(e) => setPurchaseFilter((f) => ({ ...f, from: e.target.value }))} />
            <input type="date" className="input !py-1.5 text-sm" title="To date" value={purchaseFilter.to} onChange={(e) => setPurchaseFilter((f) => ({ ...f, to: e.target.value }))} />
            <button type="button" className="btn-secondary text-xs" disabled={!purchaseFilterOn} onClick={() => setPurchaseFilter(emptyPurchaseFilter)}>
              Clear filters
            </button>
          </div>
          <p className="text-xs text-ink-muted mb-2">
            {purchaseFilterOn ? `Showing ${filteredPurchases.length} of ${sortedPurchases.length}` : `${sortedPurchases.length} purchases`}
            {' '}· Total <span className="font-semibold text-brand-900">{formatCurrency(filteredPurchasesTotal)}</span>
          </p>
          <div className="max-h-[700px] overflow-y-auto pr-1">
            <div className="overflow-x-auto rounded-lg border border-brand-100">
              <table className="table-shell">
                <thead>
                  <tr>
                    <th>Image</th>
                    <th>Purchase No</th>
                    <th>Date</th>
                    <th>Items</th>
                    <th>Total</th>
                    <th>Status</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {(!purchases || purchases.length === 0) && (
                    <tr>
                      <td colSpan={7} className="text-center text-brand-400 py-4">
                        No purchases yet
                      </td>
                    </tr>
                  )}
                  {purchaseFilterOn && filteredPurchases.length === 0 && purchases && purchases.length > 0 && (
                    <tr>
                      <td colSpan={7} className="text-center text-brand-400 py-4">
                        No purchases match these filters
                      </td>
                    </tr>
                  )}
                  {filteredPurchases.map((p) => (
                    <tr key={p.id}>
                      <td>
                        {p.referenceImage ? (
                          <img
                            src={assetUrl(p.referenceImage.url) ?? ''}
                            alt={p.referenceImage.fileName}
                            className="h-9 w-9 object-cover rounded-md border border-brand-200"
                          />
                        ) : (
                          <span className="text-brand-300 text-xs">-</span>
                        )}
                      </td>
                      <td className="font-medium">{p.purchaseNumber}</td>
                      <td>{formatDate(p.purchaseDate)}</td>
                      <td>{purchaseItemsSummary(p)}</td>
                      <td className="font-medium">{formatCurrency(p.totalValue)}</td>
                      <td>
                        <Chip color={STATUS_CHIP[p.status]} label={PURCHASE_STATUS_LABEL[p.status]} />
                      </td>
                      <td>
                        <Link href={`/purchase-orders/${p.id}`} className="text-brand-600 hover:underline text-xs">
                          View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-4">
              <PurchaseFormModal
                key={purchaseFormKey}
                editing={null}
                initialSupplierId={id}
                inline
                onClose={() => setPurchaseFormKey((k) => k + 1)}
                onSaved={() => {
                  mutatePurchases();
                  mutate();
                  setPurchaseFormKey((k) => k + 1);
                }}
              />
            </div>
          </div>
        </div>

        <div className="card p-5">
          <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-brand-100">
            <h2 className="font-semibold text-brand-900">Payment Ledger</h2>
            <button type="button" className="btn-secondary text-xs px-3 py-1.5" onClick={() => downloadSectionPdf('ledger')} disabled={downloadingSection !== null}>
              {downloadingSection === 'ledger' ? 'Preparing...' : 'Download Ledger PDF'}
            </button>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2 text-sm">
            <input className="input !py-1.5 text-sm" placeholder="Ref No. / notes" value={ledgerFilter.q} onChange={(e) => setLedgerFilter((f) => ({ ...f, q: e.target.value }))} />
            <select className="input !py-1.5 text-sm" value={ledgerFilter.kind} onChange={(e) => setLedgerFilter((f) => ({ ...f, kind: e.target.value }))}>
              <option value="">All types</option>
              <option value="purchase">Purchase</option>
              <option value="payment">Payment</option>
            </select>
            <select className="input !py-1.5 text-sm" value={ledgerFilter.mode} onChange={(e) => setLedgerFilter((f) => ({ ...f, mode: e.target.value }))}>
              <option value="">All modes</option>
              {payModes.map((m) => (
                <option key={m} value={m}>{m}</option>
              ))}
            </select>
            <input type="date" className="input !py-1.5 text-sm" title="From date" value={ledgerFilter.from} onChange={(e) => setLedgerFilter((f) => ({ ...f, from: e.target.value }))} />
            <input type="date" className="input !py-1.5 text-sm" title="To date" value={ledgerFilter.to} onChange={(e) => setLedgerFilter((f) => ({ ...f, to: e.target.value }))} />
            <button type="button" className="btn-secondary text-xs" disabled={!ledgerFilterOn} onClick={() => setLedgerFilter(emptyLedgerFilter)}>
              Clear filters
            </button>
          </div>
          <p className="text-xs text-ink-muted mb-2">
            {ledgerFilterOn ? `Showing ${filteredStatement.length} of ${statement.length}` : `${statement.length} entries`}
          </p>
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
                  <th className="!text-right" title="Amount still owed on this purchase">Txn Bal.</th>
                  <th className="!text-right" title="Total still payable to this supplier after this entry">Balance</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {statement.length === 0 && (
                  <tr>
                    <td colSpan={canEdit ? 8 : 7} className="text-center text-brand-400 py-4">
                      No purchases or payments yet
                    </td>
                  </tr>
                )}
                {ledgerFilterOn && filteredStatement.length === 0 && statement.length > 0 && (
                  <tr>
                    <td colSpan={canEdit ? 8 : 7} className="text-center text-brand-400 py-4">
                      No entries match these filters
                    </td>
                  </tr>
                )}
                {filteredStatement.map((row) => {
                  if (row.kind === 'purchase') {
                    return (
                      <tr key={row.key}>
                        <td className="whitespace-nowrap">{formatDate(row.date)}</td>
                        <td className="font-medium">
                          {row.amount < 0 ? 'Cancelled' : 'Purchase'}
                          <div className="text-[11px] font-normal text-ink-muted max-w-[120px] truncate" title={row.particulars}>
                            {row.particulars}
                          </div>
                        </td>
                        <td className="whitespace-nowrap">{row.ref}</td>
                        <td className="text-right whitespace-nowrap">{formatCurrency(row.amount)}</td>
                        <td className="text-right whitespace-nowrap">{formatCurrency(0)}</td>
                        <td className="text-right whitespace-nowrap">{formatCurrency(row.amount)}</td>
                        <td className="text-right whitespace-nowrap font-medium">{formatCurrency(row.balance)}</td>
                        {canEdit && <td></td>}
                      </tr>
                    );
                  }
                  const p = row.payment;
                  return editingPaymentId === p.id ? (
                    <tr key={row.key} className="bg-blue-50">
                      <td><input type="date" className="input py-1 text-xs" value={editPaymentForm.date} onChange={(e) => setEditPaymentForm((f) => ({ ...f, date: e.target.value }))} /></td>
                      <td>
                        <select className="input py-1 text-xs" value={editPaymentForm.mode} onChange={(e) => setEditPaymentForm((f) => ({ ...f, mode: e.target.value }))}>
                          <option>CASH</option>
                          <option>GPAY</option>
                          <option>UPI</option>
                        </select>
                      </td>
                      <td><input className="input py-1 text-xs w-20" placeholder="V.No" value={editPaymentForm.voucherNo} onChange={(e) => setEditPaymentForm((f) => ({ ...f, voucherNo: e.target.value }))} /></td>
                      <td colSpan={2}><input type="number" step="0.01" className="input py-1 text-xs w-28 ml-auto" value={editPaymentForm.amount} onChange={(e) => setEditPaymentForm((f) => ({ ...f, amount: e.target.value }))} /></td>
                      <td></td>
                      <td></td>
                      <td className="whitespace-nowrap">
                        <button className="text-emerald-600 hover:text-emerald-800 text-xs mr-2" onClick={() => saveEditPayment(p.id)}>Save</button>
                        <button className="text-brand-400 hover:text-brand-600 text-xs" onClick={() => setEditingPaymentId(null)}>Cancel</button>
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
                          <button className="text-brand-600 hover:underline text-xs mr-2" onClick={() => startEditPayment(p)}>
                            Edit
                          </button>
                          <button className="text-red-500 hover:text-red-700 text-xs" onClick={() => removePayment(p.id)}>
                            Remove
                          </button>
                        </td>
                      )}
                    </tr>
                  );
                })}
                {filteredStatement.length > 0 && (
                  <tr className="bg-brand-50 font-semibold">
                    <td></td>
                    <td>Total</td>
                    <td></td>
                    <td className="text-right whitespace-nowrap">{formatCurrency(filteredStatementPurchased)}</td>
                    <td className="text-right whitespace-nowrap text-emerald-700">{formatCurrency(filteredStatementPaid)}</td>
                    <td></td>
                    <td className="text-right whitespace-nowrap">
                      {!ledgerFilterOn && formatCurrency(runningBalance)}
                    </td>
                    {canEdit && <td></td>}
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          {canEdit && (
            <form onSubmit={addPayment} className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input type="date" className="input" required value={paymentForm.date} onChange={(e) => setPaymentForm((f) => ({ ...f, date: e.target.value }))} />
                <input className="input" placeholder="Voucher No." value={paymentForm.voucherNo} onChange={(e) => setPaymentForm((f) => ({ ...f, voucherNo: e.target.value }))} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input type="number" step="0.01" className="input" placeholder="Amount" required value={paymentForm.amount} onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))} />
                <select className="input" value={paymentForm.mode} onChange={(e) => setPaymentForm((f) => ({ ...f, mode: e.target.value }))}>
                  <option>CASH</option>
                  <option>GPAY</option>
                  <option>UPI</option>
                </select>
              </div>
              <button type="submit" className="btn-primary w-full">
                Record Payment
              </button>
            </form>
          )}
          </div>
        </div>
      </div>

      {showModal && whatsappOptions && (
        <WhatsAppModal
          onClose={closeWhatsApp}
          recipientInfo={{
            name: whatsappOptions.recipientName,
            phone: whatsappOptions.recipientPhone,
          }}
          defaultMessage={whatsappOptions.defaultMessage}
          pdfUrl={whatsappOptions.pdfUrl}
          pdfFilename={whatsappOptions.pdfFilename}
          autoAttachPdf={whatsappOptions.autoAttachPdf}
        />
      )}
    </div>
  );
}

export default function SupplierDetailPage() {
  return (
    <RoleGate minRole="ADMIN">
      <SupplierDetailContent />
    </RoleGate>
  );
}
