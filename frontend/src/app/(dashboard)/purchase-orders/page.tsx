'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError, getAccessToken } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { RoleGate } from '@/components/RoleGate';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Chip, type ChipColor } from '@/components/StatusBadge';
import { WhatsAppModal } from '@/components/WhatsAppModal';
import { WhatsAppActionButton } from '@/components/WhatsAppActionButton';
import { ReceivePurchaseOrderModal } from '@/components/ReceivePurchaseOrderModal';
import { useWhatsApp } from '@/hooks/useWhatsApp';
import { formatCurrency, formatDate } from '@/lib/format';
import { PURCHASE_ORDER_STATUS_LABEL } from '@/types';
import type { PurchaseOrder, PurchaseOrderStatus, RawMaterial, SupplierSummary } from '@/types';
import { Pagination, type PaginatedResult } from '@/components/Pagination';
import { FilterBar } from '@/components/FilterBar';
import { PurchasingTabs } from '@/components/PurchasingTabs';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const emptyFilters: Record<string, string> = {};
const STATUS_OPTIONS = Object.entries(PURCHASE_ORDER_STATUS_LABEL).map(([value, label]) => ({ value, label }));

const STATUS_CHIP: Record<PurchaseOrderStatus, ChipColor> = {
  DRAFT: 'gray',
  PENDING_APPROVAL: 'amber',
  REJECTED: 'red',
  APPROVED: 'blue',
  SENT_TO_SHOP: 'amber',
  PARTIALLY_RECEIVED: 'amber',
  RECEIVED: 'green',
  CANCELLED: 'red',
};

interface ItemRow {
  rawMaterialId: string;
  quantity: string;
  unitPrice: string;
  thicknessIn: string;
  widthIn: string;
  lengthIn: string;
  pieces: string;
}

const emptyRow: ItemRow = { rawMaterialId: '', quantity: '', unitPrice: '', thicknessIn: '', widthIn: '', lengthIn: '', pieces: '' };

// D x S x L / 144 per piece, x pieces - client-side preview only (the
// server recomputes and enforces this same formula authoritatively).
function boardFeetPreview(thicknessIn: string, widthIn: string, lengthIn: string, pieces: string) {
  const t = parseFloat(thicknessIn);
  const w = parseFloat(widthIn);
  const l = parseFloat(lengthIn);
  const p = parseFloat(pieces);
  if (!t || !w || !l || !p) return null;
  const perPiece = Math.round(((t * w * l) / 144) * 100) / 100;
  const total = Math.round(perPiece * p * 100) / 100;
  return { perPiece, total };
}

