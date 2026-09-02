'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate } from '@/lib/format';
import { StatCard } from '@/components/StatCard';
import { RoleGate } from '@/components/RoleGate';
import { UnitSelect } from '@/components/UnitSelect';
import type { SupplierDetail, SupplierPurchase, SupplierPayment } from '@/types';

const emptyPurchaseForm = { date: new Date().toISOString().slice(0, 10), particulars: '', qty: '', unit: '', price: '', value: '' };
const emptyPaymentForm = { date: new Date().toISOString().slice(0, 10), particulars: '', voucherNo: '', amount: '', mode: 'CASH' };

function SupplierDetailContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasRole } = useAuth();
  const { data: supplier, isLoading, mutate } = useSWR<SupplierDetail>(`/suppliers/${id}`, fetcher);

  const [purchaseForm, setPurchaseForm] = useState(emptyPurchaseForm);
  const [paymentForm, setPaymentForm] = useState(emptyPaymentForm);
  const [editingPurchaseId, setEditingPurchaseId] = useState<string | null>(null);
  const [editPurchaseForm, setEditPurchaseForm] = useState(emptyPurchaseForm);
  const [editingPaymentId, setEditingPaymentId] = useState<string | null>(null);
  const [editPaymentForm, setEditPaymentForm] = useState(emptyPaymentForm);
  const [error, setError] = useState<string | null>(null);
  const canEdit = hasRole('ADMIN');

  async function addPurchase(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/suppliers/${id}/purchases`, {
        date: purchaseForm.date,
        particulars: purchaseForm.particulars,
        qty: purchaseForm.qty ? parseFloat(purchaseForm.qty) : undefined,
        unit: purchaseForm.unit || undefined,
        price: purchaseForm.price ? parseFloat(purchaseForm.price) : undefined,
        // Server computes value from qty*price when both are present;
        // only send it manually for a lump-sum entry (no qty/price).
        value: purchaseForm.qty && purchaseForm.price ? undefined : parseFloat(purchaseForm.value),
      });
      setPurchaseForm(emptyPurchaseForm);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add purchase');
    }
  }

  function startEditPurchase(p: SupplierPurchase) {
    setEditingPurchaseId(p.id);
    setEditPurchaseForm({
      date: p.date.slice(0, 10),
      particulars: p.particulars,
      qty: p.qty != null ? String(p.qty) : '',
      unit: p.unit ?? '',
      price: p.price != null ? String(p.price) : '',
      value: String(p.value),
    });
  }

  async function saveEditPurchase(purchaseId: string) {
    setError(null);
    try {
      await api.patch(`/suppliers/${id}/purchases/${purchaseId}`, {
        date: editPurchaseForm.date,
        particulars: editPurchaseForm.particulars,
        qty: editPurchaseForm.qty ? parseFloat(editPurchaseForm.qty) : undefined,
        unit: editPurchaseForm.unit || undefined,
        price: editPurchaseForm.price ? parseFloat(editPurchaseForm.price) : undefined,
        value: editPurchaseForm.qty && editPurchaseForm.price ? undefined : parseFloat(editPurchaseForm.value),
      });
      setEditingPurchaseId(null);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update purchase');
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

  async function removePurchase(purchaseId: string) {
    await api.delete(`/suppliers/${id}/purchases/${purchaseId}`);
    mutate();
  }

  async function removePayment(paymentId: string) {
    await api.delete(`/suppliers/${id}/payments/${paymentId}`);
    mutate();
  }

  if (isLoading || !supplier) return <p className="text-brand-400 text-sm">Loading supplier ledger...</p>;

  return (
    <div className="space-y-6">
      <div>
        <button className="text-sm text-brand-500 hover:underline mb-2" onClick={() => router.push('/suppliers')}>
          &larr; All suppliers
        </button>
        <h1 className="text-2xl font-bold text-brand-900">{supplier.name}</h1>
        {supplier.phone && <p className="text-sm text-brand-500">{supplier.phone}</p>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total Purchases" value={formatCurrency(supplier.totalPurchaseValue)} />
        <StatCard label="Total Paid" value={formatCurrency(supplier.totalPaid)} accent="success" />
        <StatCard label="Balance Payable" value={formatCurrency(supplier.balance)} accent="warning" />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="grid lg:grid-cols-2 gap-6">
        <div className="card p-5">
          <h2 className="font-semibold text-brand-900 mb-3">Purchase Material</h2>
          <div className="max-h-72 overflow-y-auto rounded-lg border border-brand-100 mb-4">
            <table className="table-shell">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Particulars</th>
                  <th>Qty</th>
                  <th>Unit</th>
                  <th>Price</th>
                  <th>Value</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {supplier.purchases.length === 0 && (
                  <tr>
                    <td colSpan={7} className="text-center text-brand-400 py-4">
                      No purchases recorded
                    </td>
                  </tr>
                )}
                {supplier.purchases.map((p) =>
                  editingPurchaseId === p.id ? (
                    <tr key={p.id} className="bg-blue-50">
                      <td><input type="date" className="input py-1 text-xs" value={editPurchaseForm.date} onChange={(e) => setEditPurchaseForm((f) => ({ ...f, date: e.target.value }))} /></td>
                      <td><input className="input py-1 text-xs" value={editPurchaseForm.particulars} onChange={(e) => setEditPurchaseForm((f) => ({ ...f, particulars: e.target.value }))} /></td>
                      <td><input type="number" step="0.01" className="input py-1 text-xs w-16" value={editPurchaseForm.qty} onChange={(e) => setEditPurchaseForm((f) => ({ ...f, qty: e.target.value }))} /></td>
                      <td><UnitSelect id="edit-purchase-unit" className="input py-1 text-xs w-24" value={editPurchaseForm.unit} onChange={(v) => setEditPurchaseForm((f) => ({ ...f, unit: v }))} /></td>
                      <td><input type="number" step="0.01" className="input py-1 text-xs w-20" value={editPurchaseForm.price} onChange={(e) => setEditPurchaseForm((f) => ({ ...f, price: e.target.value }))} /></td>
                      <td><input type="number" step="0.01" className="input py-1 text-xs w-24" value={editPurchaseForm.value} onChange={(e) => setEditPurchaseForm((f) => ({ ...f, value: e.target.value }))} /></td>
                      <td className="whitespace-nowrap">
                        <button className="text-emerald-600 hover:text-emerald-800 text-xs mr-2" onClick={() => saveEditPurchase(p.id)}>Save</button>
                        <button className="text-brand-400 hover:text-brand-600 text-xs" onClick={() => setEditingPurchaseId(null)}>Cancel</button>
                      </td>
                    </tr>
                  ) : (
                    <tr key={p.id}>
                      <td>{formatDate(p.date)}</td>
                      <td>{p.particulars}</td>
                      <td>{p.qty ?? '-'}</td>
                      <td>{p.unit ?? '-'}</td>
                      <td>{p.price != null ? formatCurrency(p.price) : '-'}</td>
                      <td className="font-medium">{formatCurrency(p.value)}</td>
                      {canEdit && (
                        <td className="whitespace-nowrap">
                          <button className="text-brand-600 hover:underline text-xs mr-2" onClick={() => startEditPurchase(p)}>
                            Edit
                          </button>
                          <button className="text-red-500 hover:text-red-700 text-xs" onClick={() => removePurchase(p.id)}>
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
            <form onSubmit={addPurchase} className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input type="date" className="input" required value={purchaseForm.date} onChange={(e) => setPurchaseForm((f) => ({ ...f, date: e.target.value }))} />
                <input className="input" placeholder="Particulars" required value={purchaseForm.particulars} onChange={(e) => setPurchaseForm((f) => ({ ...f, particulars: e.target.value }))} />
              </div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                <input type="number" step="0.01" className="input" placeholder="Qty" value={purchaseForm.qty} onChange={(e) => setPurchaseForm((f) => ({ ...f, qty: e.target.value }))} />
                <UnitSelect id="new-purchase-unit" value={purchaseForm.unit} onChange={(v) => setPurchaseForm((f) => ({ ...f, unit: v }))} />
                <input type="number" step="0.01" className="input" placeholder="Price" value={purchaseForm.price} onChange={(e) => setPurchaseForm((f) => ({ ...f, price: e.target.value }))} />
                {purchaseForm.qty && purchaseForm.price ? (
                  <div className="input bg-brand-50 text-brand-700 font-medium flex items-center text-sm" title="Value = Qty x Price, calculated automatically">
                    {formatCurrency(parseFloat(purchaseForm.qty) * parseFloat(purchaseForm.price))}
                  </div>
                ) : (
                  <input type="number" step="0.01" className="input" placeholder="Value (no qty/price)" required value={purchaseForm.value} onChange={(e) => setPurchaseForm((f) => ({ ...f, value: e.target.value }))} />
                )}
              </div>
              <button type="submit" className="btn-primary w-full">
                Add Purchase Entry
              </button>
            </form>
          )}
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
