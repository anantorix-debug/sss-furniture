'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate, toDateInputValue } from '@/lib/format';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StatusBadge, BalanceBadge } from '@/components/StatusBadge';
import { PaymentsPanel } from '@/components/PaymentsPanel';
import { FormRow, FormField } from '@/components/orders/OrderFormFields';
import { AssignProductionModal, type AssignProductionPayload } from '@/components/AssignProductionModal';
import { AssignEmployeeModal } from '@/components/AssignEmployeeModal';
import { ActionsMenu } from '@/components/ActionsMenu';
import { RoleGate } from '@/components/RoleGate';
import { downloadCsv } from '@/lib/csv';
import { WhatsAppModal } from '@/components/WhatsAppModal';
import { WhatsAppActionButton } from '@/components/WhatsAppActionButton';
import { useWhatsApp } from '@/hooks/useWhatsApp';
import type { PartyOrder, DeliveryStatus } from '@/types';
import { Pagination, type PaginatedResult } from '@/components/Pagination';

const emptyForm = {
  orderDate: new Date().toISOString().slice(0, 10),
  shopName: '',
  phone: '',
  model: '',
  finish: '',
  details: '',
  qty: '1',
  price: '',
  cashTrack: '',
  courierTrack: '',
  actualDeliveryDate: '',
  deliveryStatus: 'PENDING' as DeliveryStatus,
};

