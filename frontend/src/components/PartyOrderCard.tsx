'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { api, ApiError, getAccessToken, assetUrl } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate } from '@/lib/format';
import { StatusBadge, BalanceBadge } from '@/components/StatusBadge';
import { WhatsAppActionButton } from '@/components/WhatsAppActionButton';
import { sharePdf } from '@/lib/sharePdf';
import { buildPartyOrderMessage } from '@/lib/orderMessages';
import { TruckIcon } from '@/components/TruckIcon';
import type { PartyOrder, GalleryImage, DeliveryStatus } from '@/types';
import type { UseWhatsAppOptions } from '@/hooks/useWhatsApp';

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

const STATUS_OPTIONS: { value: DeliveryStatus; label: string }[] = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'OUT_FOR_DELIVERY', label: 'Out for Delivery' },
  { value: 'DELIVERED', label: 'Delivered' },
  { value: 'DELIVERY_FAILED', label: 'Delivery Failed' },
  { value: 'CANCELLED', label: 'Cancelled' },
];

// Inline Delivery Status edit - click the badge to swap it for a select,
// same partial-PATCH (deliveryStatus only) safety as VehicleNumberInline
// below.
function StatusInline({ order, onUpdated }: { order: PartyOrder; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeStatus(next: DeliveryStatus) {
    if (next === order.deliveryStatus) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/party-orders/${order.id}`, { deliveryStatus: next });
      setEditing(false);
      onUpdated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update status');
    } finally {
      setSaving(false);
    }
  }

  if (editing) {
    return (
      <span
        className="relative"
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
        }}
      >
        <select
          autoFocus
          className="input py-0.5 pl-2 pr-6 text-[10px] h-[23px] rounded-full"
          value={order.deliveryStatus}
          disabled={saving}
          onChange={(e) => changeStatus(e.target.value as DeliveryStatus)}
          onBlur={() => setEditing(false)}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        {error && <p className="absolute right-0 top-full mt-1 text-[10px] text-red-600 whitespace-nowrap">{error}</p>}
      </span>
    );
  }

  return (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setEditing(true);
      }}
    >
      <StatusBadge status={order.deliveryStatus} />
    </button>
  );
}

// Inline Vehicle Number edit - only once an order is Delivered, so the
// dispatch detail can be filled in/corrected right from the card without
// opening the full Edit form. Saves via a partial PATCH (courierTrack
// only) - PartyOrdersService.update() only touches items when dto.items is
// present, so this can never trigger the release/reallocate flow.
// Full-screen "just dispatched" celebration - a truck travelling toward a
// shop pin, shown once after saving a Vehicle Number. Auto-dismisses; a
// click anywhere closes it early too, same "backdrop is also a close
// button" convention as the rest of this popup (unlike Modal, which
// deliberately blocks backdrop-click since it may hold in-progress form
// state - this one holds nothing, so it's safe to dismiss either way).
function DispatchCelebration({ vehicleNo, onDone }: { vehicleNo: string; onDone: () => void }) {
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [onDone]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4" onClick={onDone}>
      <div className="card w-full max-w-sm p-8 text-center" onClick={(e) => e.stopPropagation()}>
        <div className="relative h-12 mb-5 overflow-hidden">
          <span className="absolute right-0 top-1/2 -translate-y-1/2 text-4xl">🏬</span>
          {/* Drawn truck icon, cab on the right - faces the direction it
              travels (toward the shop) on every device. */}
          <span className="absolute top-1/2 -translate-y-1/2 animate-dispatch-travel-big"><TruckIcon className="h-10 w-14" /></span>
        </div>
        <p className="text-xl font-bold text-emerald-600">Dispatched!</p>
        {vehicleNo && <p className="text-sm text-brand-500 mt-1">Vehicle No: {vehicleNo}</p>}
      </div>
    </div>
  );
}

function VehicleNumberInline({ order, onUpdated }: { order: PartyOrder; onUpdated: () => void }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState(order.courierTrack ?? '');
  const [saving, setSaving] = useState(false);
  const [celebrating, setCelebrating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (order.deliveryStatus !== 'DELIVERED') return null;

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/party-orders/${order.id}`, { courierTrack: value.trim() || undefined });
      setEditing(false);
      onUpdated();
      setCelebrating(true);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div
      className="mt-2 pt-2 border-t border-brand-100 flex items-center justify-between text-xs gap-2"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
    >
      <span className="text-brand-400 shrink-0">Vehicle No</span>
      {editing ? (
        <span className="flex items-center gap-1">
          <input
            autoFocus
            className="input py-0.5 px-1.5 text-xs w-24"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') setEditing(false);
            }}
          />
          <button type="button" className="text-emerald-600 hover:underline" disabled={saving} onClick={save}>
            {saving ? '...' : 'Save'}
          </button>
          <button type="button" className="text-brand-400 hover:underline" onClick={() => setEditing(false)}>
            Cancel
          </button>
        </span>
      ) : (
        <button type="button" className="text-ink hover:underline font-medium truncate" onClick={() => setEditing(true)}>
          {order.courierTrack || 'Add vehicle no.'}
        </button>
      )}
      {error && <span className="text-red-600">{error}</span>}
      {celebrating && <DispatchCelebration vehicleNo={value.trim()} onDone={() => setCelebrating(false)} />}
    </div>
  );
}

