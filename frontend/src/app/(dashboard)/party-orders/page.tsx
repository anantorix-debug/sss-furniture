'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate, toDateInputValue } from '@/lib/format';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ViewField } from '@/components/ViewField';
import { StatusBadge, BalanceBadge, Chip, type ChipColor } from '@/components/StatusBadge';
import { PaymentsPanel } from '@/components/PaymentsPanel';
import { FormRow, FormField } from '@/components/orders/OrderFormFields';
import { AssignEmployeeModal } from '@/components/AssignEmployeeModal';
import { AssignProductionModal, type AssignProductionPayload } from '@/components/AssignProductionModal';
import { ActionsMenu } from '@/components/ActionsMenu';
import { RoleGate } from '@/components/RoleGate';
import { ModelNoPicker } from '@/components/ModelNoPicker';
import { ShopManagerModal } from '@/components/ShopManagerModal';
import { downloadCsv } from '@/lib/csv';
import { WhatsAppModal } from '@/components/WhatsAppModal';
import { WhatsAppActionButton } from '@/components/WhatsAppActionButton';
import { useWhatsApp } from '@/hooks/useWhatsApp';
import { UnitSelect } from '@/components/UnitSelect';
import type { PartyOrder, PartyOrderItem, DeliveryStatus, Shop, Product, CarpenterWorkItem } from '@/types';
import { Pagination, type PaginatedResult } from '@/components/Pagination';

interface ItemForm {
  productId?: string;
  productName: string;
  finish: string;
  size: string;
  sizeUnit: string;
  pattern: string;
  details: string;
  qty: string;
  unitPrice: string;
  modelNo?: string;
  availableQuantity?: number;
}

const emptyItem: ItemForm = {
  productName: '',
  finish: '',
  size: '',
  sizeUnit: '',
  pattern: '',
  details: '',
  qty: '1',
  unitPrice: '',
};

const emptyForm = {
  orderDate: new Date().toISOString().slice(0, 10),
  shopId: '',
  phone: '',
  courierTrack: '',
  actualDeliveryDate: '',
  deliveryStatus: 'PENDING' as DeliveryStatus,
};

