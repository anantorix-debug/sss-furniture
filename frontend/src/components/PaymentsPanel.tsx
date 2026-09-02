'use client';

import { useMemo, useState } from 'react';
import { formatCurrency, formatDate } from '@/lib/format';
import { Chip, type ChipColor } from '@/components/StatusBadge';
import type { Payment, PaymentType } from '@/types';

const TYPE_LABEL: Record<PaymentType, string> = {
  ADVANCE: 'Advance',
  PARTIAL: 'Partial',
  BALANCE: 'Balance',
  FULL: 'Full',
};

const TYPE_CHIP: Record<PaymentType, ChipColor> = {
  ADVANCE: 'blue',
  PARTIAL: 'amber',
  BALANCE: 'green',
  FULL: 'darkGreen',
};

// Auto-suggest the same way the backend does, so the dropdown starts on
// the right value instead of always defaulting to one choice - first
// payment against the order is the Advance, one that clears the balance
// is the Balance (or Full if it's also the only one), else Partial.
function suggestType(totalAmount: number, totalReceived: number, payments: Payment[], newAmount: number): PaymentType {
  const isFirst = payments.length === 0;
  const willClear = totalReceived + newAmount >= totalAmount - 0.01;
  if (willClear) return isFirst ? 'FULL' : 'BALANCE';
  return isFirst ? 'ADVANCE' : 'PARTIAL';
}

export function PaymentsPanel({
  totalAmount,
  totalReceived,
  balanceAmount,
  payments,
  onAddPayment,
  onDeletePayment,
  canDelete,
  canAdd = true,
}: {
  totalAmount: number;
  totalReceived: number;
  balanceAmount: number;
  payments: Payment[];
  onAddPayment: (payload: { date: string; amount: number; type?: PaymentType; mode?: string; note?: string }) => Promise<void>;
  onDeletePayment?: (paymentId: string) => Promise<void>;
  canDelete?: boolean;
  canAdd?: boolean;
}) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<PaymentType | ''>('');
  const [mode, setMode] = useState('UPI');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const numAmount = parseFloat(amount) || 0;
  const autoType = useMemo(
    () => suggestType(totalAmount, totalReceived, payments, numAmount),
    [totalAmount, totalReceived, payments, numAmount],
  );

  async function handleAdd(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!numAmount || numAmount <= 0) {
      setError('Enter a valid amount');
      return;
    }
    setSubmitting(true);
    try {
      await onAddPayment({ date, amount: numAmount, type: type || autoType, mode, note: note || undefined });
      setAmount('');
      setType('');
      setNote('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to add payment');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="rounded-lg bg-brand-50 p-3">
          <p className="text-xs text-brand-500">Total</p>
          <p className="font-semibold text-brand-900">{formatCurrency(totalAmount)}</p>
        </div>
        <div className="rounded-lg bg-emerald-50 p-3">
          <p className="text-xs text-emerald-600">Received</p>
          <p className="font-semibold text-emerald-700">{formatCurrency(totalReceived)}</p>
        </div>
        <div className={`rounded-lg p-3 ${balanceAmount > 0 ? 'bg-red-50' : 'bg-emerald-50'}`}>
          <p className={`text-xs ${balanceAmount > 0 ? 'text-red-600' : 'text-emerald-600'}`}>Balance</p>
          <p className={`font-semibold ${balanceAmount > 0 ? 'text-red-700' : 'text-emerald-700'}`}>{formatCurrency(balanceAmount)}</p>
        </div>
      </div>

      <div className="max-h-48 overflow-y-auto rounded-lg border border-brand-100">
        <table className="table-shell">
          <thead>
            <tr>
              <th>Date</th>
              <th>Amount</th>
              <th>Type</th>
              <th>Mode</th>
              <th>Note</th>
              {canDelete && <th></th>}
            </tr>
          </thead>
          <tbody>
            {payments.length === 0 && (
              <tr>
                <td colSpan={canDelete ? 6 : 5} className="text-center text-brand-400 py-4">
                  No payments recorded yet
                </td>
              </tr>
            )}
            {payments.map((p) => (
              <tr key={p.id}>
                <td>{formatDate(p.date)}</td>
                <td className="font-medium">{formatCurrency(p.amount)}</td>
                <td>{p.type ? <Chip color={TYPE_CHIP[p.type]} label={TYPE_LABEL[p.type]} /> : '-'}</td>
                <td>{p.mode ?? '-'}</td>
                <td className="text-brand-500">{p.note ?? '-'}</td>
                {canDelete && (
                  <td>
                    <button className="text-red-500 hover:text-red-700 text-xs" onClick={() => onDeletePayment?.(p.id)}>
                      Remove
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {canAdd && (
        <form onSubmit={handleAdd} className="grid grid-cols-2 sm:grid-cols-5 gap-2 items-end">
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} required />
          </div>
          <div>
            <label className="label">Amount</label>
            <input type="number" min="0.01" step="0.01" className="input" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          <div>
            <label className="label">Type</label>
            <select className="input" value={type} onChange={(e) => setType(e.target.value as PaymentType | '')}>
              <option value="">Auto: {TYPE_LABEL[autoType]}</option>
              <option value="ADVANCE">Advance</option>
              <option value="PARTIAL">Partial</option>
              <option value="BALANCE">Balance</option>
              <option value="FULL">Full</option>
            </select>
          </div>
          <div>
            <label className="label">Mode</label>
            <select className="input" value={mode} onChange={(e) => setMode(e.target.value)}>
              <option>UPI</option>
              <option>CASH</option>
              <option>GPAY</option>
              <option>BANK TRANSFER</option>
            </select>
          </div>
          <button type="submit" disabled={submitting} className="btn-primary h-[38px]">
            {submitting ? 'Adding...' : 'Add'}
          </button>
          <div className="col-span-2 sm:col-span-5">
            <input type="text" placeholder="Note (optional)" className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </form>
      )}
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