function PartyOrdersContent() {
  const { hasRole } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const { data: result, isLoading, mutate } = useSWR<PaginatedResult<PartyOrder>>(
    `/party-orders?${new URLSearchParams({
      ...(search ? { search } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      page: String(page),
      limit: '20',
    })}`,
    fetcher,
  );
  const data = result?.data;

  function updateSearch(value: string) {
    setSearch(value);
    setPage(1);
  }
  function updateStatusFilter(value: string) {
    setStatusFilter(value);
    setPage(1);
  }
  const {
    showModal,
    whatsappOptions,
    openWhatsApp,
    closeWhatsApp,
  } = useWhatsApp();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PartyOrder | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [paymentsOrder, setPaymentsOrder] = useState<PartyOrder | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PartyOrder | null>(null);
  const [assignTarget, setAssignTarget] = useState<PartyOrder | null>(null);
  const [assignEmployeeTarget, setAssignEmployeeTarget] = useState<PartyOrder | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(order: PartyOrder) {
    setEditing(order);
    setForm({
      orderDate: toDateInputValue(order.orderDate),
      shopName: order.shopName,
      phone: order.phone ?? '',
      model: order.model,
      finish: order.finish ?? '',
      details: order.details ?? '',
      qty: String(order.qty),
      price: String(order.price ?? 0),
      cashTrack: order.cashTrack ?? '',
      courierTrack: order.courierTrack ?? '',
      actualDeliveryDate: toDateInputValue(order.actualDeliveryDate),
      deliveryStatus: order.deliveryStatus,
    });
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const payload = {
        orderDate: form.orderDate,
        shopName: form.shopName,
        phone: form.phone || undefined,
        model: form.model,
        finish: form.finish || undefined,
        details: form.details || undefined,
        qty: parseInt(form.qty, 10) || 1,
        price: parseFloat(form.price),
        // Total is always server-computed as qty * price - not sent.
        cashTrack: form.cashTrack || undefined,
        courierTrack: form.courierTrack || undefined,
        actualDeliveryDate: form.actualDeliveryDate || undefined,
        deliveryStatus: form.deliveryStatus,
      };
      if (editing) {
        await api.patch(`/party-orders/${editing.id}`, payload);
      } else {
        await api.post('/party-orders', payload);
      }
      setFormOpen(false);
      mutate();
    } catch (err) {
      setFormError(err instanceof ApiError ? err.message : 'Failed to save order');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await api.delete(`/party-orders/${deleteTarget.id}`);
    setDeleteTarget(null);
    mutate();
  }

  async function refreshPaymentsOrder(id: string) {
    const fresh = await api.get<PartyOrder>(`/party-orders/${id}`);
    setPaymentsOrder(fresh);
    mutate();
  }

  function handleSendWhatsApp(order: PartyOrder) {
    openWhatsApp({
      recipientName: (order.shopName ?? '') || 'Shop',
      recipientPhone: order.phone ?? undefined,
      defaultMessage: `New Order
Shop: ${order.shopName}
Model: ${order.model}
Quantity: ${order.qty}
Expected Delivery: ${formatDate(order.actualDeliveryDate)}`,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">Party Orders</h1>
          <p className="text-sm text-brand-500 mt-1">Wholesale / shop orders with courier tracking.</p>
          {notice && <p className="text-sm text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2 mt-2">{notice}</p>}
        </div>
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            onClick={() =>
              downloadCsv(
                'party-orders',
                (data ?? []).map((o) => ({
                  'Job No.': o.jobNumber ?? '',
                  'Model No': o.cotNo ?? '',
                  Date: formatDate(o.orderDate),
                  Shop: o.shopName,
                  Phone: o.phone ?? '',
                  Product: o.model,
                  Finish: o.finish ?? '',
                  Qty: o.qty,
                  'Total Amount': o.totalAmount ?? 0,
                  Received: o.receivedAmount ?? 0,
                  Balance: o.balanceAmount ?? 0,
                  Courier: o.courierTrack ?? '',
                  Status: o.deliveryStatus,
                  'Delivery Date': formatDate(o.actualDeliveryDate),
                })),
              )
            }
          >
            Export Excel
          </button>
          <button className="btn-primary" onClick={openCreate}>
            + New Party Order
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          className="input max-w-xs"
          placeholder="Search shop, product, Model No..."
          value={search}
          onChange={(e) => updateSearch(e.target.value)}
        />
        <select className="input max-w-[160px]" value={statusFilter} onChange={(e) => updateStatusFilter(e.target.value)}>
          <option value="">All statuses</option>
          <option value="PENDING">Pending</option>
          <option value="DELIVERED">Delivered</option>
          <option value="CANCELLED">Cancelled</option>
        </select>
      </div>

      <div className="card overflow-x-auto">
        <table className="table-shell">
          <thead>
            <tr>
              <th>Job No.</th>
              <th>Model No</th>
              <th>Assigned Employee</th>
              <th>Date</th>
              <th>Shop</th>
              <th>Product</th>
              <th>Total</th>
              <th>Balance</th>
              <th>Delivery Challan</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={11} className="text-center py-8 text-brand-400">
                  Loading orders...
                </td>
              </tr>
            )}
            {!isLoading && data?.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center py-8 text-brand-400">
                  No party orders found
                </td>
              </tr>
            )}
            {data?.map((order) => (
              <tr key={order.id}>
                <td className="text-brand-600 text-xs font-medium whitespace-nowrap">{order.jobNumber ?? '-'}</td>
                <td className="text-xs whitespace-nowrap">
                  {order.cotNo ? (
                    <>
                      <span className="font-medium text-ink">{order.cotNo}</span>
                      {order.modelNoUpdatedBy && (
                        <div className="text-brand-400 text-[10px]">
                          by {order.modelNoUpdatedBy.name} &middot; {formatDate(order.modelNoUpdatedAt)}
                        </div>
                      )}
                    </>
                  ) : (
                    <span className="text-brand-400 italic">Not Updated</span>
                  )}
                </td>
                <td className="text-xs whitespace-nowrap">{order.assignedEmployee?.name ?? <span className="text-brand-400">Unassigned</span>}</td>
                <td>{formatDate(order.orderDate)}</td>
                <td>
                  {order.shopName}
                  {order.phone && <div className="text-xs text-brand-400">{order.phone}</div>}
                </td>
                <td>
                  {order.model}
                  {order.finish && <div className="text-xs text-brand-400">{order.finish}</div>}
                </td>
                <td>{formatCurrency(order.totalAmount ?? 0)}</td>
                <td>
                  {formatCurrency(order.balanceAmount ?? 0)} <BalanceBadge amount={order.balanceAmount ?? 0} />
                </td>
                <td>{order.courierTrack || '-'}</td>
                <td>
                  <StatusBadge status={order.deliveryStatus} />
                </td>
                <td>
                  <div className="flex gap-2 items-center">
                    <WhatsAppActionButton
                      recipientName={(order.shopName ?? '') || 'Shop'}
                      recipientPhone={order.phone ?? undefined}
                      onClick={() => handleSendWhatsApp(order)}
                      size="sm"
                    />
                    <ActionsMenu
                      items={[
                        { label: 'Payments', onClick: () => setPaymentsOrder(order) },
                        { label: 'Edit', onClick: () => openEdit(order) },
                        {
                          label: order.assignedEmployee ? 'Reassign Employee' : 'Assign Employee',
                          onClick: () => setAssignEmployeeTarget(order),
                          hidden: !hasRole('SUPERADMIN'),
                        },
                        {
                          label: 'Assign to Production',
                          onClick: () => setAssignTarget(order),
                          hidden: !hasRole('ADMIN'),
                        },
                        {
                          label: 'Delete',
                          onClick: () => setDeleteTarget(order),
                          danger: true,
                          hidden: !hasRole('ADMIN'),
                        },
                      ]}
                    />
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {result && (
          <Pagination page={result.page} totalPages={result.totalPages} total={result.total} limit={result.limit} onPageChange={setPage} />
        )}
      </div>

      {formOpen && (
        <Modal title={editing ? `Edit Party Order` : 'New Party Order'} onClose={() => setFormOpen(false)} wide>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="label">Model No</label>
              <div className="input bg-brand-50 text-brand-500 flex items-center">
                {editing?.cotNo ? (
                  <span className="text-ink font-medium">{editing.cotNo}</span>
                ) : (
                  <span className="italic">Not Updated &mdash; will be updated by Production Employee</span>
                )}
              </div>
            </div>
            <FormRow>
              <FormField label="Order Date">
                <input
                  type="date"
                  className="input"
                  required
                  value={form.orderDate}
                  onChange={(e) => setForm((f) => ({ ...f, orderDate: e.target.value }))}
                />
              </FormField>
              <FormField label="Shop Name">
                <input
                  className="input"
                  required
                  value={form.shopName}
                  onChange={(e) => setForm((f) => ({ ...f, shopName: e.target.value }))}
                />
              </FormField>
            </FormRow>
            <FormRow>
              <FormField label="Phone">
                <input className="input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </FormField>
              <FormField label="Product">
                <input className="input" required value={form.model} onChange={(e) => setForm((f) => ({ ...f, model: e.target.value }))} />
              </FormField>
            </FormRow>
            <FormRow>
              <FormField label="Finish">
                <input className="input" value={form.finish} onChange={(e) => setForm((f) => ({ ...f, finish: e.target.value }))} placeholder="Teak-Finish / Rose Wood" />
              </FormField>
            </FormRow>
            <FormField label="Details" full>
              <input className="input" value={form.details} onChange={(e) => setForm((f) => ({ ...f, details: e.target.value }))} placeholder="75*60-BC" />
            </FormField>
            <FormRow>
              <FormField label="Qty">
                <input type="number" min="1" className="input" value={form.qty} onChange={(e) => setForm((f) => ({ ...f, qty: e.target.value }))} />
              </FormField>
              <FormField label="Unit Price">
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  className="input"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                />
              </FormField>
            </FormRow>
            <FormRow>
              <FormField label="Total Amount (auto)">
                <div className="input bg-brand-50 text-brand-700 font-medium flex items-center">
                  {formatCurrency((parseInt(form.qty, 10) || 1) * (parseFloat(form.price) || 0))}
                </div>
              </FormField>
              <FormField label="Cash Track">
                <input className="input" value={form.cashTrack} onChange={(e) => setForm((f) => ({ ...f, cashTrack: e.target.value }))} />
              </FormField>
            </FormRow>
            <FormRow>
              <FormField label="Courier / Delivery Agent">
                <input
                  className="input"
                  value={form.courierTrack}
                  onChange={(e) => setForm((f) => ({ ...f, courierTrack: e.target.value }))}
                  placeholder="Sitaram / Sunil"
                />
              </FormField>
              <FormField label="Actual Delivery Date">
                <input
                  type="date"
                  className="input"
                  value={form.actualDeliveryDate}
                  onChange={(e) => setForm((f) => ({ ...f, actualDeliveryDate: e.target.value }))}
                />
              </FormField>
            </FormRow>
            <FormField label="Delivery Status">
              <select
                className="input"
                value={form.deliveryStatus}
                onChange={(e) => setForm((f) => ({ ...f, deliveryStatus: e.target.value as DeliveryStatus }))}
              >
                <option value="PENDING">Pending</option>
                <option value="DELIVERED">Delivered</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </FormField>

            {formError && <p className="text-sm text-red-600">{formError}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Create Order'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {paymentsOrder && (
        <Modal title={`Payments - ${paymentsOrder.shopName}`} onClose={() => setPaymentsOrder(null)} wide>
          <PaymentsPanel
            totalAmount={paymentsOrder.totalAmount ?? 0}
            totalReceived={paymentsOrder.receivedAmount ?? 0}
            balanceAmount={paymentsOrder.balanceAmount ?? 0}
            payments={paymentsOrder.payments ?? []}
            canDelete={hasRole('ADMIN')}
            canAdd={hasRole('ADMIN')}
            onAddPayment={async (payload) => {
              await api.post(`/party-orders/${paymentsOrder.id}/payments`, payload);
              await refreshPaymentsOrder(paymentsOrder.id);
            }}
            onDeletePayment={async (paymentId) => {
              await api.delete(`/party-orders/${paymentsOrder.id}/payments/${paymentId}`);
              await refreshPaymentsOrder(paymentsOrder.id);
            }}
          />
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Party Order"
          message={`Delete this order for ${deleteTarget.shopName}? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {assignTarget && (
        <AssignProductionModal
          productName={assignTarget.model}
          onClose={() => setAssignTarget(null)}
          onSubmit={async (payload: AssignProductionPayload) => {
            const result = await api.post<{ whatsapp?: { sent: boolean; reason?: string; group?: { sent: boolean; reason?: string } } }>(
              `/party-orders/${assignTarget.id}/assign-production`,
              payload,
            );
            const w = result.whatsapp;
            setNotice(
              w?.sent || w?.group?.sent
                ? `Work assigned. WhatsApp sent${w?.sent ? ' to worker' : ''}${w?.group?.sent ? (w?.sent ? ' and team group' : ' to team group') : ''}.`
                : 'Work assigned. WhatsApp was not sent (check phone/group configuration).',
            );
            setAssignTarget(null);
          }}
        />
      )}

      {assignEmployeeTarget && (
        <AssignEmployeeModal
          title={`Assign Production Employee - ${assignEmployeeTarget.shopName}`}
          onClose={() => setAssignEmployeeTarget(null)}
          onSubmit={async (employeeId) => {
            await api.post(`/party-orders/${assignEmployeeTarget.id}/assign-employee`, { employeeId });
            setNotice(`Order for ${assignEmployeeTarget.shopName} assigned. The employee will enter the Model No.`);
            setAssignEmployeeTarget(null);
            mutate();
          }}
        />
      )}

      {showModal && whatsappOptions && (
        <WhatsAppModal
          onClose={closeWhatsApp}
          recipientInfo={{
            name: whatsappOptions.recipientName,
            phone: whatsappOptions.recipientPhone,
          }}
          defaultMessage={whatsappOptions.defaultMessage}
          onSuccess={() => mutate()}
        />
      )}
    </div>
  );
}

export default function PartyOrdersPage() {
  return (
    <RoleGate minRole="ADMIN">
      <PartyOrdersContent />
    </RoleGate>
  );
}
