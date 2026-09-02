'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { Modal } from './Modal';
import type { CarpenterSummary } from '@/types';

export interface AssignProductionPayload {
  carpenterId: string;
  workDate: string;
  category?: string;
  size?: string;
  price: number;
  extra?: number;
  quantity?: number;
  notifyWhatsapp?: boolean;
}

export function AssignProductionModal({
  productName,
  onClose,
  onSubmit,
}: {
  productName: string;
  onClose: () => void;
  onSubmit: (payload: AssignProductionPayload) => Promise<void>;
}) {
  const { data: carpenters } = useSWR<CarpenterSummary[]>('/carpenters', fetcher);
  const [carpenterId, setCarpenterId] = useState('');
  const [workDate, setWorkDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState('');
  const [size, setSize] = useState('');
  const [price, setPrice] = useState('');
  const [extra, setExtra] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [notify, setNotify] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit({
        carpenterId,
        workDate,
        category: category || undefined,
        size: size || undefined,
        price: parseFloat(price),
        extra: extra ? parseFloat(extra) : undefined,
        quantity: quantity ? parseInt(quantity, 10) : undefined,
        notifyWhatsapp: notify,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign production');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Assign to Production - ${productName}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="label">Assign to</label>
          <select className="input" required value={carpenterId} onChange={(e) => setCarpenterId(e.target.value)}>
            <option value="">Select worker</option>
            {carpenters?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.workerType})
              </option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Work Date</label>
            <input type="date" className="input" required value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
          </div>
          <div>
            <label className="label">Quantity</label>
            <input type="number" min="1" className="input" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Category</label>
            <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="BOTTOM COT" />
          </div>
          <div>
            <label className="label">Size</label>
            <input className="input" value={size} onChange={(e) => setSize(e.target.value)} placeholder="5FT" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Price (Rs.)</label>
            <input type="number" min="0" step="0.01" className="input" required value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div>
            <label className="label">Extra (Rs.)</label>
            <input type="number" min="0" step="0.01" className="input" value={extra} onChange={(e) => setExtra(e.target.value)} />
          </div>
        </div>
        <label className="flex items-center gap-2 text-sm text-brand-600">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Notify via WhatsApp (worker + team group, if configured)
        </label>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={submitting || !carpenterId} className="btn-primary">
            {submitting ? 'Assigning...' : 'Assign to Production'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
