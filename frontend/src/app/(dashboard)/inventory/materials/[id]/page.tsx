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
import type { RawMaterialDetail, CarpenterWorkItem } from '@/types';

export default function MaterialDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasRole } = useAuth();
  // Recording a purchase/receipt now happens on the Suppliers ledger, so
  // stock and the supplier/financial record always stay in sync - this
  // page only links there. Issuing material against a work item stays open
  // to Carpenter/Polisher - that's the flow that lets Super Admin see how
  // much material each employee actually used. Stock Adjustment (damage/
  // wastage correction) is Admin-only.
  const canRecordPurchase = hasRole('ADMIN');
  const canIssue = hasRole('ADMIN', 'CARPENTER', 'CARVER', 'POLISHER');
  const canAdjust = hasRole('ADMIN');
  const canSeeCost = hasRole('ADMIN');
  const { data: material, isLoading, mutate } = useSWR<RawMaterialDetail>(`/raw-materials/${id}`, fetcher);
  // Open work items to issue material against - lets Super Admin see
  // exactly which employee (via the work item's assigned carpenter) took
  // how much of this material, instead of issues going unattributed.
  const { data: workItems } = useSWR<CarpenterWorkItem[]>(canIssue ? '/carpenter-work-items' : null, fetcher);
  const openWorkItems = (workItems ?? []).filter((w) => w.status !== 'COMPLETED');

  const [adjustForm, setAdjustForm] = useState({ date: new Date().toISOString().slice(0, 10), quantity: '', reason: '' });
  const [issueForm, setIssueForm] = useState({ date: new Date().toISOString().slice(0, 10), workItemId: '', quantity: '', reason: '' });
  const [error, setError] = useState<string | null>(null);

  async function submitIssue(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/raw-materials/issue', {
        workItemId: issueForm.workItemId,
        date: issueForm.date,
        reason: issueForm.reason || undefined,
        items: [{ rawMaterialId: id, quantity: parseFloat(issueForm.quantity) }],
      });
      setIssueForm({ date: new Date().toISOString().slice(0, 10), workItemId: '', quantity: '', reason: '' });
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record issue');
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

      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${canSeeCost ? 'lg:grid-cols-6' : 'lg:grid-cols-4'}`}>
        <StatCard label="In Stock" value={`${material.inStock} ${material.unit}`} />
        <StatCard label="Purchased" value={`${material.totalPurchased} ${material.unit}`} />
        <StatCard label="Consumed" value={`${material.totalConsumed} ${material.unit}`} />
        <StatCard label="Adjusted" value={`${material.totalAdjusted} ${material.unit}`} />
        {canSeeCost && (
          <>
            <StatCard label="Purchase Rate" value={formatCurrency(material.purchaseRate)} />
            <StatCard label="Stock Value" value={formatCurrency(material.stockValue)} />
          </>
        )}
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

      {(canRecordPurchase || canIssue || canAdjust) && (
        <div className="grid lg:grid-cols-2 gap-6">
          {canRecordPurchase && (
            <div className="card p-5">
              <h2 className="font-semibold text-brand-900 mb-3">Record a Purchase</h2>
              <p className="text-xs text-brand-400 mb-3">
                Purchases are recorded from a Purchase Order - supplier, price, and this material&apos;s stock update together once
                it&apos;s received.
              </p>
              <button className="btn-primary w-full" onClick={() => router.push(`/purchase-orders?materialId=${id}`)}>
                Record a purchase for this material &rarr; Purchase Orders
              </button>
            </div>
          )}

          {canIssue && (
            <div className="card p-5">
              <h2 className="font-semibold text-brand-900 mb-3">Issue Material (to a Work Item)</h2>
              <p className="text-xs text-brand-400 mb-2">
                Attributes this material to whichever employee is assigned to the work item, so Super Admin can see how much each
                employee has used.
              </p>
              <form onSubmit={submitIssue} className="space-y-2">
                <select
                  className="input"
                  required
                  value={issueForm.workItemId}
                  onChange={(e) => setIssueForm((f) => ({ ...f, workItemId: e.target.value }))}
                >
                  <option value="">Select work item...</option>
                  {openWorkItems.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.productName}
                      {w.modelNo ? ` (${w.modelNo})` : ''} - {w.carpenter?.name ?? 'Unassigned'} - {w.status}
                    </option>
                  ))}
                </select>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input type="date" className="input" required value={issueForm.date} onChange={(e) => setIssueForm((f) => ({ ...f, date: e.target.value }))} />
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    placeholder={`Quantity (${material.unit})`}
                    required
                    value={issueForm.quantity}
                    onChange={(e) => setIssueForm((f) => ({ ...f, quantity: e.target.value }))}
                  />
                </div>
                <input className="input" placeholder="Reason / reference (optional)" value={issueForm.reason} onChange={(e) => setIssueForm((f) => ({ ...f, reason: e.target.value }))} />
                <button type="submit" className="btn-primary w-full">
                  Record Issue
                </button>
              </form>
            </div>
          )}

          {canAdjust && (
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
          )}
        </div>
      )}
    </div>
  );
}
