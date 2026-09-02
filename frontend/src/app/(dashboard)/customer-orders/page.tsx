'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError, getAccessToken } from '@/lib/api';
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
import type { CustomerOrder, DeliveryStatus } from '@/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

interface ItemRow {
  productName: string;
  quantity: string;
  unitPrice: string;
}

const emptyRow: ItemRow = { productName: '', quantity: '1', unitPrice: '' };

const emptyForm = {
  orderId: '',
  orderDate: new Date().toISOString().slice(0, 10),
  customerName: '',
  phone: '',
  address: '',
  actualDeliveryDate: '',
  deliveryStatus: 'PENDING' as DeliveryStatus,
};

function CustomerOrdersContent() {
  const { hasRole } = useAuth();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const { data, isLoading, mutate } = useSWR<CustomerOrder[]>(
    `/customer-orders?${new URLSearchParams({ ...(search ? { search } : {}), ...(statusFilter ? { status: statusFilter } : {}) })}`,
    fetcher,
  );
  const {
    canUseWhatsApp,
    showModal,
    whatsappOptions,
    openWhatsApp,
    closeWhatsApp,
  } = useWhatsApp();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerOrder | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [items, setItems] = useState<ItemRow[]>([{ ...emptyRow }]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function addItemRow() {
    setItems((rows) => [...rows, { ...emptyRow }]);
  }
  function removeItemRow(idx: number) {
    setItems((rows) => rows.filter((_, i) => i !== idx));
  }
  function updateItemRow(idx: number, patch: Partial<ItemRow>) {
    setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  const lineTotal = (row: ItemRow) => (parseFloat(row.quantity) || 0) * (parseFloat(row.unitPrice) || 0);
  const formTotal = items.reduce((s, r) => s + lineTotal(r), 0);

  const [paymentsOrder, setPaymentsOrder] = useState<CustomerOrder | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomerOrder | null>(null);
  const [assignTarget, setAssignTarget] = useState<CustomerOrder | null>(null);
  const [assignEmployeeTarget, setAssignEmployeeTarget] = useState<CustomerOrder | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setItems([{ ...emptyRow }]);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(order: CustomerOrder) {
    setEditing(order);
    setForm({
      orderId: order.orderId,
      orderDate: toDateInputValue(order.orderDate),
      customerName: order.customerName,
      phone: order.phone ?? '',
      address: order.address ?? '',
      actualDeliveryDate: toDateInputValue(order.actualDeliveryDate),
      deliveryStatus: order.deliveryStatus,
    });
    setItems(
      order.items?.length
        ? order.items.map((i) => ({ productName: i.productName, quantity: String(i.quantity), unitPrice: String(i.unitPrice) }))
        : [{ productName: order.product, quantity: '1', unitPrice: String(order.orderValue ?? 0) }],
    );
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    try {
      const payload = {
        orderId: form.orderId,
        orderDate: form.orderDate,
        customerName: form.customerName,
        phone: form.phone || undefined,
        address: form.address || undefined,
        actualDeliveryDate: form.actualDeliveryDate || undefined,
        deliveryStatus: form.deliveryStatus,
        items: items
          .filter((i) => i.productName && i.unitPrice)
          .map((i) => ({ productName: i.productName, quantity: parseInt(i.quantity, 10) || 1, unitPrice: parseFloat(i.unitPrice) })),
      };
      if (editing) {
        await api.patch(`/customer-orders/${editing.id}`, payload);
      } else {
        await api.post('/customer-orders', payload);
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
    await api.delete(`/customer-orders/${deleteTarget.id}`);
    setDeleteTarget(null);
    mutate();
  }

  async function refreshPaymentsOrder(id: string) {
    const fresh = await api.get<CustomerOrder>(`/customer-orders/${id}`);
    setPaymentsOrder(fresh);
    mutate();
  }

  async function downloadOrderPdf(order: CustomerOrder) {
    const token = getAccessToken();
    const res = await fetch(`${API_BASE_URL}/customer-orders/${order.id}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${order.orderId}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleSendWhatsApp(order: CustomerOrder) {
    openWhatsApp({
      recipientName: (order.customerName ?? '') || 'Customer',
      recipientPhone: order.phone ?? undefined,
      defaultMessage: `Order Confirmation
Order ID: ${order.orderId}
Product: ${order.product}
Quantity: ${order.items?.[0]?.quantity || 1}
Expected Delivery: ${formatDate(order.actualDeliveryDate)}`,
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">Customer Orders</h1>
          <p className="text-sm text-brand-500 mt-1">Track direct customer orders, payments, and delivery status.</p>
          {notice && <p className="text-sm text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2 mt-2">{notice}</p>}
        </div>
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            onClick={() =>
              downloadCsv(
                'customer-orders',
                (data ?? []).map((o) => ({
                  'Order ID': o.orderId,
                  'Job No.': o.jobNumber ?? '',
                  Date: formatDate(o.orderDate),
                  Customer: o.customerName,
                  Phone: o.phone ?? '',
                  Product: o.product,
                  'Order Value': o.orderValue ?? 0,
                  Received: o.totalReceived ?? 0,
                  Balance: o.balanceAmount ?? 0,
                  'Model No': o.cotTrack ?? '',
                  Status: o.deliveryStatus,
                  'Delivery Date': formatDate(o.actualDeliveryDate),
                })),
              )
            }
          >
            Export Excel
          </button>
          <button className="btn-primary" onClick={openCreate}>
            + New Order
          </button>
        </div>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          className="input max-w-xs"
          placeholder="Search order, customer, phone, product..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="input max-w-[160px]" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
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
              <th>Order ID</th>
              <th>Job No.</th>
              <th>Model No</th>
              <th>Assigned Employee</th>
              <th>Date</th>
              <th>Customer</th>
              <th>Product</th>
              <th>Order Value</th>
              <th>Balance</th>
              <th>Status</th>
              <th>Delivery</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={12} className="text-center py-8 text-brand-400">
                  Loading orders...
                </td>
              </tr>
            )}
            {!isLoading && data?.length === 0 && (
              <tr>
                <td colSpan={12} className="text-center py-8 text-brand-400">
                  No orders found
                </td>
              </tr>
            )}
            {data?.map((order) => (
              <tr key={order.id}>
                <td className="font-medium">{order.orderId}</td>
                <td className="text-brand-600 text-xs font-medium whitespace-nowrap">{order.jobNumber ?? '-'}</td>
                <td className="text-xs whitespace-nowrap">
                  {order.cotTrack ? (
                    <>
                      <span className="font-medium text-ink">{order.cotTrack}</span>
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
                  {order.customerName}
                  {order.phone && <div className="text-xs text-brand-400">{order.phone}</div>}
                </td>
                <td className="max-w-[220px] truncate">{order.product}</td>
                <td>{formatCurrency(order.orderValue ?? 0)}</td>
                <td>
                  {formatCurrency(order.balanceAmount ?? 0)} <BalanceBadge amount={order.balanceAmount ?? 0} />
                </td>
                <td>
                  <StatusBadge status={order.deliveryStatus} />
                </td>
                <td>{formatDate(order.actualDeliveryDate)}</td>
                <td>
                  <div className="flex gap-2 items-center">
                    <WhatsAppActionButton
                      recipientName={(order.customerName ?? '') || 'Customer'}
                      recipientPhone={order.phone ?? undefined}
                      onClick={() => handleSendWhatsApp(order)}
                      size="sm"
                    />
                    <ActionsMenu
                      items={[
                        { label: 'Payments', onClick: () => setPaymentsOrder(order) },
                        { label: 'Edit', onClick: () => openEdit(order) },
                        { label: 'Download PDF', onClick: () => downloadOrderPdf(order) },
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
      </div>

      {formOpen && (
        <Modal title={editing ? `Edit Order ${editing.orderId}` : 'New Customer Order'} onClose={() => setFormOpen(false)} wide>
          <form onSubmit={handleSubmit} className="space-y-3">
            <FormRow>
              <FormField label="Order ID">
                <input
                  className="input"
                  required
                  value={form.orderId}
                  onChange={(e) => setForm((f) => ({ ...f, orderId: e.target.value }))}
                  placeholder="SSS-083"
                />
              </FormField>
              <FormField label="Order Date">
                <input
                  type="date"
                  className="input"
                  required
                  value={form.orderDate}
                  onChange={(e) => setForm((f) => ({ ...f, orderDate: e.target.value }))}
                />
              </FormField>
            </FormRow>
            <FormRow>
              <FormField label="Customer Name">
                <input
                  className="input"
                  required
                  value={form.customerName}
                  onChange={(e) => setForm((f) => ({ ...f, customerName: e.target.value }))}
                />
              </FormField>
              <FormField label="Phone">
                <input className="input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
              </FormField>
            </FormRow>
            <FormField label="Address" full>
              <input className="input" value={form.address} onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))} />
            </FormField>

            <div>
              <div className="grid grid-cols-2 sm:grid-cols-[1fr_70px_110px_100px_auto] gap-2 text-[11px] font-medium text-ink-muted px-0.5 hidden sm:grid">
                <span>Product</span>
                <span>Qty</span>
                <span>Unit Price</span>
                <span>Line Total</span>
                <span></span>
              </div>
              <label className="label sm:hidden">Products</label>
              <div className="space-y-2">
                {items.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-2 sm:grid-cols-[1fr_70px_110px_100px_auto] gap-2 sm:items-center">
                    <input
                      className="input col-span-2 sm:col-span-1"
                      required
                      placeholder="Z-Model 78*72 -BC -COT"
                      value={row.productName}
                      onChange={(e) => updateItemRow(idx, { productName: e.target.value })}
                    />
                    <input
                      type="number"
                      min="1"
                      className="input"
                      placeholder="Qty"
                      value={row.quantity}
                      onChange={(e) => updateItemRow(idx, { quantity: e.target.value })}
                    />
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="input"
                      placeholder="Unit Price"
                      required
                      value={row.unitPrice}
                      onChange={(e) => updateItemRow(idx, { unitPrice: e.target.value })}
                    />
                    <div className="input flex items-center justify-end font-medium text-ink bg-brand-50">{formatCurrency(lineTotal(row))}</div>
                    <button type="button" className="text-red-500 text-xs" onClick={() => removeItemRow(idx)} disabled={items.length === 1}>
                      Remove
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex items-center justify-between mt-2">
                <button type="button" className="text-brand-600 text-xs hover:underline" onClick={addItemRow}>
                  + Add product
                </button>
                <p className="text-sm font-semibold text-brand-900">Total: {formatCurrency(formTotal)}</p>
              </div>
            </div>

            <div>
              <label className="label">Model No</label>
              <div className="input bg-brand-50 text-brand-500 flex items-center">
                {editing?.cotTrack ? (
                  <span className="text-ink font-medium">{editing.cotTrack}</span>
                ) : (
                  <span className="italic">Not Updated &mdash; will be updated by Production Employee</span>
                )}
              </div>
            </div>
            <FormRow>
              <FormField label="Actual Delivery Date">
                <input
                  type="date"
                  className="input"
                  value={form.actualDeliveryDate}
                  onChange={(e) => setForm((f) => ({ ...f, actualDeliveryDate: e.target.value }))}
                />
              </FormField>
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
            </FormRow>

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
        <Modal title={`Payments - ${paymentsOrder.orderId}`} onClose={() => setPaymentsOrder(null)} wide>
          <PaymentsPanel
            totalAmount={paymentsOrder.orderValue ?? 0}
            totalReceived={paymentsOrder.totalReceived ?? 0}
            balanceAmount={paymentsOrder.balanceAmount ?? 0}
            payments={paymentsOrder.payments ?? []}
            canDelete={hasRole('ADMIN')}
            canAdd={hasRole('ADMIN')}
            onAddPayment={async (payload) => {
              await api.post(`/customer-orders/${paymentsOrder.id}/payments`, payload);
              await refreshPaymentsOrder(paymentsOrder.id);
            }}
            onDeletePayment={async (paymentId) => {
              await api.delete(`/customer-orders/${paymentsOrder.id}/payments/${paymentId}`);
              await refreshPaymentsOrder(paymentsOrder.id);
            }}
          />
        </Modal>
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Order"
          message={`Delete order ${deleteTarget.orderId} for ${deleteTarget.customerName}? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {assignTarget && (
        <AssignProductionModal
          productName={assignTarget.product}
          onClose={() => setAssignTarget(null)}
          onSubmit={async (payload: AssignProductionPayload) => {
            const result = await api.post<{ whatsapp?: { sent: boolean; reason?: string; group?: { sent: boolean; reason?: string } } }>(
              `/customer-orders/${assignTarget.id}/assign-production`,
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
          title={`Assign Production Employee - ${assignEmployeeTarget.orderId}`}
          onClose={() => setAssignEmployeeTarget(null)}
          onSubmit={async (employeeId) => {
            await api.post(`/customer-orders/${assignEmployeeTarget.id}/assign-employee`, { employeeId });
            setNotice(`${assignEmployeeTarget.orderId} assigned. The employee will enter the Model No.`);
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

export default function CustomerOrdersPage() {
  return (
    <RoleGate minRole="ADMIN">
      <CustomerOrdersContent />
    </RoleGate>
  );
}
