'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError, getAccessToken } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate } from '@/lib/format';
import { StatCard } from '@/components/StatCard';
import { RoleGate } from '@/components/RoleGate';
import { Chip, type ChipColor } from '@/components/StatusBadge';
import { PURCHASE_ORDER_STATUS_LABEL } from '@/types';
import type { SupplierDetail, SupplierPayment, PurchaseOrder, PurchaseOrderStatus } from '@/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const emptyPaymentForm = { date: new Date().toISOString().slice(0, 10), particulars: '', voucherNo: '', amount: '', mode: 'CASH' };

const STATUS_CHIP: Record<PurchaseOrderStatus, ChipColor> = {
  DRAFT: 'gray',
  PENDING_APPROVAL: 'amber',
  REJECTED: 'red',
  APPROVED: 'blue',
  SENT_TO_SHOP: 'amber',
  PARTIALLY_RECEIVED: 'amber',
  RECEIVED: 'green',
  CANCELLED: 'red',
};

function SupplierDetailContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasRole } = useAuth();
  const { data: supplier, isLoading, mutate } = useSWR<SupplierDetail>(`/suppliers/${id}`, fetcher);
  // Every purchase for a supplier goes through a Purchase Order - this is a
  // read-only history, not another place to enter a purchase from. See
  // PurchaseOrdersController for the actual purchasing flow.
  const { data: purchaseOrders } = useSWR<PurchaseOrder[]>(`/purchase-orders?supplierId=${id}`, fetcher);

  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editPaymentForm, setEditPaymentForm] = useState(emptyPaymentForm);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const canEdit = hasRole('ADMIN');

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
        <button className="btn-secondary" onClick={downloadPdf} disabled={downloading}>
          {downloading ? 'Preparing...' : 'Download PDF'}
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total Purchases" value={formatCurrency(supplier.totalPurchaseValue)} />
        <StatCard label="Total Paid" value={formatCurrency(supplier.totalPaid)} accent="success" />
        <StatCard label="Balance Payable" value={formatCurrency(supplier.balance)} accent="warning" />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <div className="flex items-center justify-between mb-3">
            <h2 className="font-semibold text-brand-900">Purchase Orders</h2>
            <Link href="/purchase-orders" className="text-brand-600 hover:underline text-xs">
              + New Purchase Order
            </Link>
          </div>
          <div className="max-h-96 overflow-y-auto rounded-lg border border-brand-100">
            <table className="table-shell">
              <thead>
                <tr>
                  <th>PO Number</th>
                  <th>Date</th>
                  <th>Items</th>
                  <th>Total</th>
                  <th>Status</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {(!purchaseOrders || purchaseOrders.length === 0) && (
                  <tr>
                    <td colSpan={6} className="text-center text-brand-400 py-4">
                      No purchase orders yet
                    </td>
                  </tr>
                )}
                {purchaseOrders?.map((po) => (
                  <tr key={po.id}>
                    <td className="font-medium">{po.poNumber}</td>
                    <td>{formatDate(po.orderDate)}</td>
                    <td>{po.items.length}</td>
                    <td className="font-medium">{formatCurrency(po.totalValue)}</td>
                    <td>
                      <Chip color={STATUS_CHIP[po.status]} label={PURCHASE_ORDER_STATUS_LABEL[po.status]} />
                    </td>
                    <td>
                      <Link href={`/purchase-orders/${po.id}`} className="text-brand-600 hover:underline text-xs">
                        View
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card p-5">
          <h2 className="font-semibold text-brand-900 mb-3">Payment Ledger</h2>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-brand-100 mb-4">
            <table className="table-shell">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>V.No</th>
                  <th>Amount</th>
                  <th>Balance</th>
                  <th>Mode</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {supplier.payments.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-brand-400 py-4">
                      No payments recorded
                    </td>
                  </tr>
                )}
                {supplier.payments.map((p) =>
                  editingPaymentId === p.id ? (
                    <tr key={p.id} className="bg-blue-50">
                      <td><input type="date" className="input py-1 text-xs" value={editPaymentForm.date} onChange={(e) => setEditPaymentForm((f) => ({ ...f, date: e.target.value }))} /></td>
                      <td><input className="input py-1 text-xs w-20" value={editPaymentForm.voucherNo} onChange={(e) => setEditPaymentForm((f) => ({ ...f, voucherNo: e.target.value }))} /></td>
                      <td><input type="number" step="0.01" className="input py-1 text-xs w-24" value={editPaymentForm.amount} onChange={(e) => setEditPaymentForm((f) => ({ ...f, amount: e.target.value }))} /></td>
                      <td>-</td>
                      <td>
                        <select className="input py-1 text-xs" value={editPaymentForm.mode} onChange={(e) => setEditPaymentForm((f) => ({ ...f, mode: e.target.value }))}>
                          <option>CASH</option>
                          <option>GPAY</option>
                          <option>UPI</option>
                        </select>
                      </td>
                      <td className="whitespace-nowrap">
                        <button className="text-emerald-600 hover:text-emerald-800 text-xs mr-2" onClick={() => saveEditPayment(p.id)}>Save</button>
                        <button className="text-brand-400 hover:text-brand-600 text-xs" onClick={() => setEditingPaymentId(null)}>Cancel</button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={p.id}>
                      <td>{formatDate(p.date)}</td>
                      <td>{p.voucherNo ?? '-'}</td>
                      <td className="font-medium">{formatCurrency(p.amount)}</td>
                      <td>{p.balanceAfter != null ? formatCurrency(p.balanceAfter) : '-'}</td>
                      <td>{p.mode ?? '-'}</td>
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
                  ),
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
  );
}

export default function SupplierDetailPage() {
  return (
    <RoleGate minRole="ADMIN">
      <SupplierDetailContent />
    </RoleGate>
  );
}
