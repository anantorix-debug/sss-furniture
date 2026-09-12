'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { Modal } from './Modal';
import type { PurchaseOrder } from '@/types';

// The spec's exact receiving table: per line, Ordered / Previously Received
// / Remaining, with an editable "Receive Now" amount - lets a PO be
// received across several partial deliveries instead of all-or-nothing.
export function ReceivePurchaseOrderModal({
  po,
  onClose,
  onReceived,
}: {
  po: PurchaseOrder;
  onClose: () => void;
  onReceived: () => void;
}) {
  const [amounts, setAmounts] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function remaining(item: PurchaseOrder['items'][number]) {
    return Math.max(0, item.quantity - item.receivedQuantity);
  }

  function setAmount(itemId: string, value: string) {
    setAmounts((a) => ({ ...a, [itemId]: value }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const items = po.items
      .map((i) => ({ purchaseOrderItemId: i.id, receivedQuantity: parseFloat(amounts[i.id] || '0') }))
      .filter((i) => i.receivedQuantity > 0);
    if (items.length === 0) {
      setError('Enter a quantity to receive for at least one item');
      return;
    }
    setSubmitting(true);
    try {
      await api.post(`/purchase-orders/${po.id}/receive`, { items });
      onReceived();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to receive purchase order');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Receive ${po.poNumber}`} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-brand-400">
          Enter how much of each item actually arrived. You can receive less than the full order - the remaining
          balance stays open for a later delivery.
        </p>
        <div className="rounded-lg border border-brand-100 overflow-x-auto">
          <table className="table-shell">
            <thead>
              <tr>
                <th>Material</th>
                <th>Ordered</th>
                <th>Previously Received</th>
                <th>Remaining</th>
                <th>Receive Now</th>
              </tr>
            </thead>
            <tbody>
              {po.items.map((item) => {
                const left = remaining(item);
                return (
                  <tr key={item.id}>
                    <td className="font-medium">{item.rawMaterial?.name}</td>
                    <td>
                      {item.quantity} {item.rawMaterial?.unit}
                    </td>
                    <td className="text-brand-500">
                      {item.receivedQuantity} {item.rawMaterial?.unit}
                    </td>
                    <td className={left === 0 ? 'text-emerald-600' : 'text-amber-700'}>
                      {left} {item.rawMaterial?.unit}
                    </td>
                    <td>
                      <input
                        type="number"
                        min="0"
                        max={left}
                        step="0.01"
                        className="input text-sm w-28"
                        placeholder="0"
                        disabled={left === 0}
                        value={amounts[item.id] ?? ''}
                        onChange={(e) => setAmount(item.id, e.target.value)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn-primary bg-emerald-600 hover:bg-emerald-700">
            {submitting ? 'Receiving...' : 'Confirm Receipt'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
