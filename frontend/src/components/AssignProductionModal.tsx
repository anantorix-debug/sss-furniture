'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { Modal } from './Modal';
import { FormRow, FormField } from './orders/OrderFormFields';
import type { CarpenterSummary, User } from '@/types';

export interface AssignProductionPayload {
  carpenterId: string;
  stage?: 'CARPENTER' | 'CARVING' | 'POLISH';
  workDate: string;
  category?: string;
  price?: number;
  extra?: number;
  quantity?: number;
  notes?: string;
  notifyWhatsapp?: boolean;
  color?: string;
  employeeUserId?: string;
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
  initialColor,
  initialQuantity,
  // Opens a full WhatsApp chat/group picker (e.g. the shared WhatsAppModal)
  // for a one-off manual notification - the caller owns that modal since it
  // needs page-level WhatsApp context this component doesn't have.
  onOpenWhatsAppPicker,
  onClose,
  onSubmit,
}: {
  productName: string;
  currentStage?: 'CARPENTER' | 'CARVING' | 'POLISH';
  initialCategory?: string;
  initialColor?: string;
  initialQuantity?: number;
  onOpenWhatsAppPicker?: () => void;
  onClose: () => void;
  onSubmit: (payload: AssignProductionPayload) => Promise<void>;
}) {
  const { data: carpenters } = useSWR<CarpenterSummary[]>('/carpenters', fetcher);
  // Reuses the Users & Roles list (Superadmin-only), same source as the
  // standalone AssignEmployeeModal - filtered to the three production-side
  // roles. This is a login/Model-No permission, distinct from the
  // Assign Worker (Carpenter payee) field below.
  const { data: users } = useSWR<User[]>('/users', fetcher);
  const employees = (users ?? []).filter((u) => u.role === 'CARPENTER' || u.role === 'CARVER' || u.role === 'POLISHER');
  const [stage, setStage] = useState<'CARPENTER' | 'CARVING' | 'POLISH'>(currentStage ?? 'CARPENTER');
  const [carpenterId, setCarpenterId] = useState('');
  const [employeeUserId, setEmployeeUserId] = useState('');
  const [workDate, setWorkDate] = useState(new Date().toISOString().slice(0, 10));
  const [category, setCategory] = useState(initialCategory ?? '');
  const [price, setPrice] = useState('');
  const [extra, setExtra] = useState('');
  const [quantity, setQuantity] = useState(initialQuantity ? String(initialQuantity) : '1');
  const [color, setColor] = useState(initialColor ?? '');
  const [notes, setNotes] = useState('');
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
        price: price ? parseFloat(price) : undefined,
        extra: extra ? parseFloat(extra) : undefined,
        quantity: quantity ? parseInt(quantity, 10) : undefined,
        notes: notes || undefined,
        // Always notified by default (worker + team group, if configured) -
        // the picker below is for an additional one-off manual send, not a
        // replacement toggle.
        notifyWhatsapp: true,
        color: stage === 'POLISH' ? color.trim() : undefined,
        employeeUserId: employeeUserId || undefined,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign production');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Assign to Production - ${productName}`} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <FormRow>
          <FormField label="Stage">
            <select className="input" value={stage} onChange={(e) => setStage(e.target.value as typeof stage)}>
              <option value="CARPENTER">Carpenter</option>
              <option value="CARVING">Carving</option>
              <option value="POLISH">Polish</option>
            </select>
          </FormField>
          <FormField label="Assign Worker (paid for this stage)">
            <select className="input" required value={carpenterId} onChange={(e) => setCarpenterId(e.target.value)}>
              <option value="">Select worker</option>
              {carpenters?.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name} ({c.team?.name ?? c.workerType})
                </option>
              ))}
            </select>
          </FormField>
        </FormRow>

        <FormField label="Assign Employee (responsible for Model No)" full>
          <select className="input" value={employeeUserId} onChange={(e) => setEmployeeUserId(e.target.value)}>
            <option value="">Not set / leave as-is</option>
            {employees.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role === 'CARPENTER' ? 'Carpenter Team' : u.role === 'CARVER' ? 'Carving Team' : 'Polish Team'})
              </option>
            ))}
          </select>
          <p className="text-[11px] text-brand-400 mt-1">
            This login enters the Model No once production begins - separate from the worker above, who&apos;s paid for this stage.
          </p>
        </FormField>

        <FormRow>
          <FormField label="Work Date">
            <input type="date" className="input" required value={workDate} onChange={(e) => setWorkDate(e.target.value)} />
          </FormField>
          <FormField label="Quantity">
            <input type="number" min="1" className="input" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </FormField>
        </FormRow>

        <FormField label="Category">
          <input className="input" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="BOTTOM COT" />
        </FormField>

        {stage === 'POLISH' && (
          <FormField label="Colour (required for Polish)" full>
            <input
              className="input"
              required
              value={color}
              onChange={(e) => setColor(e.target.value)}
              placeholder="e.g. Walnut Brown"
            />
            <p className="text-[11px] text-brand-400 mt-1">Shown to the polish worker so they know what colour to use.</p>
          </FormField>
        )}

        <FormRow>
          <FormField label="Price (Rs.) - optional">
            <input type="number" min="0" step="0.01" className="input" value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Fill in later at week-end review" />
          </FormField>
          <FormField label="Extra (Rs.) - optional">
            <input type="number" min="0" step="0.01" className="input" value={extra} onChange={(e) => setExtra(e.target.value)} />
          </FormField>
        </FormRow>

        <FormField label="Notes (optional)" full>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Any instructions for this stage" />
        </FormField>

        {onOpenWhatsAppPicker && (
          <div className="border-t border-brand-100 pt-3">
            <button type="button" className="btn-secondary text-sm" onClick={onOpenWhatsAppPicker}>
              📱 Send via WhatsApp...
            </button>
            <p className="text-[11px] text-brand-400 mt-1">
              The worker and their team group are notified automatically - use this to also notify a specific chat or group.
            </p>
          </div>
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
