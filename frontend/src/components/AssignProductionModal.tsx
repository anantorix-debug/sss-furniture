'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { Modal } from './Modal';
import { UnitSelect } from './UnitSelect';
import type { CarpenterSummary } from '@/types';

export interface AssignProductionPayload {
  carpenterId: string;
  stage?: 'CARPENTER' | 'CARVING' | 'POLISH';
  workDate: string;
  category?: string;
  size?: string;
  sizeUnit?: string;
  price: number;
  extra?: number;
  quantity?: number;
  notes?: string;
  notifyWhatsapp?: boolean;
  color?: string;
}

// Unified "Assign to Production" - puts the order into production (creates
// the work item). Model No is entered directly by whoever's doing the
// Carpenter/Carving stage work (see My Work) - no separate "who's
// responsible for the Model No" pre-assignment needed.
export function AssignProductionModal({
  productName,
  currentStage,
  // Already known from the order/item this is being assigned for - shown
  // pre-filled instead of asking the Admin to retype what was already
  // entered on the New Order form. Still editable in case this stage needs
  // something different (e.g. a Category correction discovered during
  // production).
  initialCategory,
  initialSize,
  initialSizeUnit,
  initialColor,
  initialQuantity,
  // Opens a full WhatsApp chat/group picker (e.g. the shared WhatsAppModal)
  // for a one-off manual notification, in addition to the automatic
  // worker+team-group send below - the caller owns that modal since it
  // needs page-level WhatsApp context this component doesn't have.
  onOpenWhatsAppPicker,
  onClose,
  onSubmit,
}: {
  productName: string;
  currentStage?: 'CARPENTER' | 'CARVING' | 'POLISH';
  initialCategory?: string;
  initialSize?: string;
  initialSizeUnit?: string;
  initialColor?: string;
  initialQuantity?: number;
  onOpenWhatsAppPicker?: () => void;
  onClose: () => void;
  onSubmit: (payload: AssignProductionPayload) => Promise<void>;
}) {
  const { data: carpenters } = useSWR<CarpenterSummary[]>('/carpenters', fetcher);
  const [stage, setStage] = useState<'CARPENTER' | 'CARVING' | 'POLISH'>(currentStage ?? 'CARPENTER');
  const [carpenterId, setCarpenterId] = useState('');
  const [workDate, setWorkDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState(initialCategory ?? '');
  const [size, setSize] = useState(initialSize ?? '');
  const [sizeUnit, setSizeUnit] = useState(initialSizeUnit ?? '');
  const [price, setPrice] = useState('');
  const [extra, setExtra] = useState('');
  const [quantity, setQuantity] = useState(initialQuantity ? String(initialQuantity) : '1');
  const [color, setColor] = useState(initialColor ?? '');
  const [notes, setNotes] = useState('');
  const [notify, setNotify] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (stage === 'POLISH' && !color.trim()) {
      setError('Colour is required for the Polish stage, so the polish worker knows what colour to use.');
      return;
    }
    setSubmitting(true);
    try {
      await onSubmit({
        carpenterId,
        stage,
        workDate,
        category: category || undefined,
        size: size || undefined,
        sizeUnit: sizeUnit || undefined,
        price: parseFloat(price),
        extra: extra ? parseFloat(extra) : undefined,
        quantity: quantity ? parseInt(quantity, 10) : undefined,
        notes: notes || undefined,
        notifyWhatsapp: notify,
        color: stage === 'POLISH' ? color.trim() : undefined,
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
          <label className="label">Stage</label>
          <select className="input" value={stage} onChange={(e) => setStage(e.target.value as typeof stage)}>
            <option value="CARPENTER">Carpenter</option>
            <option value="CARVING">Carving</option>
            <option value="POLISH">Polish</option>
          </select>
        </div>
        <div>
          <label className="label">Assign Worker (paid for this stage)</label>
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
        <div className="grid grid-cols-3 gap-3">
          <div>
            <label className="label">Category</label>
            <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="BOTTOM COT" />
          </div>
          <div>
            <label className="label">Size</label>
            <input className="input" value={size} onChange={(e) => setSize(e.target.value)} placeholder="5" />
          </div>
          <div>
            <label className="label">Unit</label>
            <UnitSelect id="assign-production-size-unit" value={sizeUnit} onChange={setSizeUnit} />
          </div>
        </div>
        {stage === 'POLISH' && (
          <div>
            <label className="label">Colour (required for Polish)</label>
            <input
              className="input"
              required
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="e.g. Walnut Brown"
            />
            <p className="text-[11px] text-brand-400 mt-1">Shown to the polish worker so they know what colour to use.</p>
          </div>
        )}
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
        <div>
          <label className="label">Notes (optional)</label>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any instructions for this stage" />
        </div>
        <label className="flex items-center gap-2 text-sm text-brand-600">
          <input type="checkbox" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
          Notify via WhatsApp (worker + team group, if configured)
        </label>
        {onOpenWhatsAppPicker && (
          <button type="button" className="text-brand-600 text-xs hover:underline -mt-1" onClick={onOpenWhatsAppPicker}>
            Or choose a specific WhatsApp chat/group to notify...
          </button>
        )}
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
