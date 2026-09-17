'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, getAccessToken, assetUrl } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate } from '@/lib/format';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { StatusBadge, BalanceBadge } from '@/components/StatusBadge';
import { ShopManagerModal } from '@/components/ShopManagerModal';
import { PartyOrderFormModal } from '@/components/PartyOrderFormModal';
import { RoleGate } from '@/components/RoleGate';
import { downloadCsv } from '@/lib/csv';
import { WhatsAppModal } from '@/components/WhatsAppModal';
import { WhatsAppActionButton } from '@/components/WhatsAppActionButton';
import { useWhatsApp } from '@/hooks/useWhatsApp';
import { useForceable } from '@/hooks/useForceable';
import { sharePdf } from '@/lib/sharePdf';
import { buildPartyOrderMessage } from '@/lib/orderMessages';
import type { PartyOrder, Shop, GalleryImage } from '@/types';
import { Pagination, type PaginatedResult } from '@/components/Pagination';
import { FilterBar } from '@/components/FilterBar';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const emptyFilters: Record<string, string> = {};
const STATUS_OPTIONS = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'CANCELLED', label: 'Cancelled' },
];
const PAYMENT_STATUS_OPTIONS = [
  { value: 'DUE', label: 'Due' },
  { value: 'SETTLED', label: 'Settled' },
];

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

// Card thumbnail - each line's own product image; shows the first plus a
// "+N" badge when there's more than one.
function OrderThumbnail({ order }: { order: PartyOrder }) {
  const images = order.items.map((i) => i.referenceImage).filter((img): img is GalleryImage => Boolean(img));
  if (images.length === 0) return null;
  const first = images[0];
  return (
    <div className="relative shrink-0">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={assetUrl(first.url) ?? ''} alt={first.fileName} className="h-12 w-12 object-cover rounded-md border border-brand-200" />
      {images.length > 1 && (
        <span className="absolute -bottom-1 -right-1 bg-brand-700 text-white text-[9px] leading-none rounded-full h-4 w-4 flex items-center justify-center">
          +{images.length - 1}
        </span>
      )}
    </div>
  );
}

