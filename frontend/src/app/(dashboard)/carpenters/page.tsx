'use client';

import { useState } from 'react';
import useSWR from 'swr';
import Link from 'next/link';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate } from '@/lib/format';
import { Modal } from '@/components/Modal';
import { UpdateModelNoModal } from '@/components/UpdateModelNoModal';
import { BalanceBadge, Chip, StatusBadge, type ChipColor } from '@/components/StatusBadge';
import type { CarpenterSummary, WorkerType, CustomerOrder, PartyOrder } from '@/types';

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
  const { hasRole } = useAuth();
  const [tab, setTab] = useState<WorkerType | ''>('');
  const [showMine, setShowMine] = useState(false);
  const isProductionEmployee = hasRole('CARPENTER') || hasRole('POLISHER');
  const { data, isLoading, mutate } = useSWR<CarpenterSummary[]>(
    `/carpenters${tab ? `?workerType=${tab}` : ''}`,
    fetcher,
  );
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [workerType, setWorkerType] = useState<WorkerType>('CARPENTER');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await api.post('/carpenters', { name, phone: phone || undefined, workerType });
      setFormOpen(false);
      setName('');
      setPhone('');
      setWorkerType('CARPENTER');
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create worker');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">Production Workers</h1>
          <p className="text-sm text-brand-500 mt-1">
            Carpenters, Polishers and Carving Men. Assign work, track output value and payments. Work assignments notify by WhatsApp.
          </p>
        </div>
        {hasRole('ADMIN') && (
          <button className="btn-primary" onClick={() => setFormOpen(true)}>
            + New Worker
          </button>
        )}
      </div>

      {isProductionEmployee && (
        <div className="flex gap-1 border-b border-brand-200">
          <button
            onClick={() => setShowMine(false)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              !showMine ? 'border-brand-700 text-brand-900' : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            Workers
          </button>
          <button
            onClick={() => setShowMine(true)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              showMine ? 'border-brand-700 text-brand-900' : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            My Assigned Orders
          </button>
        </div>
      )}

      {isProductionEmployee && showMine ? (
        <MyAssignedOrders />
      ) : (
        <>
      <div className="flex gap-1 border-b border-brand-200">
        {TABS.map((t) => (
          <button
            key={t.value}
            onClick={() => setTab(t.value)}
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
            href={hasRole('ADMIN') ? `/carpenters/${c.id}` : '#'}
            className={`card p-5 block ${hasRole('ADMIN') ? 'hover:shadow-md transition-shadow' : 'cursor-default'}`}
            onClick={(e) => {
              if (!hasRole('ADMIN')) e.preventDefault();
            }}
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold text-brand-900">{c.name}</p>
                {c.phone && <p className="text-xs text-brand-400">{c.phone}</p>}
              </div>
              {hasRole('ADMIN') && c.balance !== undefined && <BalanceBadge amount={c.balance} />}
            </div>
            <div className="mt-2">
              <Chip color={WORKER_TYPE_CHIP[c.workerType]} label={WORKER_TYPE_LABEL[c.workerType]} />
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
          </Link>
        ))}
      </div>
        </>
      )}

      {formOpen && (
        <Modal title="New Worker" onClose={() => setFormOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="label">Name</label>
              <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label">Worker Type</label>
              <select className="input" value={workerType} onChange={(e) => setWorkerType(e.target.value as WorkerType)}>
                <option value="CARPENTER">Carpenter</option>
                <option value="POLISHER">Polisher</option>
                <option value="CARVER">Carving Man</option>
              </select>
            </div>
            <div>
              <label className="label">WhatsApp Phone</label>
              <input className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9876543210" />
              <p className="text-xs text-brand-400 mt-1">Used to send work-assignment notifications via WhatsApp.</p>
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
