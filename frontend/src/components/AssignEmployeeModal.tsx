'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { Modal } from './Modal';
import type { User } from '@/types';

export function AssignEmployeeModal({
  title,
  onClose,
  onSubmit,
}: {
  title: string;
  onClose: () => void;
  onSubmit: (employeeId: string) => Promise<void>;
}) {
  // Reuses the existing (Superadmin-only) Users & Roles list rather than a
  // new endpoint - filtered here to the three production-side roles.
  const { data: users } = useSWR<User[]>('/users', fetcher);
  const employees = (users ?? []).filter((u) => u.role === 'CARPENTER' || u.role === 'CARVER' || u.role === 'POLISHER');

  const [employeeId, setEmployeeId] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(employeeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign employee');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="label">Production Employee</label>
          <select className="input" required value={employeeId} onChange={(e) => setEmployeeId(e.target.value)}>
            <option value="">Select employee</option>
            {employees.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name} ({u.role === 'CARPENTER' ? 'Carpenter Team' : u.role === 'CARVER' ? 'Carving Team' : 'Polish Team'})
              </option>
            ))}
          </select>
          <p className="text-xs text-brand-400 mt-1">
            The assigned employee will enter the Model No once production begins. You&apos;ll be notified when they save it.
          </p>
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={submitting || !employeeId} className="btn-primary">
            {submitting ? 'Assigning...' : 'Assign Employee'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
