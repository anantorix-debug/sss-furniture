'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError, getAccessToken } from '@/lib/api';
import { RoleGate } from '@/components/RoleGate';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Chip, type ChipColor } from '@/components/StatusBadge';
import { WhatsAppModal } from '@/components/WhatsAppModal';
import { WhatsAppActionButton } from '@/components/WhatsAppActionButton';
import { useWhatsApp } from '@/hooks/useWhatsApp';
import { formatCurrency, formatDate } from '@/lib/format';
import { PURCHASE_STATUS_LABEL } from '@/types';
import type { Purchase, PurchaseStatus, RawMaterial, SupplierSummary } from '@/types';
import { Pagination, type PaginatedResult } from '@/components/Pagination';
import { FilterBar } from '@/components/FilterBar';
import { PurchasingTabs } from '@/components/PurchasingTabs';
import { boardFeetPreview } from '@/lib/boardFeet';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
const emptyFilters: Record<string, string> = {};
const STATUS_OPTIONS = Object.entries(PURCHASE_STATUS_LABEL).map(([value, label]) => ({ value, label }));

const STATUS_CHIP: Record<PurchaseStatus, ChipColor> = {
  RECORDED: 'green',
  CANCELLED: 'red',
};

interface ItemRow {
  rawMaterialId: string;
  quantity: string;
  unitPrice: string;
  thicknessIn: string;
  widthIn: string;
  lengthFt: string;
  pieces: string;
}

const emptyRow: ItemRow = { rawMaterialId: '', quantity: '', unitPrice: '', thicknessIn: '', widthIn: '', lengthFt: '', pieces: '' };


// Shows material + quantity, not just a count, so the list is useful at a
// glance - matching the same "name +N more" pattern already used by Party
// Orders' list for its own multi-line summary.
function itemsSummary(purchase: Purchase): string {
  if (purchase.items.length === 0) return '-';
  const first = purchase.items[0];
  const pieces = first.pieces != null ? `, ${first.pieces} pcs` : '';
  const firstText = `${first.rawMaterial?.name ?? 'Material'} (${first.quantity} ${first.rawMaterial?.unit ?? ''}${pieces})`;
  return purchase.items.length === 1 ? firstText : `${firstText} +${purchase.items.length - 1} more`;
}

