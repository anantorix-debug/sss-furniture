'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate } from '@/lib/format';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { UpdateModelNoModal } from '@/components/UpdateModelNoModal';
import { TeamsManagerModal } from '@/components/TeamsManagerModal';
import { BalanceBadge, Chip, StatusBadge, type ChipColor } from '@/components/StatusBadge';
import type { CarpenterSummary, WorkerType, CustomerOrder, PartyOrder, User, ProductionTeam } from '@/types';
import { Pagination, type PaginatedResult } from '@/components/Pagination';

const emptyWorkerForm = { name: '', phone: '', workerType: 'CARPENTER' as WorkerType, userId: '', teamId: '' };

const WORKER_TYPE_LABEL: Record<WorkerType, string> = {
  CARPENTER: 'Carpenter',
  POLISHER: 'Polisher',
  CARVER: 'Carving Man',
};

const WORKER_TYPE_CHIP: Record<WorkerType, ChipColor> = {
  CARPENTER: 'blue',
  POLISHER: 'amber',
  CARVER: 'darkGreen',
};

const TABS: { value: WorkerType | ''; label: string }[] = [
  { value: '', label: 'All Workers' },
  { value: 'CARPENTER', label: 'Carpenters' },
  { value: 'POLISHER', label: 'Polishers' },
  { value: 'CARVER', label: 'Carving Men' },
];