function PartyOrdersContent() {
  const { hasRole } = useAuth();
  const { forcePrompt, closeForcePrompt, runForceable } = useForceable();
  const [page, setPage] = useState(1);
  const [values, setValues] = useState<Record<string, string>>(emptyFilters);
  const [applied, setApplied] = useState<Record<string, string>>(emptyFilters);
  const [downloadingList, setDownloadingList] = useState(false);
  const { data: shops, mutate: mutateShops } = useSWR<Shop[]>('/shops', fetcher);
  const queryParams = new URLSearchParams({ ...applied, page: String(page), limit: '20' });
  const { data: result, isLoading, mutate } = useSWR<PaginatedResult<PartyOrder>>(`/party-orders?${queryParams}`, fetcher);
  const data = result?.data;
  const [shopManagerOpen, setShopManagerOpen] = useState(false);

  function applyFilters() {
    setApplied(values);
    setPage(1);
  }
  function resetFilters() {
    setValues(emptyFilters);
    setApplied(emptyFilters);
    setPage(1);
  }

  async function downloadListPdf() {
    setDownloadingList(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${API_BASE_URL}/party-orders/pdf?${new URLSearchParams(applied)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `party-orders-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingList(false);
    }
  }

  const { showModal, whatsappOptions, openWhatsApp, closeWhatsApp } = useWhatsApp();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PartyOrder | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<PartyOrder | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  function openCreate() {
    setEditing(null);
    setFormOpen(true);
  }

  function openEdit(e: React.MouseEvent, order: PartyOrder) {
    e.preventDefault();
    e.stopPropagation();
    setEditing(order);
    setFormOpen(true);
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    const target = deleteTarget;
    await runForceable(async (force) => {
      try {
        await api.delete(`/party-orders/${target.id}${force ? '?force=true' : ''}`);
        setDeleteTarget(null);
        mutate();
      } catch (err) {
        throw err;
      }
    }, hasRole('SUPERADMIN'));
  }

  async function downloadOrderPdf(order: PartyOrder) {
    const token = getAccessToken();
    const res = await fetch(`${API_BASE_URL}/party-orders/${order.id}/pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `Order Confirmation - ${order.jobNumber ?? order.id}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  // Separate from the in-popup attach flow -
  // hands the PDF to the device's native share sheet, which doesn't depend
  // on the backend's own WhatsApp connection being up.
  async function shareOrderPdf(order: PartyOrder) {
    setNotice(null);
    try {
      const result = await sharePdf(
        `/party-orders/${order.id}/pdf`,
        `Order Confirmation - ${order.jobNumber ?? order.id}.pdf`,
        `Order Confirmation - ${order.jobNumber ?? order.id}`,
      );
      if (result === 'downloaded') setNotice('Sharing is not supported on this browser - the PDF was downloaded instead.');
    } catch {
      setNotice('Failed to share the PDF');
    }
  }

  function handleSendWhatsApp(order: PartyOrder) {
    openWhatsApp({
      recipientName: (order.shopName ?? '') || 'Shop',
      recipientPhone: order.phone ?? undefined,
      defaultMessage: buildPartyOrderMessage(order, 'customer'),
      messageVariants: {
        customer: buildPartyOrderMessage(order, 'customer'),
        employee: buildPartyOrderMessage(order, 'employee'),
      },
      defaultImageUrl: '/wa-template.jpeg',
      // Lets the sender attach the branded PDF instead, from inside the
      // same chat-picker popup.
      pdfUrl: `/party-orders/${order.id}/pdf`,
      pdfFilename: `Order Confirmation - ${order.jobNumber ?? order.id}.pdf`,
    });
  }

  // "Send PDF via WhatsApp" specifically - the PDF is the point, so it's
  // fetched and attached automatically instead of leaving the sender to
  // notice and click "Attach PDF" themselves - same flow as Customer Orders.
  function handleSendPdfViaWhatsApp(order: PartyOrder) {
    openWhatsApp({
      recipientName: (order.shopName ?? '') || 'Shop',
      recipientPhone: order.phone ?? undefined,
      // No caption text - this action sends only the PDF file itself.
      defaultMessage: '',
      pdfUrl: `/party-orders/${order.id}/pdf`,
      pdfFilename: `Order Confirmation - ${order.jobNumber ?? order.id}.pdf`,
      autoAttachPdf: true,
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
          <button className="btn-secondary" onClick={downloadListPdf} disabled={downloadingList}>
            {downloadingList ? 'Preparing...' : 'Download PDF'}
          </button>
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

      <FilterBar
        fields={[
          { key: 'search', label: 'Search', type: 'search', placeholder: 'Search shop, product, Model No...' },
          { key: 'dateFrom', label: 'Date From', type: 'date' },
          { key: 'dateTo', label: 'Date To', type: 'date' },
          { key: 'shopId', label: 'Shop', type: 'select', options: (shops ?? []).map((s) => ({ value: s.id, label: s.name })) },
          { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
          { key: 'paymentStatus', label: 'Payment Status', type: 'select', options: PAYMENT_STATUS_OPTIONS },
        ]}
        values={values}
        onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
        onApply={applyFilters}
        onReset={resetFilters}
      />

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading && <p className="text-brand-400 text-sm">Loading orders...</p>}
        {!isLoading && data?.length === 0 && <p className="text-brand-400 text-sm">No party orders found</p>}
        {data?.map((order) => (
          <Link key={order.id} href={`/party-orders/${order.id}`} className="card p-5 hover:shadow-md transition-shadow block">
            <div className="flex items-start justify-between gap-2">
              <div className="flex items-start gap-2 min-w-0">
                <OrderThumbnail order={order} />
                <div className="min-w-0">
                  <p className="font-semibold text-brand-900 truncate">{order.shopName}</p>
                  {order.phone && <p className="text-xs text-brand-400">{order.phone}</p>}
                  <p className="text-brand-600 text-xs font-medium mt-0.5">{order.jobNumber ?? '-'}</p>
                </div>
              </div>
              <StatusBadge status={order.deliveryStatus} />
            </div>

            <div className="mt-2 text-sm text-ink">
              {productSummary(order)}
              {order.items.length > 0 && <span className="text-xs text-brand-400"> · {order.items.length} line(s)</span>}
            </div>
            <div className="text-xs mt-0.5">
              {modelNoSummary(order) ? (
                <span className="font-medium text-ink">Model {modelNoSummary(order)}</span>
              ) : (
                <span className="text-brand-400 italic">Model No not updated</span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2 mt-4 text-sm">
              <div>
                <p className="text-brand-400 text-xs">Total</p>
                <p className="font-medium">{formatCurrency(order.totalAmount ?? 0)}</p>
              </div>
              <div>
                <p className="text-brand-400 text-xs">Date</p>
                <p className="font-medium">{formatDate(order.orderDate)}</p>
              </div>
              <div className="col-span-2 pt-2 border-t border-brand-100 flex items-center justify-between">
                <div>
                  <p className="text-brand-400 text-xs">Balance</p>
                  <p className={`font-semibold ${(order.balanceAmount ?? 0) > 0 ? 'text-red-600' : 'text-emerald-600'}`}>
                    {formatCurrency(order.balanceAmount ?? 0)}
                  </p>
                </div>
                <BalanceBadge amount={order.balanceAmount ?? 0} />
              </div>
            </div>

            <div className="flex items-center justify-between mt-3 pt-3 border-t border-brand-100">
              <div className="flex gap-3">
                <button className="text-brand-600 hover:underline text-xs" onClick={(e) => openEdit(e, order)}>
                  Edit
                </button>
                <button
                  className="text-brand-600 hover:underline text-xs"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    downloadOrderPdf(order);
                  }}
                >
                  Download PDF
                </button>
                <button
                  className="text-brand-600 hover:underline text-xs"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    handleSendPdfViaWhatsApp(order);
                  }}
                >
                  Send PDF
                </button>
                <button
                  className="text-brand-600 hover:underline text-xs"
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    shareOrderPdf(order);
                  }}
                >
                  Share PDF
                </button>
                {hasRole('ADMIN') && (
                  <button
                    className="text-red-500 hover:underline text-xs"
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setDeleteTarget(order);
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
              <span onClick={(e) => { e.preventDefault(); e.stopPropagation(); }}>
                <WhatsAppActionButton
                  recipientName={(order.shopName ?? '') || 'Shop'}
                  recipientPhone={order.phone ?? undefined}
                  onClick={() => handleSendWhatsApp(order)}
                  size="sm"
                />
              </span>
            </div>
          </Link>
        ))}
      </div>
      {result && (
        <Pagination page={result.page} totalPages={result.totalPages} total={result.total} limit={result.limit} onPageChange={setPage} />
      )}

      {formOpen && <PartyOrderFormModal editing={editing} onClose={() => setFormOpen(false)} onSaved={() => mutate()} />}

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

      {shopManagerOpen && <ShopManagerModal onClose={() => setShopManagerOpen(false)} onChange={() => mutateShops()} />}

      {showModal && whatsappOptions && (
        <WhatsAppModal
          onClose={closeWhatsApp}
          recipientInfo={{
            name: whatsappOptions.recipientName,
            phone: whatsappOptions.recipientPhone,
          }}
          defaultMessage={whatsappOptions.defaultMessage}
          defaultImageUrl={whatsappOptions.defaultImageUrl}
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

export default function PartyOrdersPage() {
  return (
    <RoleGate minRole="ADMIN">
      <PartyOrdersContent />
    </RoleGate>
  );
}