function PurchaseOrdersContent() {
  const searchParams = useSearchParams();
  const [page, setPage] = useState(1);
  const [values, setValues] = useState<Record<string, string>>(emptyFilters);
  const [applied, setApplied] = useState<Record<string, string>>(emptyFilters);
  const [downloading, setDownloading] = useState(false);
  const { data: suppliers } = useSWR<SupplierSummary[]>('/suppliers', fetcher);
  const { data: materials } = useSWR<RawMaterial[]>('/raw-materials', fetcher);
  const queryParams = new URLSearchParams({ ...applied, page: String(page), limit: '20' });
  const { data: result, isLoading, mutate } = useSWR<PaginatedResult<Purchase>>(`/purchase-orders?${queryParams}`, fetcher);
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
      a.download = `purchases-${new Date().toISOString().slice(0, 10)}.pdf`;
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
  const [editing, setEditing] = useState<Purchase | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [purchaseDate, setPurchaseDate] = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState('');
  const [items, setItems] = useState<ItemRow[]>([emptyRow]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<Purchase | null>(null);
  const [cancelling, setCancelling] = useState(false);

  const materialOf = (id: string) => materials?.find((m) => m.id === id);
  const materialUnit = (id: string) => materialOf(id)?.unit ?? '';

  // Deep-linked from a raw material's "Record a Purchase" button - opens
  // the New Purchase form with that material pre-selected on the first
  // line (the supplier is still left for the admin to pick).
  const materialIdParam = searchParams.get('materialId');
  const [handledMaterialParam, setHandledMaterialParam] = useState(false);
  if (materialIdParam && !handledMaterialParam && materials) {
    setHandledMaterialParam(true);
    setItems([{ ...emptyRow, rawMaterialId: materialIdParam }]);
    setFormOpen(true);
  }

  // Deep-linked from the purchase detail page's "Edit" button - opens the
  // edit form for that one purchase, same shape as the materialId deep-link
  // above, so the edit form only needs to exist in one place.
  const editIdParam = searchParams.get('edit');
  const { data: editTarget } = useSWR<Purchase>(editIdParam ? `/purchase-orders/${editIdParam}` : null, fetcher);
  const [handledEditParam, setHandledEditParam] = useState(false);
  if (editIdParam && !handledEditParam && editTarget) {
    setHandledEditParam(true);
    openEdit(editTarget);
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
    setPurchaseDate(new Date().toISOString().slice(0, 10));
    setNotes('');
    setItems([{ ...emptyRow }]);
    setError(null);
  }

  function openCreate() {
    setEditing(null);
    resetForm();
    setFormOpen(true);
  }

  function openEdit(purchase: Purchase) {
    setEditing(purchase);
    setSupplierId(purchase.supplierId);
    setPurchaseDate(purchase.purchaseDate.slice(0, 10));
    setNotes(purchase.notes ?? '');
    setItems(
      purchase.items.map((i) => {
        // Stored unitPrice is per Board Foot (see handleSubmit); the form
        // shows/collects a per-CFT rate, so convert back for editing (1 CFT
        // = 12 BF) - otherwise a reopened purchase would show 1/12th of the
        // rate the user actually typed in.
        const isBoardFeet = materialOf(i.rawMaterialId)?.measurementKind === 'BOARD_FEET';
        return {
          rawMaterialId: i.rawMaterialId,
          quantity: String(i.quantity),
          unitPrice: String(isBoardFeet ? Number(i.unitPrice) * 12 : i.unitPrice),
          thicknessIn: i.thicknessIn != null ? String(i.thicknessIn) : '',
          widthIn: i.widthIn != null ? String(i.widthIn) : '',
          lengthFt: i.lengthFt != null ? String(i.lengthFt) : '',
          pieces: i.pieces != null ? String(i.pieces) : '',
        };
      }),
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
        purchaseDate,
        notes: notes || undefined,
        items: items
          .filter((i) => i.rawMaterialId && i.unitPrice && (rowIsBoardFeet(i) ? i.thicknessIn && i.widthIn && i.lengthFt && i.pieces : i.quantity))
          .map((i) => {
            if (rowIsBoardFeet(i)) {
              const bf = boardFeetPreview(i.thicknessIn, i.widthIn, i.lengthFt, i.pieces);
              // The entered Rate is per CFT, but quantity/unitPrice are
              // stored and totalled in Board Feet everywhere else in the
              // system (stock, movement cost, etc.) - convert the CFT rate
              // to its per-Board-Foot equivalent (1 CFT = 12 BF) so
              // quantity(BF) x unitPrice reproduces the same CFT x Rate
              // total the user sees above, without touching every other
              // BF-based cost calculation in the app.
              return {
                rawMaterialId: i.rawMaterialId,
                quantity: bf?.total ?? 0.01, // server recomputes/overrides this for BOARD_FEET lines anyway
                unitPrice: (parseFloat(i.unitPrice) || 0) / 12,
                thicknessIn: parseFloat(i.thicknessIn),
                widthIn: parseFloat(i.widthIn),
                lengthFt: parseFloat(i.lengthFt),
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
      setError(err instanceof ApiError ? err.message : 'Failed to save purchase');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleCancel() {
    if (!cancelTarget) return;
    setCancelling(true);
    try {
      await api.post(`/purchase-orders/${cancelTarget.id}/cancel`);
      setCancelTarget(null);
      mutate();
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Failed to cancel purchase');
      setCancelTarget(null);
    } finally {
      setCancelling(false);
    }
  }

  const lineTotal = (row: ItemRow) => {
    const price = parseFloat(row.unitPrice) || 0;
    if (rowIsBoardFeet(row)) {
      // Timber is priced per CFT (cubic feet) by the supplier, not per Board
      // Foot - the entered Rate is a CFT rate. Board Feet stays the stock
      // unit (quantity), it's just not what the price is quoted against.
      const bf = boardFeetPreview(row.thicknessIn, row.widthIn, row.lengthFt, row.pieces);
      return (bf?.totalCft ?? 0) * price;
    }
    return (parseFloat(row.quantity) || 0) * price;
  };
  const formTotal = items.reduce((s, r) => s + lineTotal(r), 0);

  function handleSendWhatsApp(purchase: Purchase) {
    openWhatsApp({
      recipientName: (purchase.supplier?.name ?? '') || 'Supplier',
      recipientPhone: purchase.supplier?.phone ?? undefined,
      defaultMessage: `Purchase ${purchase.purchaseNumber}\nTotal: ₹${purchase.totalValue}`,
    });
  }

  return (
    <div className="space-y-6">
      <PurchasingTabs active="purchase-orders" />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">Purchase Orders</h1>
          <p className="text-sm text-brand-500 mt-1">Recording a purchase immediately updates material stock and the supplier&apos;s balance payable.</p>
        </div>
        <div className="flex gap-2">
          <button className="btn-secondary" onClick={downloadPdf} disabled={downloading}>
            {downloading ? 'Preparing...' : 'Download PDF'}
          </button>
          <button className="btn-primary" onClick={openCreate}>
            + New Purchase
          </button>
        </div>
      </div>

      <FilterBar
        fields={[
          { key: 'search', label: 'Search', type: 'search', placeholder: 'Search purchase no. / supplier...' },
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
              <th>Purchase No</th>
              <th>Date</th>
              <th>Supplier</th>
              <th>Items</th>
              <th>Total</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-brand-400">
                  Loading purchases...
                </td>
              </tr>
            )}
            {!isLoading && data?.length === 0 && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-brand-400">
                  No purchases yet
                </td>
              </tr>
            )}
            {data?.map((purchase) => (
              <tr key={purchase.id}>
                <td className="font-medium">{purchase.purchaseNumber}</td>
                <td>{formatDate(purchase.purchaseDate)}</td>
                <td>{purchase.supplier?.name}</td>
                <td>{itemsSummary(purchase)}</td>
                <td className="font-medium">{formatCurrency(purchase.totalValue)}</td>
                <td>
                  <Chip color={STATUS_CHIP[purchase.status]} label={PURCHASE_STATUS_LABEL[purchase.status]} />
                </td>
                <td className="space-x-2 whitespace-nowrap">
                  <Link href={`/purchase-orders/${purchase.id}`} className="btn-secondary h-7 px-3 text-xs inline-flex">
                    View
                  </Link>
                  <WhatsAppActionButton
                    recipientName={(purchase.supplier?.name ?? '') || 'Supplier'}
                    recipientPhone={purchase.supplier?.phone ?? undefined}
                    onClick={() => handleSendWhatsApp(purchase)}
                    size="sm"
                  />
                  {purchase.status === 'RECORDED' && (
                    <>
                      <button className="text-brand-600 hover:underline text-xs" onClick={() => openEdit(purchase)}>
                        Edit
                      </button>
                      <button
                        className="text-red-600 hover:underline text-xs"
                        onClick={() => setCancelTarget(purchase)}
                      >
                        Cancel
                      </button>
                    </>
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
        <Modal title={editing ? `Edit ${editing.purchaseNumber}` : 'New Purchase'} onClose={() => setFormOpen(false)} wide>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
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
                <label className="label">Purchase Date</label>
                <input type="date" className="input" required value={purchaseDate} onChange={(e) => setPurchaseDate(e.target.value)} />
              </div>
            </div>

            <div>
              <label className="label">Items</label>
              <div className="space-y-2 max-h-[45vh] overflow-y-auto">
                {items.map((row, idx) => {
                  const isBoardFeet = rowIsBoardFeet(row);
                  const bf = isBoardFeet ? boardFeetPreview(row.thicknessIn, row.widthIn, row.lengthFt, row.pieces) : null;
                  return (
                    <div key={idx} className="border border-brand-100 rounded-lg p-3 space-y-2">
                      <div className="grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-start">
                        <select
                          className="input"
                          required
                          value={row.rawMaterialId}
                          onChange={(e) => updateItemRow(idx, { rawMaterialId: e.target.value, quantity: '', thicknessIn: '', widthIn: '', lengthFt: '', pieces: '' })}
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
                            <input type="number" step="0.01" className="input text-sm" placeholder="Length (ft)" required value={row.lengthFt} onChange={(e) => updateItemRow(idx, { lengthFt: e.target.value })} />
                            <input type="number" min="1" className="input text-sm" placeholder="Pieces" required value={row.pieces} onChange={(e) => updateItemRow(idx, { pieces: e.target.value })} />
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            <input type="number" step="0.01" className="input text-sm" placeholder="Rate per CFT" required value={row.unitPrice} onChange={(e) => updateItemRow(idx, { unitPrice: e.target.value })} />
                            <div className="input text-xs bg-brand-50 text-brand-700 flex flex-col justify-center leading-tight py-1">
                              {bf ? (
                                <>
                                  <span>{bf.perPiece} BF/pc &times; {row.pieces} = <strong>{bf.total} BF</strong> ({bf.totalCft} CFT)</span>
                                  <span className="font-semibold">{formatCurrency(lineTotal(row))} ({bf.totalCft} CFT &times; Rate)</span>
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
                          <input type="number" step="0.01" className="input text-sm" placeholder="Purchase Rate" required value={row.unitPrice} onChange={(e) => updateItemRow(idx, { unitPrice: e.target.value })} />
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
                {submitting ? 'Saving...' : 'Save Purchase'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {cancelTarget && (
        <ConfirmDialog
          title="Cancel Purchase"
          message={`Cancel ${cancelTarget.purchaseNumber}? This reverses its stock and supplier balance impact. This cannot be undone.`}
          confirmLabel={cancelling ? 'Cancelling...' : 'Cancel Purchase'}
          danger
          onConfirm={handleCancel}
          onCancel={() => setCancelTarget(null)}
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

export default function PurchaseOrdersPage() {
  return (
    <RoleGate minRole="ADMIN">
      <PurchaseOrdersContent />
    </RoleGate>
  );
}
