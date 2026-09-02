'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate } from '@/lib/format';
import { StatCard } from '@/components/StatCard';
import { Chip } from '@/components/StatusBadge';
import type { RawMaterialDetail } from '@/types';

export default function MaterialDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasRole } = useAuth();
  const canEdit = hasRole('ADMIN');
  const { data: material, isLoading, mutate } = useSWR<RawMaterialDetail>(`/raw-materials/${id}`, fetcher);

  const [stockInForm, setStockInForm] = useState({ date: new Date().toISOString().slice(0, 10), quantity: '', unitCost: '', reason: '' });
  const [adjustForm, setAdjustForm] = useState({ date: new Date().toISOString().slice(0, 10), quantity: '', reason: '' });
  const [error, setError] = useState<string | null>(null);

  async function submitStockIn(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/raw-materials/stock-in', {
        rawMaterialId: id,
        date: stockInForm.date,
        quantity: parseFloat(stockInForm.quantity),
        unitCost: stockInForm.unitCost ? parseFloat(stockInForm.unitCost) : undefined,
        reason: stockInForm.reason || undefined,
      });
      setStockInForm({ date: new Date().toISOString().slice(0, 10), quantity: '', unitCost: '', reason: '' });
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record stock in');
    }
  }

  async function submitAdjustment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/raw-materials/stock-adjustment', {
        rawMaterialId: id,
        date: adjustForm.date,
        quantity: parseFloat(adjustForm.quantity),
        reason: adjustForm.reason,
      });
      setAdjustForm({ date: new Date().toISOString().slice(0, 10), quantity: '', reason: '' });
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record adjustment');
    }
  }

  if (isLoading || !material) return <p className="text-brand-400 text-sm">Loading material...</p>;

  return (
    <div className="space-y-6">
      <div>
        <button className="text-sm text-brand-500 hover:underline mb-2" onClick={() => router.push('/inventory')}>
          &larr; All materials
        </button>
        <h1 className="text-2xl font-bold text-brand-900">{material.name}</h1>
        <p className="text-sm text-brand-500">
          {material.type ?? 'Uncategorized'} &middot; Unit: {material.unit}
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="In Stock" value={`${material.inStock} ${material.unit}`} />
        <StatCard label="Purchase Rate" value={formatCurrency(material.purchaseRate)} />
        <StatCard label="Stock Value" value={formatCurrency(material.stockValue)} />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="card p-5">
        <h2 className="font-semibold text-brand-900 mb-3">Movement History</h2>
        <div className="max-h-80 overflow-y-auto rounded-lg border border-brand-100">
          <table className="table-shell">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Reference</th>
                <th>Reason</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {material.stockMovements.length === 0 && (
                <tr>
                  <td colSpan={6} className="text-center text-brand-400 py-4">
                    No movements recorded
                  </td>
                </tr>
              )}
              {material.stockMovements.map((m) => (
                <tr key={m.id}>
                  <td>{formatDate(m.date)}</td>
                  <td>
                    {m.type === 'IN' && <Chip color="green" label="Stock In" />}
                    {m.type === 'OUT' && <Chip color="amber" label="Issued" />}
                    {m.type === 'ADJUSTMENT' && <Chip color="blue" label="Adjustment" />}
                  </td>
                  <td className={m.quantity < 0 ? 'text-red-600' : 'text-emerald-600'}>
                    {m.quantity > 0 ? '+' : ''}
                    {m.quantity}
                  </td>
                  <td className="text-brand-500">
                    {m.workItem ? `Work: ${m.workItem.productName}${m.workItem.carpenter ? ` (${m.workItem.carpenter.name})` : ''}` : m.purchaseOrder ? `PO ${m.purchaseOrder.poNumber}` : '-'}
                  </td>
                  <td className="text-brand-500">{m.reason ?? '-'}</td>
                  <td>{m.createdBy?.name ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {canEdit && (
        <div className="grid lg:grid-cols-2 gap-6">
          <div className="card p-5">
            <h2 className="font-semibold text-brand-900 mb-3">Stock In (Purchase / Receipt)</h2>
            <form onSubmit={submitStockIn} className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input type="date" className="input" required value={stockInForm.date} onChange={(e) => setStockInForm((f) => ({ ...f, date: e.target.value }))} />
                <input type="number" step="0.01" className="input" placeholder={`Quantity (${material.unit})`} required value={stockInForm.quantity} onChange={(e) => setStockInForm((f) => ({ ...f, quantity: e.target.value }))} />
              </div>
              <input type="number" step="0.01" className="input" placeholder="Unit cost / purchase rate" value={stockInForm.unitCost} onChange={(e) => setStockInForm((f) => ({ ...f, unitCost: e.target.value }))} />
              <input className="input" placeholder="Reason / reference (optional)" value={stockInForm.reason} onChange={(e) => setStockInForm((f) => ({ ...f, reason: e.target.value }))} />
              <button type="submit" className="btn-primary w-full">
                Record Stock In
              </button>
            </form>
          </div>

          <div className="card p-5">
            <h2 className="font-semibold text-brand-900 mb-3">Stock Adjustment</h2>
            <p className="text-xs text-brand-400 mb-2">Use a negative quantity for damage/wastage, positive for a found surplus.</p>
            <form onSubmit={submitAdjustment} className="space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input type="date" className="input" required value={adjustForm.date} onChange={(e) => setAdjustForm((f) => ({ ...f, date: e.target.value }))} />
                <input type="number" step="0.01" className="input" placeholder="+/- quantity" required value={adjustForm.quantity} onChange={(e) => setAdjustForm((f) => ({ ...f, quantity: e.target.value }))} />
              </div>
              <input className="input" placeholder="Reason (required)" required value={adjustForm.reason} onChange={(e) => setAdjustForm((f) => ({ ...f, reason: e.target.value }))} />
              <button type="submit" className="btn-primary w-full">
                Record Adjustment
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