function itemFromExisting(i: PartyOrderItem): ItemForm {
  return {
    productId: i.productId ?? undefined,
    productName: i.productName,
    finish: i.finish ?? '',
    size: i.size ?? '',
    sizeUnit: i.sizeUnit ?? '',
    pattern: i.pattern ?? '',
    details: i.details ?? '',
    qty: String(i.qty),
    unitPrice: String(i.unitPrice ?? 0),
    modelNo: i.modelNo ?? undefined,
  };
}

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
  const { data: shops, mutate: mutateShops } = useSWR<Shop[]>('/shops', fetcher);
  const [shopManagerOpen, setShopManagerOpen] = useState(false);

  function updateSearch(value: string) {
    setSearch(value);
    setPage(1);
  }
  function updateStatusFilter(value: string) {
    setStatusFilter(value);
    setPage(1);
  }
  const { showModal, whatsappOptions, openWhatsApp, closeWhatsApp } = useWhatsApp();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PartyOrder | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [items, setItems] = useState<ItemForm[]>([{ ...emptyItem }]);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const [paymentsOrder, setPaymentsOrder] = useState<PartyOrder | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PartyOrder | null>(null);
  const [viewTarget, setViewTarget] = useState<PartyOrder | null>(null);
  const [assignEmployeeTarget, setAssignEmployeeTarget] = useState<PartyOrder | null>(null);
  const [assignProductionItem, setAssignProductionItem] = useState<{ order: PartyOrder; item: PartyOrderItem } | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setItems([{ ...emptyItem }]);
    setFormError(null);
    setFormOpen(true);
  }

  function openEdit(order: PartyOrder) {
    setEditing(order);
    setForm({
      orderDate: toDateInputValue(order.orderDate),
      shopId: order.shopId ?? '',
      phone: order.phone ?? '',
      courierTrack: order.courierTrack ?? '',
      actualDeliveryDate: toDateInputValue(order.actualDeliveryDate),
      deliveryStatus: order.deliveryStatus,
    });
    setItems(order.items.length > 0 ? order.items.map(itemFromExisting) : [{ ...emptyItem }]);
    setFormError(null);
    setFormOpen(true);
  }

  function updateItem(idx: number, patch: Partial<ItemForm>) {
    setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function addItem() {
    setItems((rows) => [...rows, { ...emptyItem }]);
  }
  function removeItem(idx: number) {
    setItems((rows) => rows.filter((_, i) => i !== idx));
  }
  function selectItemProduct(idx: number, product: Product | null) {
    if (!product) {
      updateItem(idx, { productId: undefined, availableQuantity: undefined });
      return;
    }
    updateItem(idx, {
      productId: product.id,
      productName: product.name,
      finish: product.materialFinish ?? '',
      size: product.modelSize ?? '',
      sizeUnit: product.sizeUnit ?? '',
      pattern: product.pattern ?? '',
      details: product.details ?? '',
      unitPrice: String(product.retailPrice ?? 0),
      modelNo: product.modelNo ?? undefined,
      availableQuantity: product.availableQuantity,
    });
  }

  const orderTotal = items.reduce((sum, i) => sum + (parseInt(i.qty, 10) || 1) * (parseFloat(i.unitPrice) || 0), 0);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    const validItems = items.filter((i) => i.productName.trim());
    if (validItems.length === 0) {
      setFormError('Add at least one product line');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        orderDate: form.orderDate,
        shopId: form.shopId,
        phone: form.phone || undefined,
        courierTrack: form.courierTrack || undefined,
        actualDeliveryDate: form.actualDeliveryDate || undefined,
        deliveryStatus: form.deliveryStatus,
        items: validItems.map((i) => ({
          productId: i.productId,
          productName: i.productName,
          finish: i.finish || undefined,
          size: i.size || undefined,
          sizeUnit: i.sizeUnit || undefined,
          pattern: i.pattern || undefined,
          details: i.details || undefined,
          qty: parseInt(i.qty, 10) || 1,
          unitPrice: parseFloat(i.unitPrice) || 0,
          modelNo: i.modelNo || undefined,
        })),
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
    try {
      await api.delete(`/party-orders/${deleteTarget.id}`);
      setDeleteTarget(null);
      mutate();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Failed to delete order');
      setDeleteTarget(null);
    }
  }

  async function refreshPaymentsOrder(id: string) {
    const fresh = await api.get<PartyOrder>(`/party-orders/${id}`);
    setPaymentsOrder(fresh);
    mutate();
  }

  function productSummary(order: PartyOrder): string {
    if (order.items.length === 0) return order.model ?? '-';
    if (order.items.length === 1) return order.items[0].productName;
    return `${order.items[0].productName} +${order.items.length - 1} more`;
  }

  function modelNoSummary(order: PartyOrder): string {
    if (order.items.length === 0) return order.cotNo ?? '';
    if (order.items.length === 1) return order.items[0].modelNo ?? '';
    const withModelNo = order.items.filter((i) => i.modelNo).length;
    return withModelNo === 0 ? '' : `${withModelNo}/${order.items.length} assigned`;
  }

  // Same "Dear Sir, kindly check and confirm..." format as the Customer
  // Orders template, listing every product line rather than a single model.
  function buildOrderConfirmationMessage(order: PartyOrder): string {
    const lines = [
      `Dear Sir,`,
      ``,
      `Kindly check and confirm the following order details:`,
      ``,
      `*ORDER DETAILS*`,
      `Shop: ${order.shopName}`,
      ...order.items.map(
        (i) =>
          `${i.productName}${i.finish ? ` (${i.finish})` : ''} - Qty ${i.qty}${i.size ? `, ${i.size}${i.sizeUnit ? ` ${i.sizeUnit}` : ''}` : ''}`,
      ),
      ``,
      `*PAYMENT DETAILS*`,
      `Total Amount: ₹${order.totalAmount ?? 0}`,
      order.receivedAmount ? `Received: ₹${order.receivedAmount}` : null,
      `Balance Amount: ₹${order.balanceAmount ?? order.totalAmount ?? 0}`,
      ``,
      `Please check all the above details carefully. Once confirmed, changes cannot be made. If everything is correct, kindly reply:`,
      ``,
      `"Confirmed – All Details OK."`,
      ``,
      `Thank you.`,
    ].filter((l) => l !== null);
    return lines.join('\n');
  }

  function handleSendWhatsApp(order: PartyOrder) {
    openWhatsApp({
      recipientName: (order.shopName ?? '') || 'Shop',
      recipientPhone: order.phone ?? undefined,
      defaultMessage: buildOrderConfirmationMessage(order),
      defaultImageUrl: '/wa-template.jpeg',
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">Party Orders</h1>
          <p className="text-sm text-brand-500 mt-1">Wholesale / shop orders - any number of products per order.</p>
          {notice && <p className="text-sm text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2 mt-2">{notice}</p>}
        </div>
        <div className="flex gap-2">
          <button
            className="btn-secondary"
            onClick={() =>
              downloadCsv(
                'party-orders',
                (data ?? []).flatMap((o) =>
                  (o.items.length > 0 ? o.items : [null]).map((i) => ({
                    'Job No.': o.jobNumber ?? '',
                    'Model No': i?.modelNo ?? o.cotNo ?? '',
                    Date: formatDate(o.orderDate),
                    Shop: o.shopName,
                    Phone: o.phone ?? '',
                    Product: i?.productName ?? o.model ?? '',
                    Finish: i?.finish ?? o.finish ?? '',
                    Qty: i?.qty ?? o.qty ?? '',
                    'Line Total': i?.totalValue ?? o.totalAmount ?? 0,
                    'Order Total Amount': o.totalAmount ?? 0,
                    Received: o.receivedAmount ?? 0,
                    Balance: o.balanceAmount ?? 0,
                    'Vehicle Number': o.courierTrack ?? '',
                    Status: o.deliveryStatus,
                    'Delivery Date': formatDate(o.actualDeliveryDate),
                  })),
                ),
              )
            }
          >
            Export Excel
          </button>
          <button className="btn-secondary" onClick={() => setShopManagerOpen(true)}>
            Manage Shops
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
              <th>Date</th>
              <th>Shop</th>
              <th>Products</th>
              <th>Total</th>
              <th>Balance</th>
              <th>Vehicle Number</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={10} className="text-center py-8 text-brand-400">
                  Loading orders...
                </td>
              </tr>
            )}
            {!isLoading && data?.length === 0 && (
              <tr>
                <td colSpan={10} className="text-center py-8 text-brand-400">
                  No party orders found
                </td>
              </tr>
            )}
            {data?.map((order) => (
              <tr key={order.id}>
                <td className="text-brand-600 text-xs font-medium whitespace-nowrap">{order.jobNumber ?? '-'}</td>
                <td className="text-xs whitespace-nowrap">
                  {modelNoSummary(order) ? (
                    <span className="font-medium text-ink">{modelNoSummary(order)}</span>
                  ) : (
                    <span className="text-brand-400 italic">Not Updated</span>
                  )}
                </td>
                <td>{formatDate(order.orderDate)}</td>
                <td>
                  {order.shopName}
                  {order.phone && <div className="text-xs text-brand-400">{order.phone}</div>}
                </td>
                <td>
                  {productSummary(order)}
                  {order.items.length > 0 && <div className="text-xs text-brand-400">{order.items.length} line(s)</div>}
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
                        { label: 'View', onClick: () => setViewTarget(order) },
                        { label: 'Payments', onClick: () => setPaymentsOrder(order) },
                        { label: 'Edit', onClick: () => openEdit(order) },
                        {
                          label: order.assignedEmployee ? 'Reassign Employee' : 'Assign Employee',
                          onClick: () => setAssignEmployeeTarget(order),
                          // Legacy header-level assignment - only meaningful
                          // for orders created before the multi-line
                          // redesign. New orders auto-create production per
                          // line at creation time instead.
                          hidden: !hasRole('SUPERADMIN') || order.items.length > 0,
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
        <Modal title={editing ? 'Edit Party Order' : 'New Party Order'} onClose={() => setFormOpen(false)} wide>
          <form onSubmit={handleSubmit} className="space-y-4">
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
              <FormField label="Shop">
                <select className="input" required value={form.shopId} onChange={(e) => setForm((f) => ({ ...f, shopId: e.target.value }))}>
                  <option value="">Select shop...</option>
                  {shops?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </FormField>
            </FormRow>
            <FormField label="Phone">
              <input className="input" value={form.phone} onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} />
            </FormField>

            <div className="border-t border-brand-100 pt-3 space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-brand-900">Products</h3>
                <button type="button" className="text-brand-600 text-xs hover:underline" onClick={addItem}>
                  + Add Product
                </button>
              </div>
              <div className="space-y-3 max-h-[45vh] overflow-y-auto">
                {items.map((item, idx) => (
                  <div key={idx} className="border border-brand-100 rounded-lg p-3 space-y-2">
                    <div className="grid grid-cols-1 sm:grid-cols-[160px_1fr_auto] gap-2 items-start">
                      <ModelNoPicker
                        modelNo={item.modelNo ?? ''}
                        onChangeModelNo={(v) => updateItem(idx, { modelNo: v })}
                        onSelect={(p) => selectItemProduct(idx, p)}
                      />
                      <input
                        className="input"
                        placeholder="Product Name"
                        value={item.productName}
                        onChange={(e) => updateItem(idx, { productName: e.target.value, productId: undefined })}
                      />
                      <button
                        type="button"
                        className="text-red-500 text-xs px-2 py-2"
                        onClick={() => removeItem(idx)}
                        disabled={items.length === 1}
                      >
                        Remove
                      </button>
                    </div>
                    {item.productId && (
                      <p className="text-[11px] text-emerald-700">From Godown Stock - In Stock</p>
                    )}
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                      <input className="input text-sm" placeholder="Finish" value={item.finish} onChange={(e) => updateItem(idx, { finish: e.target.value })} />
                      <input className="input text-sm" placeholder="Size" value={item.size} onChange={(e) => updateItem(idx, { size: e.target.value })} />
                      <UnitSelect id={`item-size-unit-${idx}`} value={item.sizeUnit} onChange={(v) => updateItem(idx, { sizeUnit: v })} />
                      <input className="input text-sm" placeholder="Pattern" value={item.pattern} onChange={(e) => updateItem(idx, { pattern: e.target.value })} />
                    </div>
                    <input className="input text-sm" placeholder="Details" value={item.details} onChange={(e) => updateItem(idx, { details: e.target.value })} />
                    <div className="grid grid-cols-3 gap-2 items-center">
                      <div>
                        <label className="text-[10px] text-brand-400">Qty</label>
                        <input type="number" min="1" className="input text-sm" value={item.qty} onChange={(e) => updateItem(idx, { qty: e.target.value })} />
                      </div>
                      <div>
                        <label className="text-[10px] text-brand-400">Unit Price</label>
                        <input type="number" min="0" step="0.01" className="input text-sm" value={item.unitPrice} onChange={(e) => updateItem(idx, { unitPrice: e.target.value })} />
                      </div>
                      <div>
                        <label className="text-[10px] text-brand-400">Line Total</label>
                        <div className="input text-sm bg-brand-50 text-brand-700 font-medium flex items-center">
                          {formatCurrency((parseInt(item.qty, 10) || 1) * (parseFloat(item.unitPrice) || 0))}
                        </div>
                      </div>
                    </div>
                    {item.modelNo && <p className="text-[11px] text-brand-500">Model No: {item.modelNo}</p>}
                  </div>
                ))}
              </div>
              <div className="flex justify-end">
                <p className="text-sm font-semibold text-brand-900">Total Order Value: {formatCurrency(orderTotal)}</p>
              </div>
            </div>

            <FormRow>
              <FormField label="Vehicle Number">
                <input
                  className="input"
                  value={form.courierTrack}
                  onChange={(e) => setForm((f) => ({ ...f, courierTrack: e.target.value }))}
                  placeholder="TN 30 AB 1234"
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
            onSendWhatsApp={(message) =>
              openWhatsApp({
                recipientName: paymentsOrder.shopName || 'Shop',
                recipientPhone: paymentsOrder.phone ?? undefined,
                defaultMessage: message,
                defaultImageUrl: '/wa-template.jpeg',
              })
            }
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

      {viewTarget && (
        <Modal title={`${viewTarget.shopName} - Order Details`} onClose={() => setViewTarget(null)} wide>
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-sm">
              <ViewField label="Job No" value={viewTarget.jobNumber ?? '-'} />
              <ViewField label="Shop" value={viewTarget.shopName} />
              <ViewField label="Phone" value={viewTarget.phone ?? '-'} />
              <ViewField label="Order Date" value={formatDate(viewTarget.orderDate)} />
              <ViewField label="Vehicle Number" value={viewTarget.courierTrack ?? '-'} />
              <ViewField label="Actual Delivery Date" value={viewTarget.actualDeliveryDate ? formatDate(viewTarget.actualDeliveryDate) : '-'} />
              <ViewField label="Delivery Status" value={viewTarget.deliveryStatus} />
              <ViewField label="Total Order Value" value={formatCurrency(viewTarget.totalAmount ?? 0)} />
              <ViewField label="Received" value={formatCurrency(viewTarget.receivedAmount ?? 0)} />
              <ViewField label="Balance" value={formatCurrency(viewTarget.balanceAmount ?? 0)} />
              <ViewField label="Created By" value={viewTarget.createdBy?.name ?? '-'} />
            </div>

            <div className="border-t border-brand-100 pt-3">
              <h3 className="text-sm font-semibold text-brand-900 mb-2">Products ({viewTarget.items.length})</h3>
              <div className="space-y-2 max-h-[45vh] overflow-y-auto">
                {viewTarget.items.length === 0 && <p className="text-sm text-brand-400">{viewTarget.model ?? 'No line items'}</p>}
                {viewTarget.items.map((item) => (
                  <div key={item.id} className="border border-brand-100 rounded-lg p-3">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
                      <ViewField label="Model No" value={item.modelNo ?? 'Not Updated'} />
                      <ViewField label="Product" value={item.productName} />
                      <ViewField label="Finish" value={item.finish ?? '-'} />
                      <ViewField label="Size" value={[item.size, item.sizeUnit].filter(Boolean).join(' ') || '-'} />
                      <ViewField label="Pattern" value={item.pattern ?? '-'} />
                      <ViewField label="Qty" value={String(item.qty)} />
                      <ViewField label="Unit Price" value={item.unitPrice != null ? formatCurrency(item.unitPrice) : '-'} />
                      <ViewField label="Line Total" value={item.totalValue != null ? formatCurrency(item.totalValue) : '-'} />
                      <ViewField label="From Stock" value={String(item.stockReservedQty ?? 0)} />
                      <ViewField label="From Production" value={String(item.productionQty ?? 0)} />
                      <div className="col-span-2">
                        <ViewField label="Details" value={item.details ?? '-'} />
                      </div>
                    </div>
                    {(item.productionQty ?? 0) > 0 && (
                      <div className="pt-2 mt-2 border-t border-brand-100">
                        <PartyLineProduction itemId={item.id} />
                        {hasRole('ADMIN') && viewTarget.deliveryStatus !== 'DELIVERED' && (
                          <button className="btn-secondary text-xs mt-2" onClick={() => setAssignProductionItem({ order: viewTarget, item })}>
                            Assign to Production
                          </button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className="flex justify-end pt-2">
              <button className="btn-secondary" onClick={() => setViewTarget(null)}>
                Close
              </button>
            </div>
          </div>
        </Modal>
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

      {assignProductionItem && (
        <AssignProductionModal
          productName={assignProductionItem.item.productName}
          onClose={() => setAssignProductionItem(null)}
          onSubmit={async (payload: AssignProductionPayload) => {
            await api.post(
              `/party-orders/${assignProductionItem.order.id}/items/${assignProductionItem.item.id}/assign-production`,
              payload,
            );
            setNotice(`Work assigned for ${assignProductionItem.item.productName}.`);
            setAssignProductionItem(null);
            setViewTarget(null);
            mutate();
          }}
        />
      )}

      {shopManagerOpen && (
        <ShopManagerModal onClose={() => setShopManagerOpen(false)} onChange={() => mutateShops()} />
      )}

      {showModal && whatsappOptions && (
        <WhatsAppModal
          onClose={closeWhatsApp}
          recipientInfo={{
            name: whatsappOptions.recipientName,
            phone: whatsappOptions.recipientPhone,
          }}
          defaultMessage={whatsappOptions.defaultMessage}
          defaultImageUrl={whatsappOptions.defaultImageUrl}
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

const LINE_STAGE_CHIP: Record<string, ChipColor> = { CARPENTER: 'blue', CARVING: 'amber', POLISH: 'darkGreen' };
const LINE_STATUS_CHIP: Record<string, ChipColor> = {
  ASSIGNED: 'gray',
  IN_PROGRESS: 'blue',
  QUALITY_CHECK: 'amber',
  REWORK: 'red',
  COMPLETED: 'green',
};

// Shows who's actually making this line's units, if production has been
// assigned yet - the line otherwise only shows a bare "Assign to
// Production" button with no way to tell whether that was already done.
function PartyLineProduction({ itemId }: { itemId: string }) {
  const { data: workItems, isLoading } = useSWR<CarpenterWorkItem[]>(`/carpenter-work-items?sourcePartyOrderItemId=${itemId}`, fetcher);

  if (isLoading) return null;
  if (!workItems || workItems.length === 0) {
    return <p className="text-xs text-brand-400">No production job assigned yet.</p>;
  }
  return (
    <div className="space-y-1">
      {workItems.map((w) => (
        <div key={w.id} className="flex items-center gap-2 flex-wrap text-xs">
          <Chip color={LINE_STAGE_CHIP[w.stage] ?? 'gray'} label={w.stage} />
          <span className="text-brand-600">{w.carpenter?.name ?? 'Unassigned'}</span>
          <span className="text-brand-400">Qty {w.quantity}</span>
          <Chip color={LINE_STATUS_CHIP[w.status] ?? 'gray'} label={w.status.replace('_', ' ')} />
        </div>
      ))}
    </div>
  );
}
