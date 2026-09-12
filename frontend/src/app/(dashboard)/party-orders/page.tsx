'use client';

import { useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError, getAccessToken } from '@/lib/api';
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
import type { PartyOrder } from '@/types';
import { Pagination, type PaginatedResult } from '@/components/Pagination';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

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
      (i) => `${i.productName}${i.finish ? ` (${i.finish})` : ''} - Qty ${i.qty}${i.size ? `, ${i.size}${i.sizeUnit ? ` ${i.sizeUnit}` : ''}` : ''}`,
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
  const { mutate: mutateShops } = useSWR<unknown>('/shops', fetcher);
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
  const [deleteTarget, setDeleteTarget] = useState<PartyOrder | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [sendingPdfId, setSendingPdfId] = useState<string | null>(null);

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
    try {
      await api.delete(`/party-orders/${deleteTarget.id}`);
      setDeleteTarget(null);
      mutate();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Failed to delete order');
      setDeleteTarget(null);
    }
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

  // Standalone quick-send, separate from the picker-based flow in
  // handleSendWhatsApp below - goes straight to the shop's own phone
  // number on file, no chat selection needed.
  async function sendOrderPdfViaWhatsApp(order: PartyOrder) {
    if (sendingPdfId) return;
    setSendingPdfId(order.id);
    setNotice(null);
    try {
      const result = await api.post<{ sent: boolean; reason?: string }>(`/party-orders/${order.id}/send-whatsapp`);
      setNotice(
        result.sent
          ? `PDF sent to ${order.shopName} via WhatsApp.`
          : `Could not send PDF: ${result.reason === 'no_shop_phone' ? 'no phone number on file for this shop.' : (result.reason ?? 'unknown error')}`,
      );
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Failed to send PDF via WhatsApp');
    } finally {
      setSendingPdfId(null);
    }
  }

  function handleSendWhatsApp(order: PartyOrder) {
    openWhatsApp({
      recipientName: (order.shopName ?? '') || 'Shop',
      recipientPhone: order.phone ?? undefined,
      defaultMessage: buildOrderConfirmationMessage(order),
      defaultImageUrl: '/wa-template.jpeg',
      // Lets the sender attach the branded PDF instead, from inside the
      // same chat-picker popup.
      pdfUrl: `/party-orders/${order.id}/pdf`,
      pdfFilename: `Order Confirmation - ${order.jobNumber ?? order.id}.pdf`,
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

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {isLoading && <p className="text-brand-400 text-sm">Loading orders...</p>}
        {!isLoading && data?.length === 0 && <p className="text-brand-400 text-sm">No party orders found</p>}
        {data?.map((order) => (
          <Link key={order.id} href={`/party-orders/${order.id}`} className="card p-5 hover:shadow-md transition-shadow block">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-semibold text-brand-900 truncate">{order.shopName}</p>
                {order.phone && <p className="text-xs text-brand-400">{order.phone}</p>}
                <p className="text-brand-600 text-xs font-medium mt-0.5">{order.jobNumber ?? '-'}</p>
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
                  disabled={sendingPdfId === order.id}
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    sendOrderPdfViaWhatsApp(order);
                  }}
                >
                  {sendingPdfId === order.id ? 'Sending...' : 'Send PDF'}
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
