'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError, getAccessToken } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate } from '@/lib/format';
import { StatCard } from '@/components/StatCard';
import { ViewField } from '@/components/ViewField';
import { Chip, StatusBadge, type ChipColor } from '@/components/StatusBadge';
import { PaymentsPanel } from '@/components/PaymentsPanel';
import { PartyOrderFormModal } from '@/components/PartyOrderFormModal';
import { AssignEmployeeModal } from '@/components/AssignEmployeeModal';
import { AssignProductionModal, type AssignProductionPayload } from '@/components/AssignProductionModal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RoleGate } from '@/components/RoleGate';
import { WhatsAppModal } from '@/components/WhatsAppModal';
import { WhatsAppActionButton } from '@/components/WhatsAppActionButton';
import { useWhatsApp } from '@/hooks/useWhatsApp';
import { sharePdf } from '@/lib/sharePdf';
import type { PartyOrder, PartyOrderItem, CarpenterWorkItem } from '@/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

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
          {w.stage === 'POLISH' && (
            <span className={w.color ? 'text-brand-600' : 'text-red-500 italic'}>{w.color ? `Colour: ${w.color}` : 'Colour not set'}</span>
          )}
          <Chip color={LINE_STATUS_CHIP[w.status] ?? 'gray'} label={w.status.replace('_', ' ')} />
        </div>
      ))}
    </div>
  );
}

function PartyOrderDetailContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasRole } = useAuth();
  const { data: order, isLoading, mutate } = useSWR<PartyOrder>(`/party-orders/${id}`, fetcher);
  const { showModal, whatsappOptions, openWhatsApp, closeWhatsApp } = useWhatsApp();

  const [editOpen, setEditOpen] = useState(false);
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [assignEmployeeOpen, setAssignEmployeeOpen] = useState(false);
  const [assignProductionItem, setAssignProductionItem] = useState<PartyOrderItem | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [sendingPdf, setSendingPdf] = useState(false);

  async function downloadOrderPdf() {
    if (!order) return;
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

  // Standalone quick-send, separate from the picker-based flow above - goes
  // straight to the shop's own phone number on file, no chat selection needed.
  async function sendOrderPdfViaWhatsApp() {
    if (!order || sendingPdf) return;
    setSendingPdf(true);
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
      setSendingPdf(false);
    }
  }

  // Separate from both the standalone send above and the in-popup attach -
  // hands the PDF to the device's native share sheet, which doesn't depend
  // on the backend's own WhatsApp connection being up.
  async function shareOrderPdf() {
    if (!order) return;
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

  async function handleDelete() {
    if (!order) return;
    try {
      await api.delete(`/party-orders/${order.id}`);
      router.push('/party-orders');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete order');
      setDeleteConfirmOpen(false);
    }
  }

  if (isLoading || !order) return <p className="text-brand-400 text-sm">Loading order...</p>;

  return (
    <div className="space-y-6">
      <div>
        <button className="text-sm text-brand-500 hover:underline mb-2" onClick={() => router.push('/party-orders')}>
          &larr; All party orders
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-brand-900">{order.shopName}</h1>
            <div className="flex items-center gap-2 mt-1">
              {order.phone && <p className="text-sm text-brand-500">{order.phone}</p>}
              <StatusBadge status={order.deliveryStatus} />
            </div>
          </div>
          <div className="flex gap-2 items-center">
            <WhatsAppActionButton
              recipientName={order.shopName || 'Shop'}
              recipientPhone={order.phone ?? undefined}
              onClick={() =>
                openWhatsApp({
                  recipientName: order.shopName || 'Shop',
                  recipientPhone: order.phone ?? undefined,
                  defaultMessage: `Order ${order.jobNumber ?? ''} for ${order.shopName} - Total ₹${order.totalAmount ?? 0}, Balance ₹${order.balanceAmount ?? 0}.`,
                  defaultImageUrl: '/wa-template.jpeg',
                  pdfUrl: `/party-orders/${order.id}/pdf`,
                  pdfFilename: `Order Confirmation - ${order.jobNumber ?? order.id}.pdf`,
                })
              }
              size="md"
            />
            <button className="btn-secondary" onClick={downloadOrderPdf}>
              Download PDF
            </button>
            <button className="btn-secondary" disabled={sendingPdf} onClick={sendOrderPdfViaWhatsApp}>
              {sendingPdf ? 'Sending...' : 'Send PDF via WhatsApp'}
            </button>
            <button className="btn-secondary" onClick={shareOrderPdf}>
              Share PDF
            </button>
            <button className="btn-secondary" onClick={() => setEditOpen(true)}>
              Edit
            </button>
            {hasRole('ADMIN') && (
              <button className="text-red-500 hover:underline text-sm px-2" onClick={() => setDeleteConfirmOpen(true)}>
                Delete
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total Order Value" value={formatCurrency(order.totalAmount ?? 0)} />
        <StatCard label="Received" value={formatCurrency(order.receivedAmount ?? 0)} accent="success" />
        <StatCard label="Balance" value={formatCurrency(order.balanceAmount ?? 0)} accent="warning" />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{notice}</p>}

      <div className="card p-5">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-sm">
          <ViewField label="Job No" value={order.jobNumber ?? '-'} />
          <ViewField label="Order Date" value={formatDate(order.orderDate)} />
          <ViewField label="Vehicle Number" value={order.courierTrack ?? '-'} />
          <ViewField label="Actual Delivery Date" value={order.actualDeliveryDate ? formatDate(order.actualDeliveryDate) : '-'} />
          <ViewField label="Created By" value={order.createdBy?.name ?? '-'} />
          {order.items.length === 0 && (
            <ViewField label="Model No By" value={order.assignedEmployee?.name ?? 'Not set'} />
          )}
        </div>
        {hasRole('SUPERADMIN') && order.items.length === 0 && (
          <div className="pt-3 mt-3 border-t border-brand-100">
            <button className="btn-secondary text-xs" onClick={() => setAssignEmployeeOpen(true)}>
              {order.assignedEmployee ? 'Reassign Employee' : 'Assign Employee'}
            </button>
          </div>
        )}
      </div>

      <div className="card p-5">
        <h2 className="font-semibold text-brand-900 mb-3">Products ({order.items.length})</h2>
        <div className="space-y-3">
          {order.items.length === 0 && <p className="text-sm text-brand-400">{order.model ?? 'No line items'}</p>}
          {order.items.map((item) => (
            <div key={item.id} className="border border-brand-100 rounded-lg p-3">
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
                <ViewField label="Model No" value={item.modelNo ?? 'Not Updated'} />
                <ViewField label="Product" value={item.productName} />
                <ViewField label="Finish" value={item.finish ?? '-'} />
                <ViewField label="Size" value={[item.size, item.sizeUnit].filter(Boolean).join(' ') || '-'} />
                {item.color && <ViewField label="Polish Colour" value={item.color} />}
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
                  {hasRole('ADMIN') && order.deliveryStatus !== 'DELIVERED' && (
                    <button className="btn-secondary text-xs mt-2" onClick={() => setAssignProductionItem(item)}>
                      Assign to Production
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="card p-5">
        <h2 className="font-semibold text-brand-900 mb-3">Payments</h2>
        <PaymentsPanel
          totalAmount={order.totalAmount ?? 0}
          totalReceived={order.receivedAmount ?? 0}
          balanceAmount={order.balanceAmount ?? 0}
          payments={order.payments ?? []}
          canDelete={hasRole('ADMIN')}
          canAdd={hasRole('ADMIN')}
          onSendWhatsApp={(message) =>
            openWhatsApp({
              recipientName: order.shopName || 'Shop',
              recipientPhone: order.phone ?? undefined,
              defaultMessage: message,
              defaultImageUrl: '/wa-template.jpeg',
            })
          }
          onAddPayment={async (payload) => {
            await api.post(`/party-orders/${order.id}/payments`, payload);
            mutate();
          }}
          onDeletePayment={async (paymentId) => {
            await api.delete(`/party-orders/${order.id}/payments/${paymentId}`);
            mutate();
          }}
        />
      </div>

      {editOpen && <PartyOrderFormModal editing={order} onClose={() => setEditOpen(false)} onSaved={() => mutate()} />}

      {deleteConfirmOpen && (
        <ConfirmDialog
          title="Delete Party Order"
          message={`Delete this order for ${order.shopName}? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteConfirmOpen(false)}
        />
      )}

      {assignEmployeeOpen && (
        <AssignEmployeeModal
          title={`Assign Production Employee - ${order.shopName}`}
          onClose={() => setAssignEmployeeOpen(false)}
          onSubmit={async (employeeId) => {
            await api.post(`/party-orders/${order.id}/assign-employee`, { employeeId });
            setNotice('Order assigned. The employee will enter the Model No.');
            setAssignEmployeeOpen(false);
            mutate();
          }}
        />
      )}

      {assignProductionItem && (
        <AssignProductionModal
          productName={assignProductionItem.productName}
          initialColor={assignProductionItem.color ?? undefined}
          initialQuantity={assignProductionItem.productionQty}
          onOpenWhatsAppPicker={
            hasRole('SUPERADMIN')
              ? () =>
                  openWhatsApp({
                    recipientName: assignProductionItem.productName,
                    defaultMessage: `New work assigned - ${assignProductionItem.productName} for order ${order.jobNumber ?? ''} (${order.shopName}).`,
                  })
              : undefined
          }
          onClose={() => setAssignProductionItem(null)}
          onSubmit={async (payload: AssignProductionPayload) => {
            await api.post(`/party-orders/${order.id}/items/${assignProductionItem.id}/assign-production`, payload);
            setNotice(`Work assigned for ${assignProductionItem.productName}.`);
            setAssignProductionItem(null);
            mutate();
          }}
        />
      )}

      {showModal && whatsappOptions && (
        <WhatsAppModal
          onClose={closeWhatsApp}
          recipientInfo={{ name: whatsappOptions.recipientName, phone: whatsappOptions.recipientPhone }}
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

export default function PartyOrderDetailPage() {
  return (
    <RoleGate minRole="ADMIN">
      <PartyOrderDetailContent />
    </RoleGate>
  );
}
