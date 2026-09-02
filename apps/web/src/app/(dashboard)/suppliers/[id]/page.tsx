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
import type { SupplierDetail } from '@/types';

function SupplierDetailContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasRole } = useAuth();
  const { data: supplier, isLoading, mutate } = useSWR<SupplierDetail>(`/suppliers/${id}`, fetcher);

  const [purchaseForm, setPurchaseForm] = useState({ date: new Date().toISOString().slice(0, 10), particulars: '', qty: '', price: '', value: '' });
  const [paymentForm, setPaymentForm] = useState({ date: new Date().toISOString().slice(0, 10), particulars: '', voucherNo: '', amount: '', mode: 'CASH' });
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
        price: purchaseForm.price ? parseFloat(purchaseForm.price) : undefined,
        value: parseFloat(purchaseForm.value),
      });
      setPurchaseForm({ date: new Date().toISOString().slice(0, 10), particulars: '', qty: '', price: '', value: '' });
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add purchase');
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
      setPaymentForm({ date: new Date().toISOString().slice(0, 10), particulars: '', voucherNo: '', amount: '', mode: 'CASH' });
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add payment');
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
                  <th>Price</th>
                  <th>Value</th>
                  {canEdit && <th></th>}
                </tr>
              </thead>
              <tbody>
                {supplier.purchases.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-brand-400 py-4">
                      No purchases recorded
                    </td>
                  </tr>
                )}
                {supplier.purchases.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.date)}</td>
                    <td>{p.particulars}</td>
                    <td>{p.qty ?? '-'}</td>
                    <td>{p.price != null ? formatCurrency(p.price) : '-'}</td>
                    <td className="font-medium">{formatCurrency(p.value)}</td>
                    {canEdit && (
                      <td>
                        <button className="text-red-500 hover:text-red-700 text-xs" onClick={() => removePurchase(p.id)}>
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {canEdit && (
            <form onSubmit={addPurchase} className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input type="date" className="input" required value={purchaseForm.date} onChange={(e) => setPurchaseForm((f) => ({ ...f, date: e.target.value }))} />
                <input className="input" placeholder="Particulars" required value={purchaseForm.particulars} onChange={(e) => setPurchaseForm((f) => ({ ...f, particulars: e.target.value }))} />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                <input type="number" step="0.01" className="input" placeholder="Qty" value={purchaseForm.qty} onChange={(e) => setPurchaseForm((f) => ({ ...f, qty: e.target.value }))} />
                <input type="number" step="0.01" className="input" placeholder="Price" value={purchaseForm.price} onChange={(e) => setPurchaseForm((f) => ({ ...f, price: e.target.value }))} />
                <input type="number" step="0.01" className="input" placeholder="Value" required value={purchaseForm.value} onChange={(e) => setPurchaseForm((f) => ({ ...f, value: e.target.value }))} />
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
                {supplier.payments.map((p) => (
                  <tr key={p.id}>
                    <td>{formatDate(p.date)}</td>
                    <td>{p.voucherNo ?? '-'}</td>
                    <td className="font-medium">{formatCurrency(p.amount)}</td>
                    <td>{p.balanceAfter != null ? formatCurrency(p.balanceAfter) : '-'}</td>
                    <td>{p.mode ?? '-'}</td>
                    {canEdit && (
                      <td>
                        <button className="text-red-500 hover:text-red-700 text-xs" onClick={() => removePayment(p.id)}>
                          Remove
                        </button>
                      </td>
                    )}
                  </tr>
                ))}
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
