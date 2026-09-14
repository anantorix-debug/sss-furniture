'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError, getAccessToken } from '@/lib/api';
import { RoleGate } from '@/components/RoleGate';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Chip, type ChipColor } from '@/components/StatusBadge';
import { StatCard } from '@/components/StatCard';
import { formatCurrency, formatDate } from '@/lib/format';
import { PURCHASE_STATUS_LABEL } from '@/types';
import { WhatsAppModal } from '@/components/WhatsAppModal';
import { WhatsAppActionButton } from '@/components/WhatsAppActionButton';
import { useWhatsApp } from '@/hooks/useWhatsApp';
import type { Purchase, PurchaseStatus } from '@/types';

const STATUS_CHIP: Record<PurchaseStatus, ChipColor> = {
  RECORDED: 'green',
  CANCELLED: 'red',
};

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

function PurchaseDetailContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data: purchase, isLoading, mutate } = useSWR<Purchase>(`/purchase-orders/${id}`, fetcher);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const {
    showModal,
    whatsappOptions,
    openWhatsApp,
    closeWhatsApp,
  } = useWhatsApp();

  async function handleCancel() {
    setCancelling(true);
    setNotice(null);
    try {
      await api.post(`/purchase-orders/${id}/cancel`);
      setCancelOpen(false);
      mutate();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Failed to cancel purchase');
      setCancelOpen(false);
    } finally {
      setCancelling(false);
    }
  }

  async function downloadPdf() {
    setDownloading(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${API_BASE_URL}/purchase-orders/${id}/pdf`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${purchase?.purchaseNumber ?? 'purchase'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  function handleSendWhatsApp() {
    if (!purchase) return;
    openWhatsApp({
      recipientName: (purchase.supplier?.name ?? '') || 'Supplier',
      recipientPhone: purchase.supplier?.phone ?? undefined,
      defaultMessage: `Purchase ${purchase.purchaseNumber}\nTotal: ₹${purchase.totalValue}`,
    });
  }

  if (isLoading || !purchase) return <p className="text-brand-400 text-sm">Loading purchase...</p>;

  const cancelled = purchase.status === 'CANCELLED';

  return (
    <div className="space-y-6">
      <div>
        <button className="text-sm text-brand-500 hover:underline mb-2" onClick={() => router.push('/purchase-orders')}>
          &larr; All purchases
        </button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-brand-900">{purchase.purchaseNumber}</h1>
              <Chip color={STATUS_CHIP[purchase.status]} label={PURCHASE_STATUS_LABEL[purchase.status]} />
            </div>
            <p className="text-sm text-brand-500 mt-1">
              {purchase.supplier?.name}
              {purchase.supplier?.phone && ` · ${purchase.supplier.phone}`}
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={downloadPdf} disabled={downloading}>
              {downloading ? 'Preparing...' : 'Download PDF'}
            </button>
            {purchase.supplier?.phone && (
              <WhatsAppActionButton
                recipientName={purchase.supplier?.name || 'Supplier'}
                recipientPhone={purchase.supplier?.phone}
                onClick={handleSendWhatsApp}
                size="md"
              />
            )}
            {!cancelled && (
              <>
                <button className="btn-secondary" onClick={() => router.push(`/purchase-orders?edit=${purchase.id}`)}>
                  Edit
                </button>
                <button className="btn-secondary text-red-600 border-red-200 hover:bg-red-50" onClick={() => setCancelOpen(true)}>
                  Cancel Purchase
                </button>
              </>
            )}
          </div>
        </div>
      </div>

      {notice && <p className="text-sm text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">{notice}</p>}
      {cancelled && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">This purchase was cancelled - its stock and supplier balance impact has been reversed.</p>}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <StatCard label="Purchase Date" value={formatDate(purchase.purchaseDate)} />
        <StatCard label="Total" value={formatCurrency(purchase.totalValue)} />
      </div>

      <div className="card overflow-x-auto">
        <div className="px-5 py-4 border-b border-brand-100">
          <h2 className="font-semibold text-brand-900">Items</h2>
        </div>
        <table className="table-shell">
          <thead>
            <tr>
              <th>Material</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Rate</th>
              <th>Total</th>
            </tr>
          </thead>
          <tbody>
            {purchase.items.map((item) => (
              <tr key={item.id}>
                <td className="font-medium">
                  {item.rawMaterial?.name}
                  {item.pieces != null && (
                    <span className="block text-[11px] text-brand-400">
                      {item.thicknessIn}&quot; &times; {item.widthIn}&quot; &times; {item.lengthFt}&apos;, {item.pieces} pcs
                    </span>
                  )}
                </td>
                <td>{item.quantity}</td>
                <td className="text-brand-500">{item.rawMaterial?.unit}</td>
                <td>
                  {/* Timber is priced per CFT, not per Board Foot - unitPrice is
                      stored as its per-BF equivalent (see Purchase Orders'
                      handleSubmit), so show it back out as the /CFT rate that
                      was actually agreed with the supplier. */}
                  {item.pieces != null ? `${formatCurrency(item.unitPrice * 12)}/CFT` : formatCurrency(item.unitPrice)}
                </td>
                <td className="font-medium">{formatCurrency(item.quantity * item.unitPrice)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="text-right font-semibold text-ink">
                Total
              </td>
              <td className="font-semibold text-ink">{formatCurrency(purchase.totalValue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {purchase.notes && (
        <div className="card p-5">
          <h2 className="font-semibold text-brand-900 mb-2">Notes</h2>
          <p className="text-sm text-brand-600">{purchase.notes}</p>
        </div>
      )}

      {cancelOpen && (
        <ConfirmDialog
          title="Cancel Purchase"
          message={`Cancel ${purchase.purchaseNumber}? This reverses its stock and supplier balance impact. This cannot be undone.`}
          confirmLabel={cancelling ? 'Cancelling...' : 'Cancel Purchase'}
          danger
          onConfirm={handleCancel}
          onCancel={() => setCancelOpen(false)}
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

export default function PurchaseDetailPage() {
  return (
    <RoleGate minRole="ADMIN">
      <PurchaseDetailContent />
    </RoleGate>
  );
}
