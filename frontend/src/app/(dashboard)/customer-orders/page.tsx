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
import { UnitSelect } from '@/components/UnitSelect';
import type { CustomerOrder, DeliveryStatus, Product, CarpenterWorkItem } from '@/types';

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
}

const emptyRow: ItemRow = { productName: '', category: '', size: '', sizeUnit: '', color: '', quantity: '1', unitPrice: '' };

const emptyForm = {
  orderId: '',
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
  const [assignTarget, setAssignTarget] = useState<CustomerOrder | null>(null);
  const [viewTarget, setViewTarget] = useState<CustomerOrder | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [selectedGalleryImages, setSelectedGalleryImages] = useState<GalleryImage[]>([]);
  const [galleryPickerOpen, setGalleryPickerOpen] = useState(false);

  function toggleGalleryImage(image: GalleryImage) {
    setSelectedGalleryImages((prev) =>
      prev.some((i) => i.id === image.id) ? prev.filter((i) => i.id !== image.id) : [...prev, image],
    );
  }

  function openCreate() {
    setEditing(null);
    setForm(emptyForm);
    setItems([{ ...emptyRow }]);
    setSelectedGalleryImages([]);
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
          }))
        : [{ ...emptyRow, productName: order.product, unitPrice: String(order.orderValue ?? 0) }],
    );
    setSelectedGalleryImages(order.galleryImages ?? []);
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
          })),
        galleryImageIds: selectedGalleryImages.map((i) => i.id),
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

  // Mirrors the "Dear Sir, kindly check and confirm..." confirmation
  // format, built from whatever this order actually has on file - there's
  // no separate COT/MATTRESS/DRESSING TABLE breakdown in the schema (that
  // level of detail lives in specialInstructions as free text today), so
  // this stays to Order/Size/Colour/Items/Payment, all real data.
  function buildOrderConfirmationMessage(order: CustomerOrder): string {
    const lines = [
      `Dear Sir,`,
      ``,
      `Kindly check and confirm the following order details:`,
      ``,
      `*ORDER DETAILS*`,
      `Order ID: ${order.orderId}`,
      order.size ? `Size: ${order.size}${order.sizeUnit ? ` ${order.sizeUnit}` : ''}` : null,
      order.colour ? `Colour: ${order.colour}` : null,
      ``,
      ...(order.items?.length
        ? order.items.map((i) => `${i.productName} - Qty: ${i.quantity} x ₹${i.unitPrice}`)
        : [`Product: ${order.product}`]),
      order.specialInstructions ? `` : null,
      order.specialInstructions ? `Special Instructions: ${order.specialInstructions}` : null,
      ``,
      `*PAYMENT DETAILS*`,
      `Order Value: ₹${order.orderValue ?? 0}`,
      order.totalReceived ? `Advance Paid: ₹${order.totalReceived}` : null,
      `Balance Amount: ₹${order.balanceAmount ?? order.orderValue ?? 0}`,
      ``,
      `Please check all the above details carefully. Once confirmed, changes cannot be made. If everything is correct, kindly reply:`,
      ``,
      `"Confirmed – All Details OK."`,
      ``,
      `Thank you.`,
    ].filter((l) => l !== null);
    return lines.join('\n');
  }

  function handleSendWhatsApp(order: CustomerOrder) {
    const galleryUrls = (order.galleryImages ?? []).map((i) => assetUrl(i.url)).filter((u): u is string => Boolean(u));
    openWhatsApp({
      recipientName: (order.customerName ?? '') || 'Customer',
      recipientPhone: order.phone ?? undefined,
      defaultMessage: buildOrderConfirmationMessage(order),
      // Selected Gallery images (if any) go out instead of the generic
      // template image - multiple images send as one message per image.
      ...(galleryUrls.length > 0 ? { defaultImageUrls: galleryUrls } : { defaultImageUrl: '/wa-template.jpeg' }),
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
                <td colSpan={11} className="text-center py-8 text-brand-400">
                  Loading orders...
                </td>
              </tr>
            )}
            {!isLoading && data?.length === 0 && (
              <tr>
                <td colSpan={11} className="text-center py-8 text-brand-400">
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
            <FormRow>
              <FormField label="Size">
                <input
                  className="input"
                  placeholder="e.g. 78x72"
                  value={form.size}
                  onChange={(e) => setForm((f) => ({ ...f, size: e.target.value }))}
                />
              </FormField>
              <FormField label="Size Unit">
                <UnitSelect value={form.sizeUnit} onChange={(v) => setForm((f) => ({ ...f, sizeUnit: v }))} />
              </FormField>
            </FormRow>

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
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        <input
                          className="input"
                          placeholder="Category"
                          value={row.category}
                          onChange={(e) => updateItemRow(idx, { category: e.target.value })}
                        />
                        <input
                          className="input"
                          placeholder="Size"
                          value={row.size}
                          onChange={(e) => updateItemRow(idx, { size: e.target.value })}
                        />
                        <UnitSelect value={row.sizeUnit} onChange={(v) => updateItemRow(idx, { sizeUnit: v })} />
                      </div>
                      <input
                        className="input"
                        placeholder="Polish Colour (e.g. Walnut Brown)"
                        value={row.color}
                        onChange={(e) => updateItemRow(idx, { color: e.target.value })}
                      />
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

            <div>
              <label className="label">Product Images / Gallery</label>
              <button type="button" className="btn-secondary w-full justify-start text-left" onClick={() => setGalleryPickerOpen(true)}>
                {selectedGalleryImages.length > 0 ? `${selectedGalleryImages.length} image(s) selected` : 'Select Gallery Images...'}
              </button>
              {selectedGalleryImages.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {selectedGalleryImages.map((img) => (
                    <div key={img.id} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={assetUrl(img.url) ?? ''} alt={img.fileName} className="h-14 w-14 object-cover rounded-md border border-brand-200" />
                      <button
                        type="button"
                        className="absolute -top-1.5 -right-1.5 h-5 w-5 rounded-full bg-red-500 text-white text-[11px] leading-none"
                        onClick={() => toggleGalleryImage(img)}
                      >
                        ×
                      </button>
                    </div>
                  ))}
                </div>
              )}
              <p className="text-[11px] text-brand-400 mt-1">Picked from the existing Gallery - never uploaded again.</p>
            </div>

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

      {galleryPickerOpen && (
        <Modal title="Select Gallery Images" onClose={() => setGalleryPickerOpen(false)} wide>
          <GalleryGrid
            canManage={false}
            selectable
            selectedIds={selectedGalleryImages.map((i) => i.id)}
            onToggle={toggleGalleryImage}
          />
          <div className="flex justify-end pt-3">
            <button type="button" className="btn-primary text-sm" onClick={() => setGalleryPickerOpen(false)}>
              Done ({selectedGalleryImages.length} selected)
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