export default function CarpentersPage() {
  const { user, hasRole } = useAuth();
  const [tab, setTab] = useState<WorkerType | ''>('');
  const [page, setPage] = useState(1);
  // Checked literally against the login's own role - Super Admin's usual
  // "bypasses every check" doesn't apply here. "My Assigned Orders" is
  // meaningless for Super Admin/Admin (they have no assignedEmployeeId
  // orders of their own), so it must not show for them just because
  // hasRole() always returns true for Super Admin.
  const isProductionEmployee = user?.role === 'CARPENTER' || user?.role === 'CARVER' || user?.role === 'POLISHER';
  const { data: result, isLoading, mutate } = useSWR<PaginatedResult<CarpenterSummary>>(
    `/carpenters?${new URLSearchParams({ ...(tab ? { workerType: tab } : {}), page: String(page), limit: '20' })}`,
    fetcher,
  );
  const data = result?.data;
  function updateTab(value: WorkerType | '') {
    setTab(value);
    setPage(1);
  }
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CarpenterSummary | null>(null);
  const [form, setForm] = useState(emptyWorkerForm);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<CarpenterSummary | null>(null);
  const [teamsManagerOpen, setTeamsManagerOpen] = useState(false);
  const { data: loginUsers } = useSWR<User[]>(formOpen && hasRole('SUPERADMIN') ? '/users' : null, fetcher);
  const productionLogins = (loginUsers ?? []).filter((u) => u.role === 'CARPENTER' || u.role === 'CARVER' || u.role === 'POLISHER');
  const { data: teams, mutate: mutateTeams } = useSWR<ProductionTeam[]>(formOpen ? `/production-teams?workerType=${form.workerType}` : null, fetcher);

  function openCreate() {
    setEditing(null);
    setForm(emptyWorkerForm);
    setError(null);
    setFormOpen(true);
  }

  function openEditWorker(w: CarpenterSummary) {
    setEditing(w);
    setForm({ name: w.name, phone: w.phone ?? '', workerType: w.workerType, userId: w.user?.id ?? '', teamId: w.team?.id ?? '' });
    setError(null);
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      if (editing) {
        // Always send userId/teamId explicitly (even when clearing back to
        // "none") so unlinking actually works, not just linking.
        await api.patch(`/carpenters/${editing.id}`, {
          name: form.name,
          phone: form.phone || undefined,
          workerType: form.workerType,
          userId: form.userId || null,
          teamId: form.teamId || null,
        });
      } else {
        await api.post('/carpenters', {
          name: form.name,
          phone: form.phone || undefined,
          workerType: form.workerType,
          userId: form.userId || undefined,
          teamId: form.teamId || undefined,
        });
      }
      setFormOpen(false);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save worker');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteWorker() {
    if (!deleteTarget) return;
    setError(null);
    try {
      await api.delete(`/carpenters/${deleteTarget.id}`);
      setDeleteTarget(null);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete worker');
      setDeleteTarget(null);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">{isProductionEmployee ? 'My Assigned Orders' : 'Production Workers'}</h1>
          <p className="text-sm text-brand-500 mt-1">
            {isProductionEmployee
              ? 'Orders assigned to you for Model No entry.'
              : 'Carpenters, Polishers and Carving Men. Assign work, track output value and payments. Work assignments notify by WhatsApp.'}
          </p>
        </div>
        {hasRole('ADMIN') && (
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={() => setTeamsManagerOpen(true)}>
              Manage Teams
            </button>
            <button className="btn-primary" onClick={openCreate}>
              + New Worker
            </button>
          </div>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      {isProductionEmployee ? (
        <MyAssignedOrders />
      ) : (
        <>
      <div className="flex gap-1 border-b border-brand-200">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => updateTab(t.value)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === t.value ? 'border-brand-700 text-brand-900' : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading && <p className="text-brand-400 text-sm">Loading workers...</p>}
        {!isLoading && data?.length === 0 && <p className="text-brand-400 text-sm">No workers in this category yet</p>}
        {data?.map((c) => (
          <Link
            key={c.id}
            href={`/carpenters/${c.id}`}
            className="card p-5 block hover:shadow-md transition-shadow"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-brand-900">{c.name}</p>
                {c.phone && <p className="text-xs text-brand-400">{c.phone}</p>}
              </div>
              {hasRole('ADMIN') && c.balance !== undefined && <BalanceBadge amount={c.balance} />}
            </div>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <Chip color={WORKER_TYPE_CHIP[c.workerType]} label={WORKER_TYPE_LABEL[c.workerType]} />
              {c.team && <span className="text-xs text-brand-500">{c.team.name}</span>}
            </div>
            <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
              <div>
                <p className="text-brand-400 text-xs">Work Items</p>
                <p className="font-medium">{c.workItemCount}</p>
              </div>
              {hasRole('ADMIN') && c.totalWorkValue !== undefined && (
                <div>
                  <p className="text-brand-400 text-xs">Work Value</p>
                  <p className="font-medium">{formatCurrency(c.totalWorkValue)}</p>
                </div>
              )}
              {hasRole('ADMIN') && c.balance !== undefined && (
                <div className="col-span-2 pt-2 border-t border-brand-100">
                  <p className="text-brand-400 text-xs">Balance Payable</p>
                  <p className={`font-semibold ${c.balance > 0 ? 'text-red-600' : 'text-emerald-600'}`}>{formatCurrency(c.balance)}</p>
                </div>
              )}
            </div>
            {hasRole('ADMIN') && (
              <div className="flex gap-3 mt-3 pt-3 border-t border-brand-100">
                <button
                  className="text-brand-600 hover:underline text-xs"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    openEditWorker(c);
                  }}
                >
                  Edit
                </button>
                <button
                  className="text-red-500 hover:underline text-xs"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setDeleteTarget(c);
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
        </>
      )}

      {formOpen && (
        <Modal title={editing ? `Edit ${editing.name}` : 'New Worker'} onClose={() => setFormOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="label">Name</label>
              <input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <label className="label">Worker Type</label>
              <select
                className="input"
                value={form.workerType}
                onChange={(e) => setForm((f) => ({ ...f, workerType: e.target.value as WorkerType, teamId: '' }))}
              >
                <option value="CARPENTER">Carpenter</option>
                <option value="POLISHER">Polisher</option>
                <option value="CARVER">Carving Man</option>
              </select>
            </div>
            <div>
              <label className="label">Team (optional)</label>
              <select className="input" value={form.teamId} onChange={(e) => setForm((f) => ({ ...f, teamId: e.target.value }))}>
                <option value="">No team / shared pool</option>
                {teams?.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.name}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">WhatsApp Phone</label>
              <input className="input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="9876543210" />
              <p className="text-xs text-brand-400 mt-1">Used to send work-assignment notifications via WhatsApp.</p>
            </div>
            <div>
              <label className="label">Linked Login (optional)</label>
              <select className="input" value={form.userId} onChange={(e) => setForm((f) => ({ ...f, userId: e.target.value }))}>
                <option value="">No app login</option>
                {productionLogins.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.name} ({u.role === 'CARPENTER' ? 'Carpenter Team' : u.role === 'CARVER' ? 'Carving Team' : 'Polish Team'})
                  </option>
                ))}
              </select>
              <p className="text-xs text-brand-400 mt-1">Links this payee to their own login so their jobs show up on their My Work page.</p>
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
          title="Delete Worker"
          message={`Delete "${deleteTarget.name}"? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDeleteWorker}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {teamsManagerOpen && (
        <TeamsManagerModal
          onClose={() => setTeamsManagerOpen(false)}
          onChange={() => {
            mutate();
            mutateTeams();
          }}
        />
      )}
    </div>
  );
}

// Production Employee Workspace: orders (Customer or Party) assigned to the
// logged-in Carpenter/Polisher user, with the one action they own - entering
// the Model No. Reuses the existing order list endpoints (already readable
// by any authenticated role) rather than adding new backend query params.
type ModelNoTarget = { type: 'customer'; order: CustomerOrder } | { type: 'party'; order: PartyOrder };

function MyAssignedOrders() {
  const { user } = useAuth();
  const { data: customerOrders, mutate: mutateCustomer } = useSWR<CustomerOrder[]>('/customer-orders', fetcher);
  const { data: partyOrders, mutate: mutateParty } = useSWR<PartyOrder[]>('/party-orders', fetcher);
  const [modelNoTarget, setModelNoTarget] = useState<ModelNoTarget | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const myCustomerOrders = (customerOrders ?? []).filter((o) => o.assignedEmployee?.id === user?.id);
  const myPartyOrders = (partyOrders ?? []).filter((o) => o.assignedEmployee?.id === user?.id);
  const totalAssigned = myCustomerOrders.length + myPartyOrders.length;

  async function saveModelNo(modelNo: string) {
    if (!modelNoTarget) return;
    if (modelNoTarget.type === 'customer') {
      await api.post(`/customer-orders/${modelNoTarget.order.id}/model-no`, { modelNo });
      mutateCustomer();
    } else {
      await api.post(`/party-orders/${modelNoTarget.order.id}/model-no`, { modelNo });
      mutateParty();
    }
    setNotice('Model No saved. Super Admin has been notified.');
    setModelNoTarget(null);
  }

  return (
    <div className="space-y-4">
      {notice && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{notice}</p>}
      {totalAssigned === 0 && <p className="text-brand-400 text-sm">No orders assigned to you yet.</p>}

      {myCustomerOrders.map((o) => (
        <div key={o.id} className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <Chip color="blue" label="Customer Order" />
            <StatusBadge status={o.deliveryStatus} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-brand-400 text-xs">Order</p>
              <p className="font-medium">{o.orderId}</p>
            </div>
            <div>
              <p className="text-brand-400 text-xs">Customer</p>
              <p className="font-medium">{o.customerName}</p>
            </div>
            <div>
              <p className="text-brand-400 text-xs">Product</p>
              <p className="font-medium">{o.product}</p>
            </div>
            <div>
              <p className="text-brand-400 text-xs">Order Date</p>
              <p className="font-medium">{formatDate(o.orderDate)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-brand-100">
            <div>
              <p className="text-brand-400 text-xs">Model No</p>
              <p className="font-semibold">{o.cotTrack || <span className="text-brand-400 italic font-normal">Not Updated</span>}</p>
            </div>
            <button className="btn-primary h-8 px-3 text-xs" onClick={() => setModelNoTarget({ type: 'customer', order: o })}>
              {o.cotTrack ? 'Update Model No' : 'Enter Model No'}
            </button>
          </div>
        </div>
      ))}

      {myPartyOrders.map((o) => (
        <div key={o.id} className="card p-5">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <Chip color="amber" label="Party Order" />
            <StatusBadge status={o.deliveryStatus} />
          </div>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <div>
              <p className="text-brand-400 text-xs">Shop</p>
              <p className="font-medium">{o.shopName}</p>
            </div>
            <div>
              <p className="text-brand-400 text-xs">Product</p>
              <p className="font-medium">{o.model}</p>
            </div>
            <div>
              <p className="text-brand-400 text-xs">Qty</p>
              <p className="font-medium">{o.qty}</p>
            </div>
            <div>
              <p className="text-brand-400 text-xs">Order Date</p>
              <p className="font-medium">{formatDate(o.orderDate)}</p>
            </div>
          </div>
          <div className="flex items-center justify-between mt-3 pt-3 border-t border-brand-100">
            <div>
              <p className="text-brand-400 text-xs">Model No</p>
              <p className="font-semibold">{o.cotNo || <span className="text-brand-400 italic font-normal">Not Updated</span>}</p>
            </div>
            <button className="btn-primary h-8 px-3 text-xs" onClick={() => setModelNoTarget({ type: 'party', order: o })}>
              {o.cotNo ? 'Update Model No' : 'Enter Model No'}
            </button>
          </div>
        </div>
      ))}

      {modelNoTarget && (
        <UpdateModelNoModal
          title={`${modelNoTarget.type === 'customer' ? 'Customer' : 'Party'} Order - Model No`}
          currentModelNo={modelNoTarget.type === 'customer' ? modelNoTarget.order.cotTrack : modelNoTarget.order.cotNo}
          onClose={() => setModelNoTarget(null)}
          onSubmit={saveModelNo}
        />
      )}
    </div>
  );
}
