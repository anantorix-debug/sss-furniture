'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { Modal } from './Modal';
import { formatCurrency } from '@/lib/format';
import { boardFeetPreview } from '@/lib/boardFeet';
import type { Purchase, RawMaterial, SupplierSummary } from '@/types';

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

// Create/edit form for a Purchase Order - shared by the list page's "+ New
// Purchase" / "Edit" action and the Supplier detail page's own "+ New
// Purchase" link, so opening it never has to navigate away from wherever
// the admin already is (initialSupplierId pre-selects the supplier when
// launched from that page).
export function PurchaseFormModal({
  editing,
  initialSupplierId,
  initialMaterialId,
  onClose,
  onSaved,
}: {
  editing: Purchase | null;
  initialSupplierId?: string;
  initialMaterialId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: suppliers } = useSWR<SupplierSummary[]>('/suppliers', fetcher);
  const { data: materials } = useSWR<RawMaterial[]>('/raw-materials', fetcher);

  const materialOf = (id: string) => materials?.find((m) => m.id === id);
  const materialUnit = (id: string) => materialOf(id)?.unit ?? '';
  const rowIsBoardFeet = (row: ItemRow) => materialOf(row.rawMaterialId)?.measurementKind === 'BOARD_FEET';

  const [supplierId, setSupplierId] = useState(editing?.supplierId ?? initialSupplierId ?? '');
  const [purchaseDate, setPurchaseDate] = useState(editing ? editing.purchaseDate.slice(0, 10) : new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState(editing?.notes ?? '');
  const [items, setItems] = useState<ItemRow[]>(() => {
    if (editing) {
      return editing.items.map((i) => {
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
      });
    }
    if (initialMaterialId) return [{ ...emptyRow, rawMaterialId: initialMaterialId }];
    return [{ ...emptyRow }];
  });
  const [error, setError] = useState<string | null>(null);
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
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save purchase');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={editing ? `Edit ${editing.purchaseNumber}` : 'New Purchase'} onClose={onClose} wide>
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
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Saving...' : 'Save Purchase'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
