'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError, getAccessToken } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate, toDateInputValue } from '@/lib/format';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StatusBadge, BalanceBadge, Chip, type ChipColor } from '@/components/StatusBadge';
import { ViewField } from '@/components/ViewField';
import { PaymentsPanel } from '@/components/PaymentsPanel';
import { FormRow, FormField } from '@/components/orders/OrderFormFields';
import { AssignProductionModal, type AssignProductionPayload } from '@/components/AssignProductionModal';
import { ActionsMenu } from '@/components/ActionsMenu';
import { RoleGate } from '@/components/RoleGate';
import { ModelNoPicker } from '@/components/ModelNoPicker';
import { GalleryGrid } from '@/components/GalleryGrid';
import type { GalleryImage } from '@/types';
import { assetUrl } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { Pagination, type PaginatedResult } from '@/components/Pagination';
import { WhatsAppModal } from '@/components/WhatsAppModal';
import { WhatsAppActionButton } from '@/components/WhatsAppActionButton';
import { useWhatsApp } from '@/hooks/useWhatsApp';
import { useForceable } from '@/hooks/useForceable';
import { sharePdf } from '@/lib/sharePdf';
import { buildCustomerOrderMessage } from '@/lib/orderMessages';
import type { CustomerOrder, CustomerOrderItem, DeliveryStatus, Product, CarpenterWorkItem } from '@/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

interface ItemRow {
  productId?: string;
  modelNo?: string;
  productName: string;
  category: string;
  size: string;
  sizeUnit: string;
  color: string;
  quantity: string;
  unitPrice: string;
  availableQuantity?: number;
  referenceImageId?: string;
  referenceImage?: GalleryImage | null;
}

const emptyRow: ItemRow = { productName: '', category: '', size: '', sizeUnit: '', color: '', quantity: '1', unitPrice: '' };

const emptyForm = {
  orderId: 'SSS-',
  orderDate: new Date().toISOString().slice(0, 10),
  customerName: '',
  phone: '',
  address: '',
  size: '',
  sizeUnit: '',
  actualDeliveryDate: '',
  deliveryStatus: 'PENDING' as DeliveryStatus,
};

