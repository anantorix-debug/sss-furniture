'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency } from '@/lib/format';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { BalanceBadge } from '@/components/StatusBadge';
import { RoleGate } from '@/components/RoleGate';
import { downloadCsv } from '@/lib/csv';
import { Pagination, type PaginatedResult } from '@/components/Pagination';
import type { SupplierSummary, RawMaterial } from '@/types';

const emptySupplierForm = { name: '', phone: '', address: '' };

function SuppliersContent() {
  const { hasRole } = useAuth();
  const router = useRouter();
  const searchParams = useSearchParams();
  // Deep-linked from a raw material's "Record a Purchase" button - pick (or
  // create) a supplier below to continue recording a purchase for it.
  const materialId = searchParams.get('materialId');
  const { data: linkedMaterial } = useSWR<RawMaterial>(materialId ? `/raw-materials/${materialId}` : null, fetcher);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data: result, isLoading, mutate } = useSWR<PaginatedResult<SupplierSummary>>(
    `/suppliers?${new URLSearchParams({ ...(search ? { search } : {}), page: String(page), limit: '20' })}`,
    fetcher,
  );
  const data = result?.data;
  function updateSearch(value: string) {
    setSearch(value);
    setPage(1);
  }
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<SupplierSummary | null>(null);
  const [form, setForm] = useState(emptySupplierForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<SupplierSummary | null>(null);

  function openCreate() {
    setEditing(null);
    setForm(emptySupplierForm);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(e: React.MouseEvent, s: SupplierSummary) {
    e.preventDefault();
    e.stopPropagation();
    setEditing(s);
    setForm({ name: s.name, phone: s.phone ?? '', address: s.address ?? '' });
    setError(null);
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = { name: form.name, phone: form.phone || undefined, address: form.address || undefined };
      if (editing) {
        await api.patch(`/suppliers/${editing.id}`, payload);
        setFormOpen(false);
        mutate();
      } else {
        const created = await api.post<SupplierSummary>('/suppliers', payload);
        setFormOpen(false);
        // Creating a supplier on the fly shouldn't lose the pre-selected
        // material - carry it straight through to the new supplier's page.
        router.push(materialId ? `/suppliers/${created.id}?materialId=${materialId}` : `/suppliers/${created.id}`);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save supplier');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    setError(null);
    try {
      await api.delete(`/suppliers/${deleteTarget.id}`);
      setDeleteTarget(null);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete supplier');
      setDeleteTarget(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">Suppliers</h1>
          <p className="text-sm text-brand-500 mt-1">Material purchase ledgers - Devi Ply Wood, Timber Hari, and more.</p>
        </div>
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            onClick={() =>
              downloadCsv(
                'suppliers',
                (data ?? []).map((s) => ({
                  Name: s.name,
                  Phone: s.phone ?? '',
                  Address: s.address ?? '',
                  'Total Purchases': s.totalPurchaseValue,
                  'Total Paid': s.totalPaid,
                  Balance: s.balance,
                })),
              )
            }
          >
            Export Excel
          </button>
          {hasRole('ADMIN') && (
            <button className="btn-primary" onClick={openCreate}>
              + New Supplier
            </button>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {materialId && (
        <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-sm text-amber-800">
          <span>
            Recording a purchase for <strong>{linkedMaterial?.name ?? '...'}</strong> - pick a supplier below, or create one, to
            continue.
          </span>
          <button className="text-amber-700 hover:underline text-xs shrink-0" onClick={() => router.push('/suppliers')}>
            Cancel
          </button>
        </div>
      )}

      <input
        className="input max-w-xs"
        placeholder="Search supplier name..."
        value={search}
        onChange={(e) => updateSearch(e.target.value)}
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading && <p className="text-brand-400 text-sm">Loading suppliers...</p>}
        {data?.map((s) => (
          <Link
            key={s.id}
            href={materialId ? `/suppliers/${s.id}?materialId=${materialId}` : `/suppliers/${s.id}`}
            className="card p-5 hover:shadow-md transition-shadow block"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-brand-900">{s.name}</p>
                {s.phone && <p className="text-xs text-brand-400">{s.phone}</p>}
              </div>
              <BalanceBadge amount={s.balance} />
            </div>
            <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
              <div>
                <p className="text-brand-400 text-xs">Purchases</p>
                <p className="font-medium">{formatCurrency(s.totalPurchaseValue)}</p>
              </div>
              <div>
                <p className="text-brand-400 text-xs">Paid</p>
                <p className="font-medium">{formatCurrency(s.totalPaid)}</p>
              </div>
              <div className="col-span-2 pt-2 border-t border-brand-100">
                <p className="text-brand-400 text-xs">Balance Payable</p>
                <p className={`font-semibold ${s.balance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatCurrency(s.balance)}</p>
              </div>
            </div>
            {hasRole('ADMIN') && (
              <div className="flex gap-3 mt-3 pt-3 border-t border-brand-100">
                <button className="text-brand-600 hover:underline text-xs" onClick={(e) => openEdit(e, s)}>
                  Edit
                </button>
                <button
                  className="text-red-500 hover:underline text-xs"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDeleteTarget(s);
                  }}
                >
                  Delete
                </button>
              </div>
            )}
          </Link>
        ))}
      </div>
      {result && (
        <Pagination page={result.page} totalPages={result.totalPages} total={result.total} limit={result.limit} onPageChange={setPage} />
      )}

      {formOpen && (
        <Modal title={editing ? `Edit ${editing.name}` : 'New Supplier'} onClose={() => setFormOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="label">Name</label>
              <input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </div>
            <div>
              <label className="label">Address</label>
              <input className="input" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Create'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Supplier"
          message={`Delete "${deleteTarget.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

export default function SuppliersPage() {
  return (
    <RoleGate minRole="ADMIN">
      <SuppliersContent />
    </RoleGate>
  );
}
