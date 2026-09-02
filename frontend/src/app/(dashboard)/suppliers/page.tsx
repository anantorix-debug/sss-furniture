'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency } from '@/lib/format';
import { Modal } from '@/components/Modal';
import { BalanceBadge } from '@/components/StatusBadge';
import { RoleGate } from '@/components/RoleGate';
import { downloadCsv } from '@/lib/csv';
import { Pagination, type PaginatedResult } from '@/components/Pagination';
import type { SupplierSummary } from '@/types';

function SuppliersContent() {
  const { hasRole } = useAuth();
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
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/suppliers', { name, phone: phone || undefined, address: address || undefined });
      setFormOpen(false);
      setName('');
      setPhone('');
      setAddress('');
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create supplier');
    } finally {
      setSubmitting(false);
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
            <button className="btn-primary" onClick={() => setFormOpen(true)}>
              + New Supplier
            </button>
          )}
        </div>
      </div>

      <input
        className="input max-w-xs"
        placeholder="Search supplier name..."
        value={search}
        onChange={(e) => updateSearch(e.target.value)}
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading && <p className="text-brand-400 text-sm">Loading suppliers...</p>}
        {data?.map((s) => (
          <Link key={s.id} href={`/suppliers/${s.id}`} className="card p-5 hover:shadow-md transition-shadow block">
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
          </Link>
        ))}
      </div>
      {result && (
        <Pagination page={result.page} totalPages={result.totalPages} total={result.total} limit={result.limit} onPageChange={setPage} />
      )}

      {formOpen && (
        <Modal title="New Supplier" onClose={() => setFormOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="label">Name</label>
              <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} />
            </div>
            <div>
              <label className="label">Address</label>
              <input className="input" value={address} onChange={(e) => setAddress(e.target.value)} />
            </div>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? 'Saving...' : 'Create'}
              </button>
            </div>
          </form>
        </Modal>
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
