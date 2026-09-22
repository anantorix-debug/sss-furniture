'use client';

import { useId, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import type { CarpenterSummary, OrderWorkEntry } from '@/types';

// A staged-but-not-yet-saved entry, used only while creating a brand-new
// order (see the `orderId === undefined` branch below) - same shape as
// what the backend's create-work-entry endpoint accepts.
export interface StagedWorkEntry {
  workerName: string;
  workDescription?: string;
  workerPrice: number;
  extraPrice?: number;
  workDate: string;
}

// Manual, historical "who worked this order" log - lives directly inside
// the Customer/Party Order form (spec: no separate tab/page), shared
// between both since the shape and endpoints are identical apart from the
// base path. Each entry is add/remove only, same as a payment ledger row -
// never edited in place, so past entries stay a true historical record.
//
// Two modes:
// - orderId given (editing an existing order, or its read-only detail
//   view): entries live on the server, add/remove happens immediately.
// - orderId omitted (still on the "New Order" screen, nothing saved yet):
//   entries are staged locally in the parent form's own state
//   (pendingEntries/onPendingChange) and submitted to the server right
//   after the order itself is created - see handleSubmit in
//   customer-orders/page.tsx and PartyOrderFormModal.tsx.
export function OrderWorkEntriesPanel({
  basePath,
  orderId,
  pendingEntries,
  onPendingChange,
}: {
  basePath: 'customer-orders' | 'party-orders';
  orderId?: string;
  pendingEntries?: StagedWorkEntry[];
  onPendingChange?: (entries: StagedWorkEntry[]) => void;
}) {
  const isStaging = !orderId;
  const { data: liveEntries, mutate } = useSWR<OrderWorkEntry[]>(orderId ? `/${basePath}/${orderId}/work-entries` : null, fetcher);
  const staged = pendingEntries ?? [];
  // Existing production employees (Carpenter/Carver/Polisher), for a
  // dropdown-style suggestion list on Worker Name - stays free text so a
  // one-off helper not in the system can still be typed in directly.
  const { data: carpenters } = useSWR<CarpenterSummary[]>('/carpenters', fetcher);
  const workerNames = Array.from(new Set((carpenters ?? []).map((c) => c.name)));
  const workerNamesListId = useId();

  const [workerName, setWorkerName] = useState('');
  const [workDescription, setWorkDescription] = useState('');
  const [workerPrice, setWorkerPrice] = useState('');
  const [extraPrice, setExtraPrice] = useState('');
  const [workDate, setWorkDate] = useState(new Date().toISOString().slice(0, 10));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // This panel sits inside the order's own <form> (Customer/Party Order
  // edit form) - a nested <form> here would be invalid HTML, and clicking
  // its submit button ends up submitting the OUTER form instead (full page
  // reload). Plain div + a type="button" click handler avoids that
  // entirely, since this "Add" is its own immediate save anyway (in
  // orderId mode), not part of the order's own Save Changes.
  async function handleAdd() {
    setError(null);
    const price = parseFloat(workerPrice);
    if (!workerName.trim()) {
      setError('Enter the worker name');
      return;
    }
    if (!price || price < 0) {
      setError('Enter a valid worker price');
      return;
    }
    const entry: StagedWorkEntry = {
      workerName: workerName.trim(),
      workDescription: workDescription.trim() || undefined,
      workerPrice: price,
      extraPrice: extraPrice ? parseFloat(extraPrice) : undefined,
      workDate,
    };

    if (isStaging) {
      onPendingChange?.([...staged, entry]);
      setWorkerName('');
      setWorkDescription('');
      setWorkerPrice('');
      setExtraPrice('');
      return;
    }

    setSubmitting(true);
    try {
      await api.post(`/${basePath}/${orderId}/work-entries`, entry);
      setWorkerName('');
      setWorkDescription('');
      setWorkerPrice('');
      setExtraPrice('');
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add work entry');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleRemove(entryId: string) {
    await api.delete(`/${basePath}/${orderId}/work-entries/${entryId}`);
    mutate();
  }

  function handleRemoveStaged(idx: number) {
    onPendingChange?.(staged.filter((_, i) => i !== idx));
  }

  // These inputs are direct children of the order's own outer <form> now
  // (see the note on handleAdd above), so pressing Enter in one would
  // otherwise submit/save the WHOLE order - intercept it and add this
  // entry instead, which is what a user pressing Enter here actually means.
  function handleKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleAdd();
    }
  }

  return (
    <div className="border border-brand-100 rounded-lg overflow-hidden">
      <div className="px-4 py-3 border-b border-brand-100 bg-brand-50">
        <h3 className="text-sm font-semibold text-brand-900">Work Entries</h3>
        <p className="text-[11px] text-brand-500">
          {isStaging ? 'Add who worked on this order - saved together when you create it.' : 'Record of who worked on this order, and what it cost.'}
        </p>
      </div>
      <div className="max-h-64 overflow-y-auto overflow-x-auto">
        <table className="table-shell w-full">
          <thead>
            <tr>
              <th>Worker</th>
              <th>Work</th>
              <th className="text-right">Price</th>
              <th className="text-right">Extra</th>
              <th>Date</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isStaging ? (
              <>
                {staged.length === 0 && (
                  <tr>
                    <td colSpan={6} className="text-center text-brand-400 py-4 text-xs">
                      No work entries yet
                    </td>
                  </tr>
                )}
                {staged.map((e, idx) => (
                  <tr key={idx}>
                    <td className="font-medium">{e.workerName}</td>
                    <td className="text-brand-500">{e.workDescription || '-'}</td>
                    <td className="text-right">{formatCurrency(e.workerPrice)}</td>
                    <td className="text-right">{e.extraPrice ? formatCurrency(e.extraPrice) : '-'}</td>
                    <td className="whitespace-nowrap">{formatDate(e.workDate)}</td>
                    <td>
                      <button type="button" className="text-red-500 hover:text-red-700 text-xs" onClick={() => handleRemoveStaged(idx)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </>
            ) : (
              <>
                {(!liveEntries || liveEntries.length === 0) && (
                  <tr>
                    <td colSpan={6} className="text-center text-brand-400 py-4 text-xs">
                      No work entries yet
                    </td>
                  </tr>
                )}
                {liveEntries?.map((e) => (
                  <tr key={e.id}>
                    <td className="font-medium">{e.workerName}</td>
                    <td className="text-brand-500">{e.workDescription || '-'}</td>
                    <td className="text-right">{formatCurrency(e.workerPrice)}</td>
                    <td className="text-right">{e.extraPrice ? formatCurrency(e.extraPrice) : '-'}</td>
                    <td className="whitespace-nowrap">{formatDate(e.workDate)}</td>
                    <td>
                      <button type="button" className="text-red-500 hover:text-red-700 text-xs" onClick={() => handleRemove(e.id)}>
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </>
            )}
          </tbody>
        </table>
      </div>
      <div className="p-3 border-t border-brand-100 space-y-2">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
          <div>
            <input
              className="input text-sm"
              placeholder="Worker name"
              value={workerName}
              onChange={(e) => setWorkerName(e.target.value)}
              onKeyDown={handleKeyDown}
              list={workerNamesListId}
            />
            <datalist id={workerNamesListId}>
              {workerNames.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <input className="input text-sm" placeholder="Work performed (optional)" value={workDescription} onChange={(e) => setWorkDescription(e.target.value)} onKeyDown={handleKeyDown} />
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          <input type="number" step="0.01" min="0" className="input text-sm" placeholder="Worker price" value={workerPrice} onChange={(e) => setWorkerPrice(e.target.value)} onKeyDown={handleKeyDown} />
          <input type="number" step="0.01" min="0" className="input text-sm" placeholder="Extra price" value={extraPrice} onChange={(e) => setExtraPrice(e.target.value)} onKeyDown={handleKeyDown} />
          <input type="date" className="input text-sm" value={workDate} onChange={(e) => setWorkDate(e.target.value)} onKeyDown={handleKeyDown} />
          <button type="button" disabled={submitting} className="btn-secondary text-sm" onClick={handleAdd}>
            {submitting ? 'Adding...' : '+ Add'}
          </button>
        </div>
        {error && <p className="text-xs text-red-600">{error}</p>}
      </div>
    </div>
  );
}