function PurchaseOrdersContent() {
  const { hasRole } = useAuth();
  const searchParams = useSearchParams();
  const [page, setPage] = useState(1);
  const [values, setValues] = useState<Record<string, string>>(emptyFilters);
  const [applied, setApplied] = useState<Record<string, string>>(emptyFilters);
  const [downloading, setDownloading] = useState(false);
  const { data: suppliers } = useSWR<SupplierSummary[]>('/suppliers', fetcher);
  const { data: materials } = useSWR<RawMaterial[]>('/raw-materials', fetcher);
  const queryParams = new URLSearchParams({ ...applied, page: String(page), limit: '20' });
  const { data: result, isLoading, mutate } = useSWR<PaginatedResult<PurchaseOrder>>(`/purchase-orders?${queryParams}`, fetcher);
  const data = result?.data;

  function applyFilters() {
    setApplied(values);
    setPage(1);
  }
  function resetFilters() {
    setValues(emptyFilters);
    setApplied(emptyFilters);
    setPage(1);
  }

  async function downloadPdf() {
    setDownloading(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${API_BASE_URL}/purchase-orders/pdf?${new URLSearchParams(applied)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `purchase-orders-${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloading(false);
    }
  }

  const {
    showModal,
    whatsappOptions,
    openWhatsApp,
    closeWhatsApp,
  } = useWhatsApp();

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<PurchaseOrder | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [orderDate, setOrderDate] = useState(new Date().toISOString().slice(0, 10));
  const [expectedDate, setExpectedDate] = useState('');
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ItemRow[]>([emptyRow]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<PurchaseOrder | null>(null);
  const [receiveTarget, setReceiveTarget] = useState<PurchaseOrder | null>(null);

  const materialOf = (id: string) => materials?.find((m) => m.id === id);
  const materialUnit = (id: string) => materialOf(id)?.unit ?? '';

  // Deep-linked from a raw material's "Record a Purchase" button - opens
  // the New PO form with that material pre-selected on the first line (the
  // supplier is still left for the admin to pick, since a PO always starts
  // with one supplier).
  const materialIdParam = searchParams.get('materialId');
  const [handledMaterialParam, setHandledMaterialParam] = useState(false);
  if (materialIdParam && !handledMaterialParam && materials) {
    setHandledMaterialParam(true);
    setItems([{ ...emptyRow, rawMaterialId: materialIdParam }]);
    setFormOpen(true);
  }

  function addItemRow() {
    setItems((rows) => [...rows, { ...emptyRow }]);
  }
  function removeItemRow(idx: number) {
    setItems((rows) => rows.filter((_, i) => i !== idx));
  }
  function updateItemRow(idx: number, patch: Partial<ItemRow>) {
    setItems((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  function resetForm() {
    setSupplierId('');
    setOrderDate(new Date().toISOString().slice(0, 10));
    setExpectedDate('');
    setNotes('');
    setItems([{ ...emptyRow }]);
    setError(null);
  }

  function openCreate() {
    setEditing(null);
    resetForm();
    setFormOpen(true);
  }

  function openEdit(po: PurchaseOrder) {
    setEditing(po);
    setSupplierId(po.supplierId);
    setOrderDate(po.orderDate.slice(0, 10));
    setExpectedDate(po.expectedDate ? po.expectedDate.slice(0, 10) : '');
    setNotes(po.notes ?? '');
    setItems(
      po.items.map((i) => ({
        rawMaterialId: i.rawMaterialId,
        quantity: String(i.quantity),
        unitPrice: String(i.unitPrice),
        thicknessIn: i.thicknessIn != null ? String(i.thicknessIn) : '',
        widthIn: i.widthIn != null ? String(i.widthIn) : '',
        lengthIn: i.lengthIn != null ? String(i.lengthIn) : '',
        pieces: i.pieces != null ? String(i.pieces) : '',
      })),
    );
    setError(null);
    setFormOpen(true);
  }

  function rowIsBoardFeet(row: ItemRow) {
    return materialOf(row.rawMaterialId)?.measurementKind === 'BOARD_FEET';
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        supplierId,
        orderDate,
        expectedDate: expectedDate || undefined,
        notes: notes || undefined,
        items: items
          .filter((i) => i.rawMaterialId && i.unitPrice && (rowIsBoardFeet(i) ? i.thicknessIn && i.widthIn && i.lengthIn && i.pieces : i.quantity))
          .map((i) => {
            if (rowIsBoardFeet(i)) {
              const bf = boardFeetPreview(i.thicknessIn, i.widthIn, i.lengthIn, i.pieces);
              return {
                rawMaterialId: i.rawMaterialId,
                quantity: bf?.total ?? 0.01, // server recomputes/overrides this for BOARD_FEET lines anyway
                unitPrice: parseFloat(i.unitPrice),
                thicknessIn: parseFloat(i.thicknessIn),
                widthIn: parseFloat(i.widthIn),
                lengthIn: parseFloat(i.lengthIn),
                pieces: parseInt(i.pieces, 10),
              };
            }
            return { rawMaterialId: i.rawMaterialId, quantity: parseFloat(i.quantity), unitPrice: parseFloat(i.unitPrice) };
          }),
      };
      if (editing) {
        await api.patch(`/purchase-orders/${editing.id}`, payload);
      } else {
        await api.post('/purchase-orders', payload);
      }
      setFormOpen(false);
      resetForm();
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save purchase order');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    await api.delete(`/purchase-orders/${deleteTarget.id}`);
    setDeleteTarget(null);
    mutate();
  }

  type ConfirmActionKind = 'submit' | 'approve' | 'sendToShop' | 'cancel';
  const [confirmAction, setConfirmAction] = useState<{ po: PurchaseOrder; action: ConfirmActionKind } | null>(null);
  const [rejectTarget, setRejectTarget] = useState<PurchaseOrder | null>(null);
  const [rejectReason, setRejectReason] = useState('');
  const [rejectSubmitting, setRejectSubmitting] = useState(false);

  const ACTION_ENDPOINT: Record<ConfirmActionKind, string> = {
    submit: 'submit',
    approve: 'approve',
    sendToShop: 'send-to-shop',
    cancel: 'cancel',
  };

  async function runConfirmedAction() {
    if (!confirmAction) return;
    setNotice(null);
    try {
      const endpoint = ACTION_ENDPOINT[confirmAction.action];
      const result = await api.post<PurchaseOrder>(`/purchase-orders/${confirmAction.po.id}/${endpoint}`);
      if (confirmAction.action === 'sendToShop') {
        setNotice(
          result.whatsapp?.sent
            ? `${confirmAction.po.poNumber} sent to shop. WhatsApp sent to ${confirmAction.po.supplier?.name}.`
            : `${confirmAction.po.poNumber} sent to shop. WhatsApp not sent (${result.whatsapp?.reason ?? 'no phone on file for supplier'}).`,
        );
      }
    } finally {
      setConfirmAction(null);
      mutate();
    }
  }

  async function handleReject(e: React.FormEvent) {
    e.preventDefault();
    if (!rejectTarget) return;
    setRejectSubmitting(true);
    try {
      await api.post(`/purchase-orders/${rejectTarget.id}/reject`, { rejectionReason: rejectReason });
      setRejectTarget(null);
      setRejectReason('');
      mutate();
    } finally {
      setRejectSubmitting(false);
    }
  }

  const lineTotal = (row: ItemRow) => {
    const price = parseFloat(row.unitPrice) || 0;
    if (rowIsBoardFeet(row)) {
      const bf = boardFeetPreview(row.thicknessIn, row.widthIn, row.lengthIn, row.pieces);
      return (bf?.total ?? 0) * price;
    }
    return (parseFloat(row.quantity) || 0) * price;
  };
  const formTotal = items.reduce((s, r) => s + lineTotal(r), 0);

  function handleSendWhatsApp(po: PurchaseOrder) {
    openWhatsApp({
      recipientName: (po.supplier?.name ?? '') || 'Supplier',
      recipientPhone: po.supplier?.phone ?? undefined,
      defaultMessage: `Purchase Order ${po.poNumber}\nTotal: ₹${po.totalValue}\nExpected by: ${po.expectedDate ? formatDate(po.expectedDate) : 'TBD'}`,
    });
  }

  return (
    <div className="space-y-6">
      <PurchasingTabs active="purchase-orders" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">Purchase Orders</h1>
          <p className="text-sm text-brand-500 mt-1">
            Admin raises a PO and submits it, Superadmin approves or rejects it, Admin sends the approved PO to the supplier on WhatsApp, then receives it into stock.
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={downloadPdf} disabled={downloading}>
            {downloading ? 'Preparing...' : 'Download PDF'}
          </button>
          <button className="btn-primary" onClick={openCreate}>
            + New Purchase Order
          </button>
        </div>
      </div>

      <FilterBar
        fields={[
          { key: 'search', label: 'Search', type: 'search', placeholder: 'Search PO number / supplier...' },
          { key: 'supplierId', label: 'Supplier', type: 'select', options: (suppliers ?? []).map((s) => ({ value: s.id, label: s.name })) },
          { key: 'status', label: 'Status', type: 'select', options: STATUS_OPTIONS },
        ]}
        values={values}
        onChange={(key, value) => setValues((v) => ({ ...v, [key]: value }))}
        onApply={applyFilters}
        onReset={resetFilters}
      />

      {notice && <p className="text-sm text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">{notice}</p>}

      <div className="card overflow-x-auto">
        <table className="table-shell">
          <thead>
            <tr>
              <th>PO Number</th>
              <th>Supplier</th>
              <th>Order Date</th>
              <th>Items</th>
              <th>Total Value</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-brand-400">
                  Loading purchase orders...
                </td>
              </tr>
            )}
            {!isLoading && data?.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-brand-400">
                  No purchase orders yet
                </td>
              </tr>
            )}
            {data?.map((po) => (
              <tr key={po.id}>
                <td className="font-medium">{po.poNumber}</td>
                <td>{po.supplier?.name}</td>
                <td>{formatDate(po.orderDate)}</td>
                <td>{po.items.length}</td>
                <td className="font-medium">{formatCurrency(po.totalValue)}</td>
                <td>
                  <Chip color={STATUS_CHIP[po.status]} label={PURCHASE_ORDER_STATUS_LABEL[po.status]} />
                </td>
                <td className="space-x-2 whitespace-nowrap">
                  <Link href={`/purchase-orders/${po.id}`} className="btn-secondary h-7 px-3 text-xs inline-flex">
                    View
                  </Link>
                  <WhatsAppActionButton
                    recipientName={(po.supplier?.name ?? '') || 'Supplier'}
                    recipientPhone={po.supplier?.phone ?? undefined}
                    onClick={() => handleSendWhatsApp(po)}
                    size="sm"
                  />
                  {(po.status === 'DRAFT' || po.status === 'REJECTED') && (
                    <>
                      <button className="text-brand-600 hover:underline text-xs" onClick={() => openEdit(po)}>
                        Edit
                      </button>
                      <button className="text-red-600 hover:underline text-xs" onClick={() => setDeleteTarget(po)}>
                        Delete
                      </button>
                    </>
                  )}
                  {po.status === 'DRAFT' && (
                    <button className="btn-secondary h-7 px-3 text-xs" onClick={() => setConfirmAction({ po, action: 'submit' })}>
                      Submit for Approval
                    </button>
                  )}
                  {(po.status === 'DRAFT' || po.status === 'PENDING_APPROVAL') && hasRole('SUPERADMIN') && (
                    <>
                      <button className="btn-primary h-7 px-3 text-xs" onClick={() => setConfirmAction({ po, action: 'approve' })}>
                        Approve
                      </button>
                      <button
                        className="btn-secondary h-7 px-3 text-xs text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => setRejectTarget(po)}
                      >
                        Reject
                      </button>
                    </>
                  )}
                  {po.status === 'APPROVED' && (
                    <button className="btn-primary h-7 px-3 text-xs" onClick={() => setConfirmAction({ po, action: 'sendToShop' })}>
                      Send to Shop
                    </button>
                  )}
                  {(po.status === 'APPROVED' || po.status === 'SENT_TO_SHOP' || po.status === 'PARTIALLY_RECEIVED') && (
                    <button
                      className="btn-primary h-7 px-3 text-xs bg-emerald-600 hover:bg-emerald-700"
                      onClick={() => setReceiveTarget(po)}
                    >
                      Receive
                    </button>
                  )}
                  {po.status !== 'RECEIVED' && po.status !== 'CANCELLED' && (
                    <button
                      className="btn-secondary h-7 px-3 text-xs text-red-600 border-red-200 hover:bg-red-50"
                      onClick={() => setConfirmAction({ po, action: 'cancel' })}
                    >
                      Cancel
                    </button>
                  )}
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
        <Modal title={editing ? `Edit ${editing.poNumber}` : 'New Purchase Order'} onClose={() => setFormOpen(false)} wide>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="label">Supplier</label>
                <select className="input" required value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">Select supplier</option>
                  {suppliers?.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Order Date</label>
                <input type="date" className="input" required value={orderDate} onChange={(e) => setOrderDate(e.target.value)} />
              </div>
              <div>
                <label className="label">Expected Date</label>
                <input type="date" className="input" value={expectedDate} onChange={(e) => setExpectedDate(e.target.value)} />
              </div>
            </div>

            <div>
              <label className="label">Items</label>
              <div className="space-y-2 max-h-[45vh] overflow-y-auto">
                {items.map((row, idx) => {
                  const isBoardFeet = rowIsBoardFeet(row);
                  const bf = isBoardFeet ? boardFeetPreview(row.thicknessIn, row.widthIn, row.lengthIn, row.pieces) : null;
                  return (
                    <div key={idx} className="border border-brand-100 rounded-lg p-3 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-start">
                        <select
                          className="input"
                          required
                          value={row.rawMaterialId}
                          onChange={(e) => updateItemRow(idx, { rawMaterialId: e.target.value, quantity: '', thicknessIn: '', widthIn: '', lengthIn: '', pieces: '' })}
                        >
                          <option value="">Select material</option>
                          {materials?.map((m) => (
                            <option key={m.id} value={m.id}>
                              {m.name} ({m.unit})
                            </option>
                          ))}
                        </select>
                        <button type="button" className="text-red-500 text-xs px-2 py-2" onClick={() => removeItemRow(idx)} disabled={items.length === 1}>
                          Remove
                        </button>
                      </div>

                      {isBoardFeet ? (
                        <>
                          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                            <input type="number" step="0.01" className="input text-sm" placeholder="Thickness (in)" required value={row.thicknessIn} onChange={(e) => updateItemRow(idx, { thicknessIn: e.target.value })} />
                            <input type="number" step="0.01" className="input text-sm" placeholder="Width (in)" required value={row.widthIn} onChange={(e) => updateItemRow(idx, { widthIn: e.target.value })} />
                            <input type="number" step="0.01" className="input text-sm" placeholder="Length (in)" required value={row.lengthIn} onChange={(e) => updateItemRow(idx, { lengthIn: e.target.value })} />
                            <input type="number" min="1" className="input text-sm" placeholder="Pieces" required value={row.pieces} onChange={(e) => updateItemRow(idx, { pieces: e.target.value })} />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <input type="number" step="0.01" className="input text-sm" placeholder="Rate per Board Foot" required value={row.unitPrice} onChange={(e) => updateItemRow(idx, { unitPrice: e.target.value })} />
                            <div className="input text-xs bg-brand-50 text-brand-700 flex flex-col justify-center leading-tight py-1">
                              {bf ? (
                                <>
                                  <span>{bf.perPiece} BF/pc &times; {row.pieces} = <strong>{bf.total} BF</strong></span>
                                  <span className="font-semibold">{formatCurrency(lineTotal(row))}</span>
                                </>
                              ) : (
                                <span className="text-brand-400">Enter dimensions</span>
                              )}
                            </div>
                          </div>
                        </>
                      ) : (
                        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                          <input type="number" step="0.01" className="input text-sm" placeholder="Qty" required value={row.quantity} onChange={(e) => updateItemRow(idx, { quantity: e.target.value })} />
                          <div className="input text-sm flex items-center bg-brand-50 text-ink-muted justify-center">{materialUnit(row.rawMaterialId) || '-'}</div>
                          <input type="number" step="0.01" className="input text-sm" placeholder="Unit Price" required value={row.unitPrice} onChange={(e) => updateItemRow(idx, { unitPrice: e.target.value })} />
                          <div className="input text-sm flex items-center justify-end font-medium text-ink bg-brand-50">{formatCurrency(lineTotal(row))}</div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
              <div className="flex items-center justify-between mt-2">
                <button type="button" className="text-brand-600 text-xs hover:underline" onClick={addItemRow}>
                  + Add Material
                </button>
                <p className="text-sm font-semibold text-brand-900">Total: {formatCurrency(formTotal)}</p>
              </div>
            </div>

            <div>
              <label className="label">Notes</label>
              <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
            </div>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Create Purchase Order'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {confirmAction && (
        <ConfirmDialog
          title={
            {
              submit: 'Submit for Approval',
              approve: 'Approve Purchase Order',
              sendToShop: 'Send to Shop',
              cancel: 'Cancel Purchase Order',
            }[confirmAction.action]
          }
          message={
            confirmAction.action === 'submit'
              ? `Submit ${confirmAction.po.poNumber} for Superadmin approval? You won't be able to edit it while it's pending.`
              : confirmAction.action === 'approve'
                ? `Approve ${confirmAction.po.poNumber}? It can then be sent to ${confirmAction.po.supplier?.name}.`
                : confirmAction.action === 'sendToShop'
                  ? `Send ${confirmAction.po.poNumber} to ${confirmAction.po.supplier?.name}? This notifies them on WhatsApp and lets it be received into stock.`
                  : `Cancel ${confirmAction.po.poNumber}? This cannot be undone.`
          }
          confirmLabel={
            {
              submit: 'Submit',
              approve: 'Approve',
              sendToShop: 'Send to Shop',
              cancel: 'Cancel Order',
            }[confirmAction.action]
          }
          danger={confirmAction.action === 'cancel'}
          onConfirm={runConfirmedAction}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Purchase Order"
          message={`Delete draft ${deleteTarget.poNumber}? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {rejectTarget && (
        <Modal title={`Reject ${rejectTarget.poNumber}`} onClose={() => setRejectTarget(null)}>
          <form onSubmit={handleReject} className="space-y-3">
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
              <button type="button" className="btn-secondary" onClick={() => setRejectTarget(null)}>
                Cancel
              </button>
              <button type="submit" disabled={rejectSubmitting} className="btn-primary bg-red-600 hover:bg-red-700">
                {rejectSubmitting ? 'Rejecting...' : 'Reject Purchase Order'}
              </button>
            </div>
          </form>
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
          onSuccess={() => mutate()}
        />
      )}

      {receiveTarget && (
        <ReceivePurchaseOrderModal
          po={receiveTarget}
          onClose={() => setReceiveTarget(null)}
          onReceived={() => {
            setReceiveTarget(null);
            mutate();
          }}
        />
      )}
    </div>
  );
}

export default function PurchaseOrdersPage() {
  return (
    <RoleGate minRole="ADMIN">
      <PurchaseOrdersContent />
    </RoleGate>
  );
}