// One order card - extracted from the old order-centric list page so both
// the Shop Dashboard's order list and any future order grid can share the
// exact same rendering/actions without re-typing this ~150-line block.
export function PartyOrderCard({
  order,
  onEdit,
  onDeleteRequest,
  openWhatsApp,
  onUpdated,
}: {
  order: PartyOrder;
  onEdit: (order: PartyOrder) => void;
  onDeleteRequest: (order: PartyOrder) => void;
  openWhatsApp: (options: UseWhatsAppOptions) => void;
  onUpdated?: () => void;
}) {
  const { hasRole } = useAuth();
  const [notice, setNotice] = useState<string | null>(null);

  async function downloadOrderPdf() {
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

  async function shareOrderPdf() {
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

  function handleSendWhatsApp() {
    openWhatsApp({
      recipientName: (order.shopName ?? '') || 'Shop',
      recipientPhone: order.phone ?? undefined,
      defaultMessage: buildPartyOrderMessage(order, 'customer'),
      messageVariants: {
        customer: buildPartyOrderMessage(order, 'customer'),
        employee: buildPartyOrderMessage(order, 'employee'),
      },
      defaultImageUrl: '/wa-template.jpeg',
      pdfUrl: `/party-orders/${order.id}/pdf`,
      pdfFilename: `Order Confirmation - ${order.jobNumber ?? order.id}.pdf`,
    });
  }

  function handleSendPdfViaWhatsApp() {
    openWhatsApp({
      recipientName: (order.shopName ?? '') || 'Shop',
      recipientPhone: order.phone ?? undefined,
      defaultMessage: '',
      pdfUrl: `/party-orders/${order.id}/pdf`,
      pdfFilename: `Order Confirmation - ${order.jobNumber ?? order.id}.pdf`,
      autoAttachPdf: true,
    });
  }

  return (
    <Link href={`/party-orders/${order.id}`} className="card p-5 hover:shadow-md transition-shadow block">
      {notice && <p className="text-xs text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-2 py-1.5 mb-2">{notice}</p>}
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          <OrderThumbnail order={order} />
          <div className="min-w-0">
            <p className="font-semibold text-brand-900 truncate">{order.shopName}</p>
            {order.phone && <p className="text-xs text-brand-400">{order.phone}</p>}
            <p className="text-brand-600 text-xs font-medium mt-0.5">{order.jobNumber ?? '-'}</p>
          </div>
        </div>
        <StatusInline order={order} onUpdated={() => onUpdated?.()} />
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

      <VehicleNumberInline order={order} onUpdated={() => onUpdated?.()} />

      <div className="flex items-center justify-between mt-3 pt-3 border-t border-brand-100">
        <div className="flex gap-3 flex-wrap">
          <button
            className="text-brand-600 hover:underline text-xs"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              onEdit(order);
            }}
          >
            Edit
          </button>
          <button
            className="text-brand-600 hover:underline text-xs"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              downloadOrderPdf();
            }}
          >
            Download PDF
          </button>
          <button
            className="text-brand-600 hover:underline text-xs"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleSendPdfViaWhatsApp();
            }}
          >
            Send PDF
          </button>
          <button
            className="text-brand-600 hover:underline text-xs"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              shareOrderPdf();
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
                onDeleteRequest(order);
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
            onClick={handleSendWhatsApp}
            size="sm"
          />
        </span>
      </div>
    </Link>
  );
}
