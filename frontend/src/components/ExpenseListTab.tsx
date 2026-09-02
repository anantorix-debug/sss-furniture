'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api } from '@/lib/api';
import { formatCurrency, formatDate } from '@/lib/format';
import { Chip, type ChipColor } from '@/components/StatusBadge';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Pagination, type PaginatedResult } from '@/components/Pagination';
import { ExpenseFormModal } from '@/components/ExpenseFormModal';
import { downloadCsv } from '@/lib/csv';
import type { Expense, ExpenseCategory, ExpensePaymentMode, ExpenseScope } from '@/types';

const SCOPE_CHIP: Record<ExpenseScope, ChipColor> = { COMPANY: 'blue', PERSONAL: 'darkGreen' };

// One shared table+filters+CRUD component reused for every list view (Overall,
// Purchase, Salary, Transport & Toll, Expense, Company Expense, Personal
// Expense) - each tab is just this component pre-scoped to a category or
// scope, rather than seven near-duplicate pages.
export function ExpenseListTab({
  title,
  description,
  categoryId,
  scope,
  exportName,
  onCreate,
}: {
  title: string;
  description: string;
  categoryId?: string;
  scope?: ExpenseScope;
  exportName: string;
  onCreate?: () => void;
}) {
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [paymentModeId, setPaymentModeId] = useState('');
  const [categoryFilter, setCategoryFilter] = useState(''); // only used on the Overall tab (categoryId prop absent)
  const [page, setPage] = useState(1);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<Expense | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Expense | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Expense | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const { data: paymentModes } = useSWR<ExpensePaymentMode[]>('/expense-config/payment-modes', fetcher);
  const { data: categories } = useSWR<ExpenseCategory[]>('/expense-config/categories', fetcher);

  const query = new URLSearchParams({
    ...(categoryId ? { categoryId } : {}),
    ...(!categoryId && categoryFilter ? { categoryId: categoryFilter } : {}),
    ...(scope ? { scope } : {}),
    ...(search ? { search } : {}),
    ...(dateFrom ? { dateFrom } : {}),
    ...(dateTo ? { dateTo } : {}),
    ...(paymentModeId ? { paymentModeId } : {}),
    status: showArchived ? 'ARCHIVED' : 'ACTIVE',
    page: String(page),
    limit: '20',
  });
  const { data: result, isLoading, mutate } = useSWR<PaginatedResult<Expense> & { totalAmount: number }>(
    `/expenses?${query}`,
    fetcher,
  );

  function resetPage() {
    setPage(1);
  }

  async function handleArchive() {
    if (!archiveTarget) return;
    await api.patch(`/expenses/${archiveTarget.id}/archive`);
    setArchiveTarget(null);
    mutate();
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await api.delete(`/expenses/${deleteTarget.id}`);
    setDeleteTarget(null);
    mutate();
  }

  async function handleDuplicate(id: string) {
    await api.post(`/expenses/${id}/duplicate`);
    mutate();
  }

  async function handleRestore(id: string) {
    await api.patch(`/expenses/${id}/restore`);
    mutate();
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold text-brand-900">{title}</h2>
          <p className="text-sm text-brand-500">{description}</p>
        </div>
        <button
          className="btn-secondary text-sm"
          onClick={() =>
            downloadCsv(
              exportName,
              (result?.data ?? []).map((e) => ({
                'S.No': e.voucherNumber,
                Date: formatDate(e.date),
                Ref: e.referenceType?.code ?? '',
                Category: e.category.name,
                Particulars: e.particulars,
                Mode: e.paymentMode.name,
                Debit: e.amount,
                Type: e.scope,
                'Paid By': e.paidBy ?? '',
                Status: e.status,
              })),
            )
          }
        >
          Export CSV
        </button>
      </div>

      <div className="card p-3">
        <div className="flex items-baseline justify-between">
          <p className="text-xs text-brand-500 uppercase tracking-wide">Total {title}</p>
          <p className="text-xl font-bold text-brand-900">{formatCurrency(result?.totalAmount ?? 0)}</p>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <input
          className="input max-w-[220px]"
          placeholder="Search particulars, vendor, notes..."
          value={search}
          onChange={(e) => { setSearch(e.target.value); resetPage(); }}
        />
        <input type="date" className="input max-w-[150px]" value={dateFrom} onChange={(e) => { setDateFrom(e.target.value); resetPage(); }} />
        <input type="date" className="input max-w-[150px]" value={dateTo} onChange={(e) => { setDateTo(e.target.value); resetPage(); }} />
        {!categoryId && (
          <select className="input max-w-[170px]" value={categoryFilter} onChange={(e) => { setCategoryFilter(e.target.value); resetPage(); }}>
            <option value="">All categories</option>
            {categories?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        )}
        <select className="input max-w-[160px]" value={paymentModeId} onChange={(e) => { setPaymentModeId(e.target.value); resetPage(); }}>
          <option value="">All payment modes</option>
          {paymentModes?.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
        <label className="flex items-center gap-1.5 text-xs text-brand-500 px-2">
          <input type="checkbox" checked={showArchived} onChange={(e) => { setShowArchived(e.target.checked); resetPage(); }} />
          Show archived
        </label>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-shell">
          <thead>
            <tr>
              <th>S.No</th>
              <th>Date</th>
              <th>Ref</th>
              <th>V</th>
              {!categoryId && <th>Category</th>}
              <th>Particulars</th>
              <th>Mode</th>
              <th>Debit</th>
              <th>Type</th>
              <th>Paid By</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={10} className="text-center py-8 text-brand-400">
                  Loading...
                </td>
              </tr>
            )}
            {!isLoading && result?.data.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center py-10">
                  <p className="text-brand-400 mb-3">No transactions recorded yet</p>
                  {onCreate && (
                    <button className="btn-primary text-sm" onClick={onCreate}>
                      + Add Expense
                    </button>
                  )}
                </td>
              </tr>
            )}
            {result?.data.map((e, i) => (
              <tr key={e.id} className={e.status === 'ARCHIVED' ? 'opacity-50' : ''}>
                <td>{(result.page - 1) * result.limit + i + 1}</td>
                <td>{formatDate(e.date)}</td>
                <td>{e.referenceType?.code ?? '-'}</td>
                <td className="font-mono text-xs">{e.voucherNumber}</td>
                {!categoryId && <td>{e.category.name}</td>}
                <td className="max-w-[220px] truncate" title={e.particulars}>{e.particulars}</td>
                <td>{e.paymentMode.name}</td>
                <td className="font-medium">{formatCurrency(e.amount)}</td>
                <td><Chip color={SCOPE_CHIP[e.scope]} label={e.scope === 'COMPANY' ? 'Company' : 'Personal'} /></td>
                <td className="text-brand-500">{e.paidBy ?? '-'}</td>
                <td className="whitespace-nowrap text-right">
                  {e.status === 'ARCHIVED' ? (
                    <button className="text-brand-600 hover:underline text-xs" onClick={() => handleRestore(e.id)}>
                      Restore
                    </button>
                  ) : (
                    <div className="flex gap-2 justify-end">
                      <button className="text-brand-600 hover:underline text-xs" onClick={() => { setEditing(e); setFormOpen(true); }}>
                        Edit
                      </button>
                      <button className="text-brand-400 hover:underline text-xs" onClick={() => handleDuplicate(e.id)}>
                        Duplicate
                      </button>
                      <button className="text-amber-600 hover:underline text-xs" onClick={() => setArchiveTarget(e)}>
                        Archive
                      </button>
                      <button className="text-red-500 hover:underline text-xs" onClick={() => setDeleteTarget(e)}>
                        Delete
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {result && result.totalPages > 1 && (
          <Pagination page={result.page} totalPages={result.totalPages} total={result.total} limit={result.limit} onPageChange={setPage} />
        )}
      </div>

      {formOpen && (
        <ExpenseFormModal
          editing={editing}
          defaultCategoryId={categoryId}
          defaultScope={scope}
          onClose={() => setFormOpen(false)}
          onSaved={() => { setFormOpen(false); mutate(); }}
        />
      )}

      {archiveTarget && (
        <ConfirmDialog
          title="Archive Expense"
          message={`Archive voucher #${archiveTarget.voucherNumber} (${archiveTarget.particulars})? It will be hidden from the default view but kept for the record.`}
          confirmLabel="Archive"
          onConfirm={handleArchive}
          onCancel={() => setArchiveTarget(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Expense"
          message={`Permanently delete voucher #${deleteTarget.voucherNumber} (${deleteTarget.particulars})? This cannot be undone - consider Archive instead if you might need it later.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
