'use client';

import { useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { formatDate, toDateInputValue } from '@/lib/format';
import { ViewField } from './ViewField';
import { Chip, type ChipColor } from './StatusBadge';
import type { CarpenterWorkItem } from '@/types';

export const STAGE_CHIP: Record<string, ChipColor> = { CARPENTER: 'blue', CARVING: 'amber', POLISH: 'darkGreen' };
export const STATUS_CHIP: Record<string, ChipColor> = {
  ASSIGNED: 'gray',
  IN_PROGRESS: 'blue',
  QUALITY_CHECK: 'amber',
  REWORK: 'red',
  COMPLETED: 'green',
};

// One work item (one production stage on one order line) - Stage/Employee/
// Qty/dates/Status, with an inline Admin-only edit for the two dates.
// Shared by Customer Orders' "Who's Working On It" panel and Party Orders'
// Work Timeline popup so both look and behave identically.
export function WorkItemTimelineCard({
  workItem,
  canEditDates,
  onUpdated,
}: {
  workItem: CarpenterWorkItem;
  canEditDates: boolean;
  onUpdated: () => void;
}) {
  const [editingDates, setEditingDates] = useState(false);
  const [startedAt, setStartedAt] = useState(toDateInputValue(workItem.startedAt));
  const [finishedAt, setFinishedAt] = useState(toDateInputValue(workItem.finishedAt));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function startEdit() {
    setStartedAt(toDateInputValue(workItem.startedAt));
    setFinishedAt(toDateInputValue(workItem.finishedAt));
    setError(null);
    setEditingDates(true);
  }

  async function handleSave() {
    setError(null);
    setSaving(true);
    try {
      await api.patch(`/carpenter-work-items/${workItem.id}`, {
        startedAt: startedAt || undefined,
        finishedAt: finishedAt || undefined,
      });
      setEditingDates(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update dates');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-brand-100 rounded-lg p-3">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
        <ViewField label="Stage" value={<Chip color={STAGE_CHIP[workItem.stage] ?? 'gray'} label={workItem.stage} />} />
        <ViewField label="Employee" value={workItem.carpenter?.name ?? 'Unassigned'} />
        <ViewField label="Qty" value={String(workItem.quantity)} />
        {workItem.stage === 'POLISH' && <ViewField label="Colour" value={workItem.color ?? 'Not set'} />}
        {!editingDates && (
          <>
            <ViewField label="Work Started" value={workItem.startedAt ? formatDate(workItem.startedAt) : 'Not started yet'} />
            <ViewField
              label="Work Finished"
              value={workItem.finishedAt ? formatDate(workItem.finishedAt) : workItem.status === 'IN_PROGRESS' ? 'In progress' : 'Pending'}
            />
          </>
        )}
        <ViewField label="Status" value={<Chip color={STATUS_CHIP[workItem.status] ?? 'gray'} label={workItem.status.replace('_', ' ')} />} />
      </div>

      {canEditDates && !editingDates && (
        <button type="button" className="text-xs text-brand-500 hover:underline mt-2" onClick={startEdit}>
          Edit dates
        </button>
      )}

      {editingDates && (
        <div className="mt-3 pt-3 border-t border-brand-100 space-y-2">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Work Started</label>
              <input className="input" type="date" value={startedAt} onChange={(e) => setStartedAt(e.target.value)} />
            </div>
            <div>
              <label className="label">Work Finished</label>
              <input className="input" type="date" value={finishedAt} onChange={(e) => setFinishedAt(e.target.value)} />
            </div>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <div className="flex justify-end gap-2">
            <button type="button" className="btn-secondary text-xs h-7 px-2" onClick={() => setEditingDates(false)}>
              Cancel
            </button>
            <button type="button" disabled={saving} className="btn-primary text-xs h-7 px-2" onClick={handleSave}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