function CustomerOrdersContent() {
  const { hasRole } = useAuth();
  const { forcePrompt, closeForcePrompt, runForceable } = useForceable();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [page, setPage] = useState(1);
  const { data: result, isLoading, mutate } = useSWR<PaginatedResult<CustomerOrder>>(
    `/customer-orders?${new URLSearchParams({
      ...(search ? { search } : {}),
      ...(statusFilter ? { status: statusFilter } : {}),
      page: String(page),
      limit: '20',
    })}`,
    fetcher,
  );
  const data = result?.data;

  // Any filter change starts back at page 1 - otherwise you can land on a
  // now-empty page 4 after narrowing a search down to 2 results.
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
  function selectItemProduct(idx: number, product: Product | null) {
    if (!product) {
      updateItemRow(idx, { productId: undefined, availableQuantity: undefined });
      return;
    }
    updateItemRow(idx, {
      productId: product.id,
      modelNo: product.modelNo ?? '',
      productName: product.name,
      category: product.category ?? '',
      size: product.modelSize ?? '',
      sizeUnit: product.sizeUnit ?? '',
      unitPrice: String(product.retailPrice ?? 0),
      availableQuantity: product.availableQuantity,
    });
  }
  const lineTotal = (row: ItemRow) => (parseFloat(row.quantity) || 0) * (parseFloat(row.unitPrice) || 0);
  const formTotal = items.reduce((s, r) => s + lineTotal(r), 0);

  const [paymentsOrder, setPaymentsOrder] = useState<CustomerOrder | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<CustomerOrder | null>(null);
  // Multi-product orders open the picker (list every line, pick which one to
  // assign) instead of jumping straight to the assign form - a single order
  // can have several products, each needing its own worker/stage/price.
  const [assignTarget, setAssignTarget] = useState<CustomerOrder | null>(null);
  const [assignItemTarget, setAssignItemTarget] = useState<{ order: CustomerOrder; item: CustomerOrderItem } | null>(null);
  const [viewTarget, setViewTarget] = useState<CustomerOrder | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  // Which product row's own image picker is open, if any.
  const [itemImagePickerIdx, setItemImagePickerIdx] = useState<number | null>(null);

  function setItemImage(idx: number, image: GalleryImage | null) {
    updateItemRow(idx, { referenceImageId: image?.id, referenceImage: image });
  }

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
      size: order.size ?? '',
      sizeUnit: order.sizeUnit ?? '',
      actualDeliveryDate: toDateInputValue(order.actualDeliveryDate),
      deliveryStatus: order.deliveryStatus,
    });
    setItems(
      order.items?.length
        ? order.items.map((i) => ({
            productId: i.productId ?? undefined,
            productName: i.productName,
            category: i.category ?? '',
            size: i.size ?? '',
            sizeUnit: i.sizeUnit ?? '',
            color: i.color ?? '',
            quantity: String(i.quantity),
            unitPrice: String(i.unitPrice),
            referenceImageId: i.referenceImageId ?? undefined,
            referenceImage: i.referenceImage ?? null,
          }))
        : [{ ...emptyRow, productName: order.product, unitPrice: String(order.orderValue ?? 0) }],
    );
    setFormError(null);
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setFormError(null);
    setSubmitting(true);
    const payload = {
      orderId: form.orderId,
      orderDate: form.orderDate,
      customerName: form.customerName,
      phone: form.phone || undefined,
      address: form.address || undefined,
      size: form.size || undefined,
      sizeUnit: form.sizeUnit || undefined,
      actualDeliveryDate: form.actualDeliveryDate || undefined,
      deliveryStatus: form.deliveryStatus,
      items: items
        .filter((i) => i.productName && i.unitPrice)
        .map((i) => ({
          productId: i.productId,
          productName: i.productName,
          category: i.category || undefined,
          size: i.size || undefined,
          sizeUnit: i.sizeUnit || undefined,
          color: i.color || undefined,
          quantity: parseInt(i.quantity, 10) || 1,
          unitPrice: parseFloat(i.unitPrice),
          referenceImageId: i.referenceImageId || undefined,
        })),
      // galleryImageIds intentionally omitted - the order-wide gallery
      // picker was removed from this form (each product line has its own
      // image instead); omitting the field leaves any pre-existing
      // order-wide selection on an order untouched rather than clearing it.
    };
    await runForceable(async (force) => {
      try {
        if (editing) {
          await api.patch(`/customer-orders/${editing.id}${force ? '?force=true' : ''}`, payload);
        } else {
          await api.post('/customer-orders', payload);
        }
        setFormOpen(false);
        mutate();
      } catch (err) {
        setFormError(err instanceof ApiError ? err.message : 'Failed to save order');
        throw err;
      } finally {
        setSubmitting(false);
      }
    }, hasRole('SUPERADMIN'));
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    await runForceable(async (force) => {
      try {
        await api.delete(`/customer-orders/${target.id}${force ? '?force=true' : ''}`);
        setDeleteTarget(null);
        mutate();
      } catch (err) {
        // Global toast (lib/api.ts) already shows why - a 409 from a
        // non-Super-Admin, or any other error, just leaves the confirm
        // dialog open so the user can Cancel or retry.
        throw err;
      }
    }, hasRole('SUPERADMIN'));
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
    a.download = `Order Confirmation - ${order.orderId}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function handleSendWhatsApp(order: CustomerOrder) {
    const galleryUrls = (order.galleryImages ?? []).map((i) => assetUrl(i.url)).filter((u): u is string => Boolean(u));
    openWhatsApp({
      recipientName: (order.customerName ?? '') || 'Customer',
      recipientPhone: order.phone ?? undefined,
      defaultMessage: buildCustomerOrderMessage(order, 'customer'),
      messageVariants: {
        customer: buildCustomerOrderMessage(order, 'customer'),
        employee: buildCustomerOrderMessage(order, 'employee'),
      },
      // Selected Gallery images (if any) go out instead of the generic
      // template image - multiple images send as one message per image.
      ...(galleryUrls.length > 0 ? { defaultImageUrls: galleryUrls } : { defaultImageUrl: '/wa-template.jpeg' }),
      // Lets the sender attach the branded PDF instead, from inside the
      // same chat-picker popup - see WhatsAppModal's "Attach Order
      // Confirmation PDF" button.
      pdfUrl: `/customer-orders/${order.id}/pdf`,
      pdfFilename: `Order Confirmation - ${order.orderId}.pdf`,
    });
  }

  // "Send PDF via WhatsApp" specifically - lets the sender pick which chat
  // or group to send to (same picker popup), with the PDF fetched and
  // attached automatically (autoAttachPdf) instead of making them notice
  // and click "Attach PDF" themselves - sending itself still only happens
  // when they click Send Message inside the popup.
  function handleSendPdfViaWhatsApp(order: CustomerOrder) {
    openWhatsApp({
      recipientName: (order.customerName ?? '') || 'Customer',
      recipientPhone: order.phone ?? undefined,
      // No caption text - this action sends only the PDF file itself.
      defaultMessage: '',
      pdfUrl: `/customer-orders/${order.id}/pdf`,
      pdfFilename: `Order Confirmation - ${order.orderId}.pdf`,
      autoAttachPdf: true,
    });
  }

  // Separate from the in-popup attach flow below -
  // hands the PDF to the device's native share sheet (WhatsApp, email,
  // anything installed), which doesn't depend on the backend's own
  // WhatsApp connection being up. Falls back to a normal download on
  // browsers with no file-sharing support.
  async function shareOrderPdf(order: CustomerOrder) {
    setNotice(null);
    try {
      const result = await sharePdf(
        `/customer-orders/${order.id}/pdf`,
        `Order Confirmation - ${order.orderId}.pdf`,
        `Order Confirmation - ${order.orderId}`,
      );
      if (result === 'downloaded') setNotice('Sharing is not supported on this browser - the PDF was downloaded instead.');
    } catch {
      setNotice('Failed to share the PDF');
    }
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
              <th>Order ID</th>
              <th>Job No.</th>
              <th>Model No</th>
              <th>Date</th>
              <th>Customer</th>
              <th>Image</th>
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
                <td>{formatDate(order.orderDate)}</td>
                <td>
                  {order.customerName}
                  {order.phone && <div className="text-xs text-brand-400">{order.phone}</div>}
                </td>
                <td>
                  <OrderThumbnail order={order} />
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
                        { label: 'View Details', onClick: () => setViewTarget(order) },
                        { label: 'Payments', onClick: () => setPaymentsOrder(order) },
                        { label: 'Edit', onClick: () => openEdit(order) },
                        { label: 'Download PDF', onClick: () => downloadOrderPdf(order) },
                        {
                          label: 'Send PDF via WhatsApp',
                          onClick: () => handleSendPdfViaWhatsApp(order),
                        },
                        { label: 'Share PDF', onClick: () => shareOrderPdf(order) },
                        {
                          label: 'Assign to Production',
                          onClick: () => setAssignTarget(order),
                          hidden: !hasRole('ADMIN') || order.deliveryStatus === 'DELIVERED',
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
              <label className="label">Products</label>
              <div className="space-y-2">
                {items.map((row, idx) => {
                  const qty = parseInt(row.quantity, 10) || 1;
                  const available = row.availableQuantity ?? 0;
                  const stockPortion = row.productId ? Math.min(qty, available) : 0;
                  const productionPortion = qty - stockPortion;
                  return (
                    <div key={idx} className="space-y-1 border border-brand-100 rounded-lg p-2">
                      <div className="grid grid-cols-1 sm:grid-cols-[140px_1fr] gap-2">
                        <ModelNoPicker
                          modelNo={row.modelNo ?? ''}
                          onChangeModelNo={(v) => updateItemRow(idx, { modelNo: v })}
                          onSelect={(p) => selectItemProduct(idx, p)}
                        />
                        <input
                          className="input"
                          placeholder="Product Name"
                          value={row.productName}
                          onChange={(e) => updateItemRow(idx, { productName: e.target.value, productId: undefined })}
                        />
                      </div>
                      <input
                        className="input"
                        placeholder="Category"
                        value={row.category}
                        onChange={(e) => updateItemRow(idx, { category: e.target.value })}
                      />
                      <input
                        className="input"
                        placeholder="Size (e.g. 6x3 ft)"
                        value={row.size}
                        onChange={(e) => updateItemRow(idx, { size: e.target.value })}
                      />
                      <input
                        className="input"
                        placeholder="Polish Colour (e.g. Walnut Brown)"
                        value={row.color}
                        onChange={(e) => updateItemRow(idx, { color: e.target.value })}
                      />
                      <div className="flex items-center gap-2">
                        {row.referenceImage ? (
                          <div className="relative">
                            {/* eslint-disable-next-line @next/next/no-img-element */}
                            <img
                              src={assetUrl(row.referenceImage.url) ?? ''}
                              alt={row.referenceImage.fileName}
                              className="h-12 w-12 object-cover rounded-md border border-brand-200"
                            />
                            <button
                              type="button"
                              className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white text-[11px] leading-none"
                              onClick={() => setItemImage(idx, null)}
                            >
                              ×
                            </button>
                          </div>
                        ) : null}
                        <button
                          type="button"
                          className="btn-secondary text-xs px-2 py-1"
                          onClick={() => setItemImagePickerIdx(idx)}
                        >
                          {row.referenceImage ? 'Change Image' : '+ Add Image'}
                        </button>
                      </div>
                      <div className="grid grid-cols-2 sm:grid-cols-[70px_110px_100px_auto] gap-2 sm:items-center">
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
                      {row.productId && (
                        <p className="text-[11px] text-brand-500 px-0.5">
                          Model No is {available > 0 ? <span className="text-emerald-700">In Stock</span> : <span className="text-red-600">Sold</span>} - Required: {qty} →{' '}
                          {stockPortion > 0 && <span className="text-emerald-700">Stock {stockPortion}</span>}
                          {stockPortion > 0 && productionPortion > 0 && ' + '}
                          {productionPortion > 0 && <span className="text-amber-600">Production {productionPortion}</span>}
                        </p>
                      )}
                    </div>
                  );
                })}
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
            onSendWhatsApp={(message) =>
              openWhatsApp({
                recipientName: paymentsOrder.customerName || 'Customer',
                recipientPhone: paymentsOrder.phone ?? undefined,
                defaultMessage: message,
                defaultImageUrl: '/wa-template.jpeg',
              })
            }
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

      {forcePrompt && (
        <ConfirmDialog
          title="Force This Through?"
          message={`${forcePrompt.message}\n\nAs Super Admin you can force this through anyway - this permanently removes the connected production/stock history rather than just losing the link to it. This cannot be undone.`}
          confirmLabel="Force Through Anyway"
          danger
          onConfirm={forcePrompt.onForce}
          onCancel={closeForcePrompt}
        />
      )}

      {assignTarget && (assignTarget.items?.length ?? 0) > 0 && (
        <AssignProductionPickerModal
          order={assignTarget}
          onClose={() => setAssignTarget(null)}
          onPickItem={(item) => {
            setAssignItemTarget({ order: assignTarget, item });
            setAssignTarget(null);
          }}
        />
      )}

      {assignItemTarget && (
        <AssignProductionModal
          productName={assignItemTarget.item.productName}
          initialCategory={assignItemTarget.item.category ?? undefined}
          initialColor={assignItemTarget.item.color ?? undefined}
          initialQuantity={assignItemTarget.item.productionQty}
          onOpenWhatsAppPicker={
            hasRole('SUPERADMIN')
              ? () =>
                  openWhatsApp({
                    recipientName: assignItemTarget.item.productName,
                    defaultMessage: `New work assigned - ${assignItemTarget.item.productName} for order ${assignItemTarget.order.orderId} (${assignItemTarget.order.customerName}).`,
                  })
              : undefined
          }
          onClose={() => setAssignItemTarget(null)}
          onSubmit={async (payload: AssignProductionPayload) => {
            const result = await api.post<{ whatsapp?: { sent: boolean; reason?: string; group?: { sent: boolean; reason?: string } } }>(
              `/customer-orders/${assignItemTarget.order.id}/items/${assignItemTarget.item.id}/assign-production`,
              payload,
            );
            const w = result.whatsapp;
            const whatsappNote = w?.sent || w?.group?.sent
              ? ` WhatsApp sent${w?.sent ? ' to worker' : ''}${w?.group?.sent ? (w?.sent ? ' and team group' : ' to team group') : ''}.`
              : '';
            setNotice(`Work assigned for ${assignItemTarget.item.productName}.${whatsappNote}`);
            setAssignItemTarget(null);
            mutate();
          }}
        />
      )}

      {assignTarget && (assignTarget.items?.length ?? 0) === 0 && (
        <AssignProductionModal
          productName={assignTarget.product}
          onClose={() => setAssignTarget(null)}
          onSubmit={async (payload: AssignProductionPayload) => {
            const result = await api.post<{ whatsapp?: { sent: boolean; reason?: string; group?: { sent: boolean; reason?: string } } }>(
              `/customer-orders/${assignTarget.id}/assign-production`,
              payload,
            );
            const w = result.whatsapp;
            const whatsappNote = w?.sent || w?.group?.sent
              ? ` WhatsApp sent${w?.sent ? ' to worker' : ''}${w?.group?.sent ? (w?.sent ? ' and team group' : ' to team group') : ''}.`
              : '';
            setNotice(`Work assigned.${whatsappNote}`);
            setAssignTarget(null);
            mutate();
          }}
        />
      )}

      {viewTarget && <OrderDetailsModal order={viewTarget} onClose={() => setViewTarget(null)} />}

      {itemImagePickerIdx !== null && (
        <Modal title="Select Product Image" onClose={() => setItemImagePickerIdx(null)} wide>
          <GalleryGrid
            canManage={false}
            selectable
            selectedIds={items[itemImagePickerIdx]?.referenceImageId ? [items[itemImagePickerIdx].referenceImageId as string] : []}
            onToggle={(image) => {
              setItemImage(itemImagePickerIdx, image);
              setItemImagePickerIdx(null);
            }}
          />
          <div className="flex justify-end pt-3">
            <button type="button" className="btn-secondary text-sm" onClick={() => setItemImagePickerIdx(null)}>
              Close
            </button>
          </div>
        </Modal>
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
          defaultImageUrls={whatsappOptions.defaultImageUrls}
          pdfUrl={whatsappOptions.pdfUrl}
          pdfFilename={whatsappOptions.pdfFilename}
          autoAttachPdf={whatsappOptions.autoAttachPdf}
          messageVariants={whatsappOptions.messageVariants}
          defaultRecipientType={whatsappOptions.defaultRecipientType}
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

const STAGE_CHIP: Record<string, ChipColor> = { CARPENTER: 'blue', CARVING: 'amber', POLISH: 'darkGreen' };
const STATUS_CHIP: Record<string, ChipColor> = {
  ASSIGNED: 'gray',
  IN_PROGRESS: 'blue',
  QUALITY_CHECK: 'amber',
  REWORK: 'red',
  COMPLETED: 'green',
};

// "Assign to Production" on a multi-product order can't just open one form
// for "the order" - each line is its own product, possibly going to a
// different worker/stage/price. This lists every line (pulled straight from
// what was already entered on the order form - never asks again) and shows
// each one's current production status, or an Assign button if it doesn't
// have one yet.
function AssignProductionPickerModal({
  order,
  onClose,
  onPickItem,
}: {
  order: CustomerOrder;
  onClose: () => void;
  onPickItem: (item: CustomerOrderItem) => void;
}) {
  const { data: workItems } = useSWR<CarpenterWorkItem[]>(`/carpenter-work-items?sourceCustomerOrderId=${order.id}`, fetcher);
  const items = order.items ?? [];

  return (
    <Modal title={`Assign to Production - ${order.orderId}`} onClose={onClose} wide>
      <div className="space-y-3">
        <p className="text-xs text-brand-400">Pick which product to assign - already-entered details carry over, so nothing needs retyping.</p>
        {items.map((item) => {
          const existing = (workItems ?? []).filter((w) => w.sourceCustomerOrderItemId === item.id);
          // A placeholder work item exists for every line the moment the
          // order is created (that's what makes it show up as "Waiting" on
          // Production Control before anyone's touched it) - so "a work
          // item exists" is not the same as "this line has actually been
          // assigned a worker". Only a claimed (carpenterId set) row means
          // that; an unclaimed one still needs the Assign button.
          const claimed = existing.filter((w) => w.carpenterId);
          const canAssign = existing.length === 0 || claimed.length < existing.length;
          const needsProduction = (item.productionQty ?? 0) > 0;
          return (
            <div key={item.id} className="border border-brand-100 rounded-lg p-3 space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 text-sm">
                <ViewField label="Product" value={item.productName} />
                <ViewField label="Category" value={item.category ?? '-'} />
                <ViewField label="Size" value={[item.size, item.sizeUnit].filter(Boolean).join(' ') || '-'} />
                <ViewField label="Qty" value={String(item.quantity)} />
              </div>
              {!needsProduction && <p className="text-xs text-emerald-700">Fully fulfilled from Godown Stock - no production needed.</p>}
              {claimed.length > 0 && (
                <div className="space-y-1">
                  {claimed.map((w) => (
                    <div key={w.id} className="flex items-center gap-2 flex-wrap text-xs">
                      <Chip color={STAGE_CHIP[w.stage] ?? 'gray'} label={w.stage} />
                      <span className="text-brand-600">{w.carpenter?.name}</span>
                      <span className="text-brand-400">Qty {w.quantity}</span>
                      <Chip color={STATUS_CHIP[w.status] ?? 'gray'} label={w.status.replace('_', ' ')} />
                    </div>
                  ))}
                </div>
              )}
              {needsProduction && canAssign && (
                <button type="button" className="btn-primary text-xs" onClick={() => onPickItem(item)}>
                  Assign to Production
                </button>
              )}
            </div>
          );
        })}
        <div className="flex justify-end pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}

// Table thumbnail - prefers each line's own product image; falls back to
// the order-wide gallery selection for older orders that only ever used
// that. Shows the first image plus a "+N" badge when there's more than one.
function OrderThumbnail({ order }: { order: CustomerOrder }) {
  const itemImages = (order.items ?? []).map((i) => i.referenceImage).filter((img): img is GalleryImage => Boolean(img));
  const images = itemImages.length > 0 ? itemImages : order.galleryImages ?? [];
  if (images.length === 0) return <span className="text-brand-300 text-xs">-</span>;
  const first = images[0];
  return (
    <div className="relative inline-block">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={assetUrl(first.url) ?? ''} alt={first.fileName} className="h-10 w-10 object-cover rounded-md border border-brand-200" />
      {images.length > 1 && (
        <span className="absolute -bottom-1 -right-1 bg-brand-700 text-white text-[9px] leading-none rounded-full h-4 w-4 flex items-center justify-center">
          +{images.length - 1}
        </span>
      )}
    </div>
  );
}

// "Who's actually making this" - the order list only shows who's
// responsible for entering the Model No (a separate, optional field), which
// looks like "nobody's working on it" even when production is well
// underway. This pulls the real Carpenter/Carving/Polish job(s) for the
// order so that question has a real answer.
function OrderDetailsModal({ order, onClose }: { order: CustomerOrder; onClose: () => void }) {
  const { data: workItems, isLoading } = useSWR<CarpenterWorkItem[]>(
    `/carpenter-work-items?sourceCustomerOrderId=${order.id}`,
    fetcher,
  );

  return (
    <Modal title={`${order.orderId} - Order Details`} onClose={onClose} wide>
      <div className="space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-sm">
          <ViewField label="Job No" value={order.jobNumber ?? '-'} />
          <ViewField label="Customer" value={order.customerName} />
          <ViewField label="Phone" value={order.phone ?? '-'} />
          <ViewField label="Order Date" value={formatDate(order.orderDate)} />
          <ViewField label="Model No" value={order.cotTrack ?? 'Not Updated'} />
          <ViewField label="Model No Entered By" value={order.modelNoUpdatedBy?.name ?? 'Not entered yet'} />
          <ViewField label="Delivery Status" value={order.deliveryStatus} />
          <ViewField label="Order Value" value={formatCurrency(order.orderValue ?? 0)} />
          <ViewField label="Balance" value={formatCurrency(order.balanceAmount ?? 0)} />
        </div>

        <div className="border-t border-brand-100 pt-3">
          <h3 className="text-sm font-semibold text-brand-900 mb-2">Products</h3>
          <div className="space-y-2">
            {(order.items ?? []).map((item) => (
              <div key={item.id} className="border border-brand-100 rounded-lg p-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
                  <ViewField label="Product" value={item.productName} />
                  <ViewField label="Category" value={item.category ?? '-'} />
                  <ViewField label="Size" value={[item.size, item.sizeUnit].filter(Boolean).join(' ') || '-'} />
                  {item.color && <ViewField label="Polish Colour" value={item.color} />}
                  <ViewField label="Qty" value={String(item.quantity)} />
                  <ViewField label="From Stock" value={String(item.stockReservedQty ?? 0)} />
                  <ViewField label="From Production" value={String(item.productionQty ?? 0)} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="border-t border-brand-100 pt-3">
          <h3 className="text-sm font-semibold text-brand-900 mb-2">Who&apos;s Working On It</h3>
          {isLoading && <p className="text-sm text-brand-400">Loading...</p>}
          {!isLoading && (workItems?.length ?? 0) === 0 && (
            <p className="text-sm text-brand-400">No production job has been assigned for this order yet.</p>
          )}
          <div className="space-y-2">
            {workItems?.map((w) => (
              <div key={w.id} className="border border-brand-100 rounded-lg p-3">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
                  <ViewField label="Stage" value={<Chip color={STAGE_CHIP[w.stage] ?? 'gray'} label={w.stage} />} />
                  <ViewField label="Employee" value={w.carpenter?.name ?? 'Unassigned'} />
                  <ViewField label="Qty" value={String(w.quantity)} />
                  {w.stage === 'POLISH' && <ViewField label="Colour" value={w.color ?? 'Not set'} />}
                  <ViewField label="Status" value={<Chip color={STATUS_CHIP[w.status] ?? 'gray'} label={w.status.replace('_', ' ')} />} />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex justify-end pt-2">
          <button className="btn-secondary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </Modal>
  );
}
