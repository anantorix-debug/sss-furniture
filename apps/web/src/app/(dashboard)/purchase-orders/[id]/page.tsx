'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError, getAccessToken } from '@/lib/api';
import { RoleGate } from '@/components/RoleGate';
import { Modal } from '@/components/Modal';
import { Chip, type ChipColor } from '@/components/StatusBadge';
import { FlowStepper, type FlowStep } from '@/components/FlowStepper';
import { StatCard } from '@/components/StatCard';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate } from '@/lib/format';
import { PURCHASE_ORDER_STATUS_LABEL } from '@/types';
import { WhatsAppModal } from '@/components/WhatsAppModal';
import { WhatsAppActionButton } from '@/components/WhatsAppActionButton';
import { useWhatsApp } from '@/hooks/useWhatsApp';
import type { PurchaseOrder, PurchaseOrderStatus } from '@/types';

const STATUS_CHIP: Record<PurchaseOrderStatus, ChipColor> = {
  DRAFT: 'gray',
  PENDING_APPROVAL: 'amber',
  REJECTED: 'red',
  APPROVED: 'blue',
  SENT_TO_SHOP: 'amber',
  RECEIVED: 'green',
  CANCELLED: 'red',
};

const ACTION_ENDPOINT = {
  submit: 'submit',
  approve: 'approve',
  sendToShop: 'send-to-shop',
  receive: 'receive',
  cancel: 'cancel',
} as const;

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

function PurchaseOrderDetailContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasRole } = useAuth();
  const { data: po, isLoading, mutate } = useSWR<PurchaseOrder>(`/purchase-orders/${id}`, fetcher);
  const [notice, setNotice] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [acting, setActing] = useState(false);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState('');
  const {
    canUseWhatsApp,
    showModal,
    whatsappOptions,
    openWhatsApp,
    closeWhatsApp,
  } = useWhatsApp();

  async function runAction(action: keyof typeof ACTION_ENDPOINT) {
    setActing(true);
    setNotice(null);
    try {
      const result = await api.post<PurchaseOrder>(`/purchase-orders/${id}/${ACTION_ENDPOINT[action]}`);
      if (action === 'sendToShop') {
        setNotice(
          result.whatsapp?.sent
            ? `Sent to ${po?.supplier?.name} on WhatsApp.`
            : `Sent to shop, but WhatsApp not delivered (${result.whatsapp?.reason ?? 'unknown reason'}).`,
        );
      }
      mutate();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Action failed');
    } finally {
      setActing(false);
    }
  }

  async function submitReject(e: React.FormEvent) {
    e.preventDefault();
    setActing(true);
    try {
      await api.post(`/purchase-orders/${id}/reject`, { rejectionReason: rejectReason });
      setRejectOpen(false);
      setRejectReason('');
      mutate();
    } finally {
      setActing(false);
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
      a.download = `${po?.poNumber ?? 'purchase-order'}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  function handleSendWhatsApp() {
    if (!po) return;
    openWhatsApp({
      recipientName: (po.supplier?.name ?? '') || 'Supplier',
      recipientPhone: po.supplier?.phone ?? undefined,
      defaultMessage: `Purchase Order ${po.poNumber}
Total: ₹${po.totalValue}
Expected by: ${formatDate(po.expectedDate)}`,
    });
  }

  if (isLoading || !po) return <p className="text-brand-400 text-sm">Loading purchase order...</p>;

  const cancelled = po.status === 'CANCELLED';
  const rejected = po.status === 'REJECTED';
  const pastApproval = po.status === 'APPROVED' || po.status === 'SENT_TO_SHOP' || po.status === 'RECEIVED';
  const pastSendToShop = po.status === 'SENT_TO_SHOP' || po.status === 'RECEIVED';
  const blocked = cancelled || rejected;
  const steps: FlowStep[] = [
    { key: 'raised', label: 'Raised by Admin', sub: po.createdBy?.name, state: 'done' },
    {
      key: 'submitted',
      label: 'Submitted for Approval',
      state: blocked ? 'blocked' : po.status === 'DRAFT' ? 'current' : 'done',
    },
    {
      key: 'approved',
      label: 'Superadmin Approval',
      sub: po.approvedBy?.name ?? (rejected ? 'Rejected' : blocked ? undefined : 'Pending'),
      state: rejected ? 'blocked' : cancelled ? 'blocked' : pastApproval ? 'done' : po.status === 'PENDING_APPROVAL' ? 'current' : 'upcoming',
    },
    {
      key: 'notified',
      label: 'Sent to Shop',
      sub: 'Via WhatsApp',
      state: blocked ? 'blocked' : pastSendToShop ? 'done' : po.status === 'APPROVED' ? 'current' : 'upcoming',
    },
    {
      key: 'received',
      label: 'Received into Stock',
      state: blocked ? 'blocked' : po.status === 'RECEIVED' ? 'done' : pastSendToShop ? 'current' : 'upcoming',
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <button className="text-sm text-brand-500 hover:underline mb-2" onClick={() => router.push('/purchase-orders')}>
          &larr; All purchase orders
        </button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-brand-900">{po.poNumber}</h1>
              <Chip color={STATUS_CHIP[po.status]} label={PURCHASE_ORDER_STATUS_LABEL[po.status]} />
            </div>
            <p className="text-sm text-brand-500 mt-1">
              {po.supplier?.name}
              {po.supplier?.phone && ` · ${po.supplier.phone}`}
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn-secondary" onClick={downloadPdf} disabled={downloading}>
              {downloading ? 'Preparing...' : 'Download PDF'}
            </button>
            {po.supplier?.phone && (
              <WhatsAppActionButton
                recipientName={po.supplier?.name || 'Supplier'}
                recipientPhone={po.supplier?.phone}
                onClick={handleSendWhatsApp}
                size="md"
              />
            )}
          </div>
        </div>
      </div>

      {notice && <p className="text-sm text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">{notice}</p>}

      <FlowStepper steps={steps} />
      {cancelled && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 -mt-3">This purchase order was cancelled.</p>}
      {rejected && (
        <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2 -mt-3">
          Rejected by {po.approvedBy?.name ?? 'Superadmin'}: {po.rejectionReason}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        {po.status === 'DRAFT' && (
          <button className="btn-secondary" disabled={acting} onClick={() => runAction('submit')}>
            Submit for Approval
          </button>
        )}
        {(po.status === 'DRAFT' || po.status === 'PENDING_APPROVAL') && hasRole('SUPERADMIN') && (
          <>
            <button className="btn-primary" disabled={acting} onClick={() => runAction('approve')}>
              Approve
            </button>
            <button
              className="btn-secondary text-red-600 border-red-200 hover:bg-red-50"
              disabled={acting}
              onClick={() => setRejectOpen(true)}
            >
              Reject
            </button>
          </>
        )}
        {po.status === 'APPROVED' && (
          <button className="btn-primary" disabled={acting} onClick={() => runAction('sendToShop')}>
            Send to Shop
          </button>
        )}
        {po.status === 'SENT_TO_SHOP' && (
          <button className="btn-primary bg-emerald-600 hover:bg-emerald-700" disabled={acting} onClick={() => runAction('receive')}>
            Receive into Stock
          </button>
        )}
        {po.status !== 'RECEIVED' && po.status !== 'CANCELLED' && (
          <button
            className="btn-secondary text-red-600 border-red-200 hover:bg-red-50"
            disabled={acting}
            onClick={() => runAction('cancel')}
          >
            Cancel Order
          </button>
        )}
      </div>

      {rejectOpen && (
        <Modal title={`Reject ${po.poNumber}`} onClose={() => setRejectOpen(false)}>
          <form onSubmit={submitReject} className="space-y-3">
            <div>
              <label className="label">Reason for rejection</label>
              <textarea
                className="input min-h-[90px]"
                required
                minLength={1}
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Explain why this purchase order is being rejected..."
              />
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setRejectOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={acting} className="btn-primary bg-red-600 hover:bg-red-700">
                {acting ? 'Rejecting...' : 'Reject Purchase Order'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Order Date" value={formatDate(po.orderDate)} />
        <StatCard label="Expected Date" value={formatDate(po.expectedDate)} />
        <StatCard label="Total Value" value={formatCurrency(po.totalValue)} />
      </div>

      <div className="card overflow-x-auto">
        <div className="px-5 py-4 border-b border-brand-100">
          <h2 className="font-semibold text-brand-900">Line Items</h2>
        </div>
        <table className="table-shell">
          <thead>
            <tr>
              <th>Material</th>
              <th>Qty</th>
              <th>Unit</th>
              <th>Unit Price</th>
              <th>Line Total</th>
            </tr>
          </thead>
          <tbody>
            {po.items.map((item) => (
              <tr key={item.id}>
                <td className="font-medium">{item.rawMaterial?.name}</td>
                <td>{item.quantity}</td>
                <td>{item.rawMaterial?.unit ?? '-'}</td>
                <td>{formatCurrency(item.unitPrice)}</td>
                <td className="font-medium">{formatCurrency(item.quantity * item.unitPrice)}</td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="text-right font-semibold text-ink">
                Total
              </td>
              <td className="font-semibold text-ink">{formatCurrency(po.totalValue)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      {po.notes && (
        <div className="card p-5">
          <h2 className="font-semibold text-brand-900 mb-2">Notes</h2>
          <p className="text-sm text-brand-600">{po.notes}</p>
        </div>
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

export default function PurchaseOrderDetailPage() {
  return (
    <RoleGate minRole="ADMIN">
      <PurchaseOrderDetailContent />
    </RoleGate>
  );
}
