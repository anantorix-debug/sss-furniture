'use client';

import { useEffect, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { Modal } from '@/components/Modal';
import type { Expense, ExpenseCategory, ExpenseReferenceType, ExpensePaymentMode, ExpenseScope, CarpenterSummary } from '@/types';

const emptyForm = {
  date: new Date().toISOString().slice(0, 10),
  referenceTypeId: '',
  voucherNumber: '',
  categoryId: '',
  particulars: '',
  amount: '',
  paymentModeId: '',
  scope: 'COMPANY' as ExpenseScope,
  paidBy: '',
  employeeId: '',
  vendorName: '',
  description: '',
  notes: '',
  tags: '',
};

export function ExpenseFormModal({
  editing,
  defaultScope,
  defaultCategoryId,
  onClose,
  onSaved,
}: {
  editing: Expense | null;
  defaultScope?: ExpenseScope;
  defaultCategoryId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: categories } = useSWR<ExpenseCategory[]>('/expense-config/categories', fetcher);
  const { data: referenceTypes } = useSWR<ExpenseReferenceType[]>('/expense-config/reference-types', fetcher);
  const { data: paymentModes } = useSWR<ExpensePaymentMode[]>('/expense-config/payment-modes', fetcher);
  const { data: employees } = useSWR<CarpenterSummary[]>('/carpenters', fetcher);

  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (editing) {
      setForm({
        date: editing.date.slice(0, 10),
        referenceTypeId: editing.referenceTypeId ?? '',
        voucherNumber: String(editing.voucherNumber),
        categoryId: editing.categoryId,
        particulars: editing.particulars,
        amount: String(editing.amount),
        paymentModeId: editing.paymentModeId,
        scope: editing.scope,
        paidBy: editing.paidBy ?? '',
        employeeId: editing.employeeId ?? '',
        vendorName: editing.vendorName ?? '',
        description: editing.description ?? '',
        notes: editing.notes ?? '',
        tags: editing.tags ?? '',
      });
    } else {
      setForm({ ...emptyForm, scope: defaultScope ?? 'COMPANY', categoryId: defaultCategoryId ?? '' });
    }
  }, [editing, defaultScope, defaultCategoryId]);

  // Selecting a category auto-suggests its configured reference code
  // (e.g. Purchase -> PUR), matching the spec's auto-suggest requirement -
  // still fully overridable via the Reference dropdown below it.
  function handleCategoryChange(categoryId: string) {
    const category = categories?.find((c) => c.id === categoryId);
    setForm((f) => ({
      ...f,
      categoryId,
      referenceTypeId: category?.defaultReferenceTypeId ?? f.referenceTypeId,
      scope: category?.scope ?? f.scope,
    }));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        date: form.date,
        referenceTypeId: form.referenceTypeId || undefined,
        voucherNumber: form.voucherNumber ? parseInt(form.voucherNumber, 10) : undefined,
        categoryId: form.categoryId,
        particulars: form.particulars,
        amount: parseFloat(form.amount),
        paymentModeId: form.paymentModeId,
        scope: form.scope,
        paidBy: form.paidBy || undefined,
        employeeId: form.employeeId || undefined,
        vendorName: form.vendorName || undefined,
        description: form.description || undefined,
        notes: form.notes || undefined,
        tags: form.tags || undefined,
      };
      if (editing) {
        await api.patch(`/expenses/${editing.id}`, payload);
      } else {
        await api.post('/expenses', payload);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save expense');
    } finally {
      setSubmitting(false);
    }
  }

  const selectedCategory = categories?.find((c) => c.id === form.categoryId);
  const scopeLocked = selectedCategory?.scope != null;

  return (
    <Modal title={editing ? `Edit Expense - Voucher #${editing.voucherNumber}` : '+ Add Expense'} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" required value={form.date} onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))} />
          </div>
          <div>
            <label className="label">Voucher No. {!editing && '(auto if blank)'}</label>
            <input
              type="number"
              min="1"
              className="input"
              placeholder="Auto"
              value={form.voucherNumber}
              onChange={(e) => setForm((f) => ({ ...f, voucherNumber: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Reference</label>
            <select className="input" value={form.referenceTypeId} onChange={(e) => setForm((f) => ({ ...f, referenceTypeId: e.target.value }))}>
              <option value="">-</option>
              {referenceTypes?.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.code} - {r.label}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Category</label>
            <select className="input" required value={form.categoryId} onChange={(e) => handleCategoryChange(e.target.value)}>
              <option value="">Select category</option>
              {categories?.filter((c) => c.isActive).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Expense Type</label>
            <select
              className="input"
              value={form.scope}
              disabled={scopeLocked}
              onChange={(e) => setForm((f) => ({ ...f, scope: e.target.value as ExpenseScope }))}
            >
              <option value="COMPANY">Company</option>
              <option value="PERSONAL">Personal</option>
            </select>
            {scopeLocked && <p className="text-[10px] text-brand-400 mt-1">Fixed by the selected category</p>}
          </div>
        </div>

        <div>
          <label className="label">Particulars</label>
          <input
            className="input"
            required
            placeholder="What the money was for, e.g. LOCAL MATTRESS"
            value={form.particulars}
            onChange={(e) => setForm((f) => ({ ...f, particulars: e.target.value }))}
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Amount (Debit)</label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              className="input"
              required
              value={form.amount}
              onChange={(e) => setForm((f) => ({ ...f, amount: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Payment Mode</label>
            <select className="input" required value={form.paymentModeId} onChange={(e) => setForm((f) => ({ ...f, paymentModeId: e.target.value }))}>
              <option value="">Select mode</option>
              {paymentModes?.filter((m) => m.isActive).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className="label">Paid By</label>
            <input className="input" value={form.paidBy} onChange={(e) => setForm((f) => ({ ...f, paidBy: e.target.value }))} />
          </div>
          <div>
            <label className="label">Employee (optional)</label>
            <select className="input" value={form.employeeId} onChange={(e) => setForm((f) => ({ ...f, employeeId: e.target.value }))}>
              <option value="">-</option>
              {employees?.map((emp) => (
                <option key={emp.id} value={emp.id}>
                  {emp.name}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Vendor / Payee</label>
            <input className="input" value={form.vendorName} onChange={(e) => setForm((f) => ({ ...f, vendorName: e.target.value }))} />
          </div>
        </div>

        <div>
          <label className="label">Notes</label>
          <textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))} />
        </div>

        <div>
          <label className="label">Tags (comma-separated)</label>
          <input className="input" placeholder="urgent, recurring" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Add Expense'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
