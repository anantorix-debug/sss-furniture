'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { StatCard } from '@/components/StatCard';
import { Chip, type ChipColor } from '@/components/StatusBadge';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { RoleGate } from '@/components/RoleGate';
import { ModelNoPicker } from '@/components/ModelNoPicker';
import { UnitSelect } from '@/components/UnitSelect';
import { ViewField } from '@/components/ViewField';
import { Pagination, type PaginatedResult } from '@/components/Pagination';
import type {
  ProductionDashboard,
  CarpenterWorkItem,
  CarpenterSummary,
  Product,
  QualityCheck,
  FinishedStockItem,
  DispatchRecord,
  QcResult,
  HistoricalBatch,
  ProductionStage,
  ProductionSource,
  CustomerOrder,
  PartyOrder,
  WorkerType,
} from '@/types';

const STATUS_CHIP: Record<string, ChipColor> = {
  ASSIGNED: 'amber',
  IN_PROGRESS: 'blue',
  QUALITY_CHECK: 'darkGreen',
  REWORK: 'red',
  COMPLETED: 'green',
};

type GroupKey = keyof ProductionDashboard['groups'];

const GROUP_TABS: { key: GroupKey; label: string }[] = [
  { key: 'todaysWork', label: "Today's Work" },
  { key: 'waiting', label: 'Waiting' },
  { key: 'stockProduction', label: 'Stock Production' },
  { key: 'orderProduction', label: 'Order Production' },
  { key: 'completedToday', label: 'Completed Today' },
];

const WORKER_TYPE_FOR_STAGE: Record<string, string> = { CARPENTER: 'CARPENTER', CARVING: 'CARVER', POLISH: 'POLISHER' };

function WorkRow({
  item,
  onAssign,
  onSetColor,
}: {
  item: CarpenterWorkItem;
  onAssign: (item: CarpenterWorkItem) => void;
  onSetColor: (item: CarpenterWorkItem) => void;
}) {
  return (
    <tr>
      <td className="font-medium">{item.modelNo || <span className="text-brand-400 italic">Not Updated</span>}</td>
      <td>{item.productName}{item.size ? ` · ${item.size}${item.sizeUnit ? ` ${item.sizeUnit}` : ''}` : ''}</td>
      <td>{item.stage}</td>
      <td>{item.carpenter?.name ?? <span className="text-brand-400">Unassigned</span>}</td>
      <td>{item.quantity}</td>
      <td>
        {item.stage === 'POLISH' ? item.color || <span className="text-red-500 italic">Not set</span> : ''}
      </td>
      <td>{item.source === 'STOCK' ? 'Stock' : item.source === 'CUSTOMER_ORDER' ? 'Customer Order' : 'Party Order'}</td>
      <td><Chip color={STATUS_CHIP[item.status] ?? 'gray'} label={item.status.replace('_', ' ')} /></td>
      <td>{formatDate(item.workDate)}</td>
      <td>
        {!item.carpenter && item.status === 'ASSIGNED' && (
          <button className="btn-secondary text-xs" onClick={() => onAssign(item)}>
            Assign
          </button>
        )}
        {item.carpenter && item.stage === 'POLISH' && !item.color && item.status !== 'COMPLETED' && (
          <button className="btn-secondary text-xs" onClick={() => onSetColor(item)}>
            Set Colour
          </button>
        )}
      </td>
    </tr>
  );
}

// Claims an unassigned stage job (auto-created by the sequential Carpenter
// -> Carving -> Polish handoff) for a specific worker - the only place this
// was previously possible was at order-creation time; a handed-off stage
// had no assignment path at all until now.
function AssignWorkerModal({ item, onClose, onAssigned }: { item: CarpenterWorkItem; onClose: () => void; onAssigned: () => void }) {
  const workerType = WORKER_TYPE_FOR_STAGE[item.stage];
  const { data: carpenters } = useSWR<CarpenterSummary[]>(`/carpenters?workerType=${workerType}`, fetcher);
  const [carpenterId, setCarpenterId] = useState('');
  const [color, setColor] = useState(item.color ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const needsColor = item.stage === 'POLISH';

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (needsColor && !color.trim()) {
      setError('Colour is required for the Polish stage, so the polish worker knows what colour to use.');
      return;
    }
    setSubmitting(true);
    try {
      await api.patch(`/carpenter-work-items/${item.id}`, { carpenterId, color: needsColor ? color.trim() : undefined });
      onAssigned();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to assign worker');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Assign ${item.stage} Worker - ${item.productName}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="label">Worker</label>
          <select className="input" required value={carpenterId} onChange={(e) => setCarpenterId(e.target.value)}>
            <option value="">Select worker</option>
            {carpenters?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.phone ? `(${c.phone})` : ''}
              </option>
            ))}
          </select>
        </div>
        {needsColor && (
          <div>
            <label className="label">Colour (required for Polish)</label>
            <input className="input" required value={color} onChange={(e) => setColor(e.target.value)} placeholder="e.g. Walnut Brown" />
            <p className="text-[11px] text-brand-400 mt-1">Shown to the polish worker so they know what colour to use.</p>
          </div>
        )}
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={submitting || !carpenterId} className="btn-primary">
            {submitting ? 'Assigning...' : 'Assign'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// For a Polish job the sequential handoff already auto-assigned to a
// worker (so AssignWorkerModal above never ran) - this is the fallback
// entry point for Admin to fill in the colour after the fact.
function SetColorModal({ item, onClose, onSaved }: { item: CarpenterWorkItem; onClose: () => void; onSaved: () => void }) {
  const [color, setColor] = useState(item.color ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!color.trim()) {
      setError('Colour is required.');
      return;
    }
    setSubmitting(true);
    try {
      await api.patch(`/carpenter-work-items/${item.id}`, { color: color.trim() });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save colour');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={`Set Polish Colour - ${item.productName}`} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs text-brand-400">
          This job was auto-assigned to {item.carpenter?.name} with no colour set yet. Tell them what colour to use.
        </p>
        <div>
          <label className="label">Colour</label>
          <input className="input" required autoFocus value={color} onChange={(e) => setColor(e.target.value)} placeholder="e.g. Walnut Brown" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Saving...' : 'Save Colour'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

interface StockProductionRow {
  modelNo: string;
  template: Product | null;
  productName: string;
  size: string;
  sizeUnit: string;
  // Pre-set here so the sequential Carpenter -> Carving -> Polish handoff
  // auto-carries it to the Polish stage - the polisher already knows it
  // without an Admin having to notice and fill it in via "Set Colour".
  color: string;
  quantity: string;
  carpenterId: string;
}

const emptyStockProductionRow: StockProductionRow = {
  modelNo: '',
  template: null,
  productName: '',
  size: '',
  sizeUnit: '',
  color: '',
  quantity: '1',
  carpenterId: '',
};

// Multiple different products in one go - each row becomes its own
// CarpenterWorkItem (there's no shared "batch order" container for Stock
// Production the way Customer/Party Orders have multi-line items), so
// submission just fires one POST per row rather than a single combined call.
function StartStockProductionModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { data: carpenters } = useSWR<CarpenterSummary[]>('/carpenters', fetcher);
  const [rows, setRows] = useState<StockProductionRow[]>([{ ...emptyStockProductionRow }]);
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function updateRow(idx: number, patch: Partial<StockProductionRow>) {
    setRows((rs) => rs.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function addRow() {
    setRows((rs) => [...rs, { ...emptyStockProductionRow }]);
  }
  function removeRow(idx: number) {
    setRows((rs) => rs.filter((_, i) => i !== idx));
  }
  function selectTemplate(idx: number, product: Product | null) {
    if (!product) {
      updateRow(idx, { template: null });
      return;
    }
    updateRow(idx, { template: product, productName: product.name, size: product.modelSize ?? '', sizeUnit: product.sizeUnit ?? '' });
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const validRows = rows.filter((r) => r.productName.trim());
    if (validRows.length === 0) {
      setError('Add at least one product with a name');
      return;
    }
    setSubmitting(true);
    try {
      const results = await Promise.allSettled(
        validRows.map((r) =>
          api.post('/carpenter-work-items', {
            carpenterId: r.carpenterId || undefined,
            stage: 'CARPENTER',
            workDate: new Date().toISOString().slice(0, 10),
            modelNo: r.modelNo || undefined,
            productName: r.productName,
            size: r.size || undefined,
            sizeUnit: r.sizeUnit || undefined,
            color: r.color || undefined,
            quantity: r.quantity ? parseInt(r.quantity, 10) : 1,
            price: 0,
            productId: r.template?.id,
            notes: notes || undefined,
            notifyWhatsapp: false,
          }),
        ),
      );
      const failed = results
        .map((res, i) => (res.status === 'rejected' ? { row: validRows[i], reason: res.reason } : null))
        .filter((f): f is { row: StockProductionRow; reason: unknown } => f !== null);
      if (failed.length > 0) {
        const succeeded = results.length - failed.length;
        setError(
          `${succeeded > 0 ? `${succeeded} product(s) started. ` : ''}Failed: ${failed
            .map((f) => `${f.row.productName} (${f.reason instanceof ApiError ? f.reason.message : 'error'})`)
            .join(', ')}`,
        );
        onCreated();
        return;
      }
      onCreated();
      onClose();
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Start Stock Production" onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <p className="text-xs text-brand-400">Manufacture without a Customer/Party Order - finished units go straight to Godown Stock once verified. Add as many different products as you&apos;re starting today.</p>

        <div className="space-y-3 max-h-[45vh] overflow-y-auto">
          {rows.map((row, idx) => (
            <div key={idx} className="border border-brand-100 rounded-lg p-3 space-y-2">
              <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-start">
                <ModelNoPicker
                  modelNo={row.modelNo}
                  onChangeModelNo={(v) => updateRow(idx, { modelNo: v })}
                  onSelect={(p) => selectTemplate(idx, p)}
                  placeholder="Model No (optional)"
                />
                <input
                  className="input"
                  placeholder="Product Name"
                  value={row.productName}
                  onChange={(e) => updateRow(idx, { productName: e.target.value, template: null })}
                />
                <button type="button" className="text-red-500 text-xs px-2 py-2" onClick={() => removeRow(idx)} disabled={rows.length === 1}>
                  Remove
                </button>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
                <input className="input text-sm" placeholder="Size" value={row.size} onChange={(e) => updateRow(idx, { size: e.target.value })} />
                <UnitSelect id={`stock-production-size-unit-${idx}`} className="input text-sm" value={row.sizeUnit} onChange={(v) => updateRow(idx, { sizeUnit: v })} />
                <input
                  type="number"
                  min="1"
                  className="input text-sm"
                  placeholder="Qty"
                  value={row.quantity}
                  onChange={(e) => updateRow(idx, { quantity: e.target.value })}
                />
                <select className="input text-sm" value={row.carpenterId} onChange={(e) => updateRow(idx, { carpenterId: e.target.value })}>
                  <option value="">Unassigned</option>
                  {carpenters?.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name} ({c.team?.name ?? c.workerType})
                    </option>
                  ))}
                </select>
              </div>
              <input
                className="input text-sm"
                placeholder="Polish Colour (optional - e.g. Walnut Brown)"
                value={row.color}
                onChange={(e) => updateRow(idx, { color: e.target.value })}
              />
            </div>
          ))}
        </div>
        <button type="button" className="text-brand-600 text-xs hover:underline" onClick={addRow}>
          + Add another product
        </button>

        <div>
          <label className="label">Notes (optional, applies to all products above)</label>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Starting...' : `Start Production (${rows.filter((r) => r.productName.trim()).length || 1})`}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// --- Overview tab (Production Control's original content: KPIs + grouped work lists) ---

function OverviewTab() {
  const { data, isLoading, mutate } = useSWR<ProductionDashboard>('/carpenter-work-items/dashboard', fetcher, { refreshInterval: 30000 });
  const [groupTab, setGroupTab] = useState<GroupKey>('todaysWork');
  const [startOpen, setStartOpen] = useState(false);
  const [assignTarget, setAssignTarget] = useState<CarpenterWorkItem | null>(null);
  const [colorTarget, setColorTarget] = useState<CarpenterWorkItem | null>(null);

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <button className="btn-primary" onClick={() => setStartOpen(true)}>
          + Start Stock Production
        </button>
      </div>

      {isLoading || !data ? (
        <p className="text-brand-400 text-sm">Loading...</p>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard label="Active Workers" value={String(data.kpis.activeWorkers)} />
            <StatCard label="Jobs In Progress" value={String(data.kpis.jobsInProgress)} accent="warning" />
            <StatCard label="Ready for Verification" value={String(data.kpis.readyForVerification)} accent="success" />
            <StatCard label="Completed Today" value={String(data.kpis.completedToday)} accent="success" />
            <StatCard label="Carpenter Pending" value={String(data.kpis.pendingByStage.CARPENTER)} />
            <StatCard label="Carving Pending" value={String(data.kpis.pendingByStage.CARVING)} />
            <StatCard label="Polish Pending" value={String(data.kpis.pendingByStage.POLISH)} />
            <StatCard label="Materials Used Today" value={String(data.kpis.materialsUsedToday)} />
          </div>

          <div className="flex gap-1 border-b border-brand-100 flex-wrap">
            {GROUP_TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setGroupTab(key)}
                className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
                  groupTab === key ? 'border-brand-600 text-brand-900' : 'border-transparent text-brand-400 hover:text-brand-700'
                }`}
              >
                {label} ({data.groups[key].length})
              </button>
            ))}
          </div>

          <div className="card overflow-x-auto">
            <table className="table-shell">
              <thead>
                <tr>
                  <th>Model No</th>
                  <th>Product</th>
                  <th>Stage</th>
                  <th>Employee</th>
                  <th>Qty</th>
                  <th>Colour</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Date</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {data.groups[groupTab].length === 0 && (
                  <tr><td colSpan={10} className="text-center text-brand-400 py-6">Nothing here right now.</td></tr>
                )}
                {data.groups[groupTab].map((item) => (
                  <WorkRow key={item.id} item={item} onAssign={setAssignTarget} onSetColor={setColorTarget} />
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {startOpen && <StartStockProductionModal onClose={() => setStartOpen(false)} onCreated={mutate} />}
      {assignTarget && (
        <AssignWorkerModal item={assignTarget} onClose={() => setAssignTarget(null)} onAssigned={mutate} />
      )}
      {colorTarget && (
        <SetColorModal item={colorTarget} onClose={() => setColorTarget(null)} onSaved={mutate} />
      )}
    </div>
  );
}

// --- Verification tab ---

function VerificationTab() {
  const { data: readyForVerification, isLoading, mutate } = useSWR<CarpenterWorkItem[]>('/carpenter-work-items?status=QUALITY_CHECK', fetcher);
  const [verifyBatchTarget, setVerifyBatchTarget] = useState<CarpenterWorkItem | null>(null);
  const { data: batchHistory } = useSWR<CarpenterWorkItem[]>(
    verifyBatchTarget?.batchId ? `/carpenter-work-items?batchId=${verifyBatchTarget.batchId}` : null,
    fetcher,
  );
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [verifySuccess, setVerifySuccess] = useState<string | null>(null);

  async function verifyAndAddToStock(item: CarpenterWorkItem) {
    setBusyId(item.id);
    setError(null);
    try {
      await api.post(`/carpenter-work-items/${item.id}/verify`);
      setVerifySuccess('Product successfully added to Godown Stock and moved from Dispatch Pipeline.');
      setVerifyBatchTarget(null);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to verify and add to stock');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600">{error}</p>}
      {verifySuccess && (
        <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2">{verifySuccess}</p>
      )}

      <div className="card overflow-x-auto">
        <table className="table-shell">
          <thead>
            <tr>
              <th>Model No</th>
              <th>Product</th>
              <th>Qty</th>
              <th>Type</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="text-center text-brand-400 py-6">Loading...</td></tr>
            )}
            {!isLoading && (readyForVerification?.length ?? 0) === 0 && (
              <tr><td colSpan={6} className="text-center text-brand-400 py-6">Nothing waiting on verification right now.</td></tr>
            )}
            {readyForVerification?.map((item) => (
              <tr key={item.id}>
                <td className="font-medium">{item.modelNo || <span className="text-brand-400 italic">Not Updated</span>}</td>
                <td>{item.productName}{item.size ? ` · ${item.size}${item.sizeUnit ? ` ${item.sizeUnit}` : ''}` : ''}</td>
                <td>{item.quantity}</td>
                <td>{item.source === 'STOCK' ? 'Stock Production' : item.source === 'CUSTOMER_ORDER' ? 'Customer Order' : 'Party Order'}</td>
                <td><Chip color="blue" label="Ready for Verification" /></td>
                <td className="text-right whitespace-nowrap flex gap-2 justify-end">
                  <button className="btn-secondary text-xs" onClick={() => setVerifyBatchTarget(item)}>
                    View
                  </button>
                  <button className="btn-primary text-xs" disabled={busyId === item.id} onClick={() => verifyAndAddToStock(item)}>
                    {busyId === item.id ? 'Verifying…' : 'Verify & Add to Stock'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {verifyBatchTarget && (
        <Modal title={`Production Run - ${verifyBatchTarget.productName}`} onClose={() => setVerifyBatchTarget(null)} wide>
          <div className="space-y-4">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-sm">
              <ViewField label="Model No" value={verifyBatchTarget.modelNo ?? 'Not Updated'} />
              <ViewField label="Product" value={verifyBatchTarget.productName} />
              <ViewField label="Quantity" value={String(verifyBatchTarget.quantity)} />
              <ViewField
                label="Source"
                value={
                  verifyBatchTarget.source === 'STOCK'
                    ? 'Stock Production'
                    : verifyBatchTarget.source === 'CUSTOMER_ORDER'
                      ? 'Customer Order'
                      : 'Party Order'
                }
              />
            </div>
            <div className="border-t border-brand-100 pt-3">
              <h3 className="text-sm font-semibold text-brand-900 mb-2">Stage History</h3>
              <div className="space-y-2">
                {(batchHistory ?? [])
                  .slice()
                  .sort((a, b) => a.stage.localeCompare(b.stage))
                  .map((stageItem) => (
                    <div key={stageItem.id} className="border border-brand-100 rounded-lg p-3">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 text-sm">
                        <ViewField label="Stage" value={stageItem.stage} />
                        <ViewField label="Employee" value={stageItem.carpenter?.name ?? 'Unassigned'} />
                        <ViewField label="Status" value={stageItem.status} />
                        {stageItem.stage === 'POLISH' && <ViewField label="Colour" value={stageItem.color ?? 'Not set'} />}
                        <ViewField label="Assigned By" value={stageItem.assignedBy?.name ?? '-'} />
                        <ViewField label="Started" value={stageItem.startedAt ? new Date(stageItem.startedAt).toLocaleString() : '-'} />
                        <ViewField label="Finished" value={stageItem.finishedAt ? new Date(stageItem.finishedAt).toLocaleString() : '-'} />
                        <div className="col-span-2">
                          <ViewField label="Notes" value={stageItem.notes ?? '-'} />
                        </div>
                      </div>
                      {stageItem.stockMovements && stageItem.stockMovements.length > 0 && (
                        <div className="mt-2 pt-2 border-t border-brand-100">
                          <p className="text-xs font-medium text-brand-500 mb-1">Raw Materials Used</p>
                          {stageItem.stockMovements.map((m) => (
                            <p key={m.id} className="text-xs text-brand-600">
                              {m.rawMaterial?.name}: {Math.abs(Number(m.quantity))} {m.rawMaterial?.unit}
                            </p>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <button className="btn-secondary" onClick={() => setVerifyBatchTarget(null)}>
                Close
              </button>
              <button
                className="btn-primary"
                disabled={busyId === verifyBatchTarget.id}
                onClick={() => verifyAndAddToStock(verifyBatchTarget)}
              >
                {busyId === verifyBatchTarget.id ? 'Verifying…' : 'Verify & Add to Stock'}
              </button>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}

// --- Dispatch Pipeline tab (QC -> Finished Stock -> Dispatch, legacy items only - see the batchId filter below) ---

type PipelineStage = 'awaiting_qc' | 'rework' | 'awaiting_stock' | 'in_stock' | 'dispatched';

const STAGE_LABEL: Record<PipelineStage, string> = {
  awaiting_qc: 'Ready for Quality Check',
  rework: 'Sent Back for Rework',
  awaiting_stock: 'Passed - Add to Finished Stock',
  in_stock: 'In Finished Stock',
  dispatched: 'Dispatched',
};

const STAGE_CHIP: Record<PipelineStage, ChipColor> = {
  awaiting_qc: 'amber',
  rework: 'red',
  awaiting_stock: 'blue',
  in_stock: 'darkGreen',
  dispatched: 'green',
};

const STEPS: { key: Exclude<PipelineStage, 'rework'>; label: string }[] = [
  { key: 'awaiting_qc', label: 'QC' },
  { key: 'awaiting_stock', label: 'Stock' },
  { key: 'in_stock', label: 'Ready' },
  { key: 'dispatched', label: 'Sent' },
];
const STEP_ORDER = STEPS.map((s) => s.key);

function Stepper({ stage }: { stage: PipelineStage }) {
  if (stage === 'rework') {
    return <Chip color="red" label="Rework needed" />;
  }
  const currentIndex = STEP_ORDER.indexOf(stage);
  return (
    <div className="flex items-center gap-1">
      {STEPS.map((step, i) => (
        <div key={step.key} className="flex items-center gap-1">
          <span
            className={`h-2 w-2 rounded-full ${i <= currentIndex ? 'bg-emerald-500' : 'bg-brand-200'}`}
            title={step.label}
          />
          {i < STEPS.length - 1 && <span className={`h-px w-3 ${i < currentIndex ? 'bg-emerald-500' : 'bg-brand-200'}`} />}
        </div>
      ))}
    </div>
  );
}

function DispatchTab() {
  const { data: workItems, isLoading, mutate: mutateWork } = useSWR<CarpenterWorkItem[]>(
    '/carpenter-work-items?status=COMPLETED',
    fetcher,
  );
  const { data: qcChecks, mutate: mutateQc } = useSWR<QualityCheck[]>('/quality-checks', fetcher);
  const { data: stockItems, mutate: mutateStock } = useSWR<FinishedStockItem[]>('/finished-stock', fetcher);
  const { data: dispatches, mutate: mutateDispatch } = useSWR<DispatchRecord[]>('/dispatch-records', fetcher);

  const [qcModalItem, setQcModalItem] = useState<CarpenterWorkItem | null>(null);
  const [qcResult, setQcResult] = useState<QcResult>('PASSED');
  const [qcRemarks, setQcRemarks] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Items from the sequential Carpenter -> Carving -> Polish engine
  // (identified by having a batchId) are excluded here - those go through
  // the Verification tab and the /verify endpoint instead, never this
  // manual QC/Add-to-Stock flow, so a mid-pipeline stage handoff (which
  // also briefly sits at status COMPLETED) never shows up here as if it
  // were a finished cot ready for QC.
  const rows = useMemo(() => {
    if (!workItems) return [];
    return workItems.filter((item) => !item.batchId).map((item) => {
      const jobNumber = item.modelNo || item.id;
      const latestQc = qcChecks?.filter((q) => q.workItemId === item.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
      const stock = stockItems?.find((s) => s.jobNumber === jobNumber);
      const dispatch = dispatches?.find((d) => d.jobNumber === jobNumber);

      let stage: PipelineStage = 'awaiting_qc';
      if (dispatch || stock?.status === 'DISPATCHED') stage = 'dispatched';
      else if (stock) stage = 'in_stock';
      else if (latestQc?.result === 'PASSED') stage = 'awaiting_stock';
      else if (latestQc) stage = 'rework';

      return { item, jobNumber, stage, stock };
    });
  }, [workItems, qcChecks, stockItems, dispatches]);

  async function submitQc(e: React.FormEvent) {
    e.preventDefault();
    if (!qcModalItem) return;
    setError(null);
    try {
      await api.post('/quality-checks', {
        jobNumber: qcModalItem.modelNo || qcModalItem.id,
        workItemId: qcModalItem.id,
        result: qcResult,
        remarks: qcRemarks || undefined,
      });
      setQcModalItem(null);
      setQcRemarks('');
      mutateQc();
      mutateWork();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record quality check');
    }
  }

  async function addToStock(item: CarpenterWorkItem, jobNumber: string) {
    setBusyId(item.id);
    setError(null);
    try {
      await api.post('/finished-stock', {
        jobNumber,
        productName: item.productName,
        quantity: item.quantity,
        completionDate: new Date().toISOString().slice(0, 10),
      });
      mutateStock();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add to finished stock');
    } finally {
      setBusyId(null);
    }
  }

  async function dispatchItem(jobNumber: string, finishedStockId: string) {
    setBusyId(finishedStockId);
    setError(null);
    try {
      await api.post('/dispatch-records', {
        jobNumber,
        finishedStockId,
        dispatchDate: new Date().toISOString().slice(0, 10),
      });
      mutateStock();
      mutateDispatch();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to dispatch');
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="space-y-4">
      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="card overflow-x-auto">
        <table className="table-shell">
          <thead>
            <tr>
              <th>Model No</th>
              <th>Product</th>
              <th>Completed</th>
              <th>Progress</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr><td colSpan={6} className="text-center text-brand-400 py-6">Loading...</td></tr>
            )}
            {!isLoading && rows.length === 0 && (
              <tr><td colSpan={6} className="text-center text-brand-400 py-6">No completed cots waiting on the pipeline yet.</td></tr>
            )}
            {rows.map(({ item, jobNumber, stage, stock }) => (
              <tr key={item.id}>
                <td className="font-medium">{item.modelNo || '-'}</td>
                <td>{item.productName}{item.size ? ` · ${item.size}${item.sizeUnit ? ` ${item.sizeUnit}` : ''}` : ''}</td>
                <td>{formatDate(item.workDate)}</td>
                <td><Stepper stage={stage} /></td>
                <td><Chip color={STAGE_CHIP[stage]} label={STAGE_LABEL[stage]} /></td>
                <td className="text-right whitespace-nowrap">
                  {(stage === 'awaiting_qc' || stage === 'rework') && (
                    <button className="btn-secondary text-xs" onClick={() => { setQcModalItem(item); setQcResult('PASSED'); setQcRemarks(''); }}>
                      {stage === 'rework' ? 'Re-check' : 'Record QC'}
                    </button>
                  )}
                  {stage === 'awaiting_stock' && (
                    <button className="btn-primary text-xs" disabled={busyId === item.id} onClick={() => addToStock(item, jobNumber)}>
                      {busyId === item.id ? 'Adding…' : 'Add to Finished Stock'}
                    </button>
                  )}
                  {stage === 'in_stock' && stock && (
                    <button className="btn-primary text-xs" disabled={busyId === stock.id} onClick={() => dispatchItem(jobNumber, stock.id)}>
                      {busyId === stock.id ? 'Dispatching…' : 'Dispatch'}
                    </button>
                  )}
                  {stage === 'dispatched' && <span className="text-xs text-emerald-600">Delivered to shop ✓</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {qcModalItem && (
        <Modal title={`Quality Check - ${qcModalItem.productName}`} onClose={() => setQcModalItem(null)}>
          <form onSubmit={submitQc} className="space-y-3">
            <div>
              <label className="label">Result</label>
              <div className="flex gap-2">
                {(['PASSED', 'FAILED', 'REWORK_REQUIRED'] as QcResult[]).map((r) => (
                  <button
                    type="button"
                    key={r}
                    onClick={() => setQcResult(r)}
                    className={`flex-1 rounded-lg border px-3 py-2 text-sm font-medium ${
                      qcResult === r ? 'border-brand-600 bg-brand-50 text-brand-900' : 'border-brand-100 text-brand-500'
                    }`}
                  >
                    {r === 'PASSED' ? '✓ Passed' : r === 'FAILED' ? '✕ Failed' : '↺ Rework'}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="label">Remarks (optional)</label>
              <textarea className="input" rows={3} value={qcRemarks} onChange={(e) => setQcRemarks(e.target.value)} placeholder="What to fix, if anything" />
            </div>
            <button type="submit" className="btn-primary w-full">
              Save Quality Check
            </button>
          </form>
        </Modal>
      )}
    </div>
  );
}

// --- Historical / Offline Entry tab -----------------------------------
// Manually recording old paper production records - deliberately NOT the
// live Assign -> Start -> End flow above (see the backend's
// CarpenterService "Historical / Offline Entry" section). One record here
// = however many employee/stage lines the old paper entry covers, saved
// together and shown/edited/deleted as one row.

const HIST_STAGE_LABEL: Record<ProductionStage, string> = { CARPENTER: 'Carpenter', CARVING: 'Carving', POLISH: 'Polish' };
const HIST_STAGE_WORKER_TYPE: Record<ProductionStage, WorkerType> = { CARPENTER: 'CARPENTER', CARVING: 'CARVER', POLISH: 'POLISHER' };
const HIST_SOURCE_LABEL: Record<ProductionSource, string> = {
  CUSTOMER_ORDER: 'Customer Order',
  PARTY_ORDER: 'Party Order',
  STOCK: 'Stock',
  OTHER: 'Other / Unlinked',
};

interface HistLineForm {
  carpenterId: string;
  stage: ProductionStage;
  quantity: string;
  notes: string;
}
const emptyHistLine: HistLineForm = { carpenterId: '', stage: 'CARPENTER', quantity: '1', notes: '' };

interface HistFormState {
  workDate: string;
  modelNo: string;
  productName: string;
  pattern: string;
  size: string;
  sizeUnit: string;
  source: ProductionSource;
  sourceCustomerOrderId: string;
  sourceCustomerOrderLabel: string;
  sourcePartyOrderItemId: string;
  sourcePartyOrderItemLabel: string;
}
const emptyHistForm: HistFormState = {
  workDate: new Date().toISOString().slice(0, 10),
  modelNo: '',
  productName: '',
  pattern: '',
  size: '',
  sizeUnit: '',
  source: 'OTHER',
  sourceCustomerOrderId: '',
  sourceCustomerOrderLabel: '',
  sourcePartyOrderItemId: '',
  sourcePartyOrderItemLabel: '',
};

function batchToForm(b: HistoricalBatch): HistFormState {
  return {
    workDate: b.workDate.slice(0, 10),
    modelNo: b.modelNo ?? '',
    productName: b.productName,
    pattern: b.pattern ?? '',
    size: b.size ?? '',
    sizeUnit: b.sizeUnit ?? '',
    source: b.source,
    sourceCustomerOrderId: b.sourceCustomerOrderId ?? '',
    sourceCustomerOrderLabel: b.sourceCustomerOrder ? `${b.sourceCustomerOrder.orderId} - ${b.sourceCustomerOrder.customerName}` : '',
    sourcePartyOrderItemId: b.sourcePartyOrderItemId ?? '',
    sourcePartyOrderItemLabel: b.sourcePartyOrderItem
      ? `${b.sourcePartyOrderItem.order.shopName} - ${b.sourcePartyOrderItem.productName}`
      : '',
  };
}

// Simple type-to-search picker, reused for both Customer and Party Order
// references - same "search box + dropdown of matches" shape already used
// by ModelNoPicker, just against a different endpoint.
function OrderSearchPicker<T>({
  placeholder,
  searchPath,
  renderLabel,
  onSelect,
  selectedLabel,
  onClear,
}: {
  placeholder: string;
  searchPath: (q: string) => string;
  renderLabel: (item: T) => string;
  onSelect: (item: T) => void;
  selectedLabel: string;
  onClear: () => void;
}) {
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const { data } = useSWR<PaginatedResult<T> | T[]>(open && query.trim() ? searchPath(query.trim()) : null, fetcher);
  const results = data ? ('data' in data ? data.data : data) : [];

  if (selectedLabel) {
    return (
      <div className="input flex items-center justify-between gap-2 bg-brand-50">
        <span className="truncate text-sm">{selectedLabel}</span>
        <button type="button" className="text-red-500 text-xs shrink-0" onClick={onClear}>
          Clear
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <input
        className="input"
        placeholder={placeholder}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        onBlur={() => setTimeout(() => setOpen(false), 150)}
      />
      {open && query.trim() && (
        <div className="absolute z-20 mt-1 w-full max-h-52 overflow-y-auto card p-1 shadow-lg">
          {results.length === 0 ? (
            <p className="px-3 py-2 text-xs text-brand-400 italic">No matches</p>
          ) : (
            results.map((item, idx) => (
              <button
                key={idx}
                type="button"
                className="w-full text-left px-3 py-2 rounded-md hover:bg-brand-50 text-sm truncate"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(item);
                  setOpen(false);
                  setQuery('');
                }}
              >
                {renderLabel(item)}
              </button>
            ))
          )}
        </div>
      )}
    </div>
  );
}

function HistoricalEntryFormModal({
  editing,
  onClose,
  onSaved,
}: {
  editing: HistoricalBatch | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const { data: carpenters } = useSWR<CarpenterSummary[]>('/carpenters?includeInactive=false', fetcher);
  const [form, setForm] = useState<HistFormState>(editing ? batchToForm(editing) : emptyHistForm);
  const [lines, setLines] = useState<HistLineForm[]>(
    editing && editing.entries.length > 0
      ? editing.entries.map((e) => ({ carpenterId: e.carpenterId, stage: e.stage, quantity: String(e.quantity), notes: e.notes ?? '' }))
      : [{ ...emptyHistLine }],
  );
  const [partyOrderId, setPartyOrderId] = useState<string>('');
  const { data: partyOrderDetail } = useSWR<PartyOrder>(partyOrderId ? `/party-orders/${partyOrderId}` : null, fetcher);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  function updateLine(idx: number, patch: Partial<HistLineForm>) {
    setLines((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function workersForStage(stage: ProductionStage) {
    return (carpenters ?? []).filter((c) => c.workerType === HIST_STAGE_WORKER_TYPE[stage]);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    const validLines = lines.filter((l) => l.carpenterId);
    if (validLines.length === 0) {
      setError('Add at least one employee/stage line.');
      return;
    }
    setSubmitting(true);
    try {
      const payload = {
        workDate: form.workDate,
        modelNo: form.modelNo || undefined,
        productName: form.productName,
        pattern: form.pattern || undefined,
        size: form.size || undefined,
        sizeUnit: form.sizeUnit || undefined,
        source: form.source,
        sourceCustomerOrderId: form.source === 'CUSTOMER_ORDER' ? form.sourceCustomerOrderId || undefined : undefined,
        sourcePartyOrderItemId: form.source === 'PARTY_ORDER' ? form.sourcePartyOrderItemId || undefined : undefined,
        entries: validLines.map((l) => ({
          carpenterId: l.carpenterId,
          stage: l.stage,
          quantity: parseInt(l.quantity, 10) || 1,
          notes: l.notes || undefined,
        })),
      };
      if (editing) {
        await api.patch(`/carpenter-work-items/historical/${editing.batchId}`, payload);
      } else {
        await api.post('/carpenter-work-items/historical', payload);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save historical record');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={editing ? 'Edit Historical Record' : 'New Historical Record'} onClose={onClose} wide>
      <form onSubmit={handleSubmit} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Date</label>
            <input type="date" className="input" required value={form.workDate} onChange={(e) => setForm((f) => ({ ...f, workDate: e.target.value }))} />
          </div>
          <div>
            <label className="label">Model No</label>
            <ModelNoPicker modelNo={form.modelNo} onChangeModelNo={(v) => setForm((f) => ({ ...f, modelNo: v }))} onSelect={() => undefined} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Product / Model Name</label>
            <input
              className="input"
              required
              placeholder="e.g. Rauter Box"
              value={form.productName}
              onChange={(e) => setForm((f) => ({ ...f, productName: e.target.value }))}
            />
          </div>
          <div>
            <label className="label">Pattern</label>
            <input className="input" placeholder="e.g. B.Cat" value={form.pattern} onChange={(e) => setForm((f) => ({ ...f, pattern: e.target.value }))} />
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Size</label>
            <input className="input" placeholder="e.g. 78x84" value={form.size} onChange={(e) => setForm((f) => ({ ...f, size: e.target.value }))} />
          </div>
          <div>
            <label className="label">Size Unit</label>
            <input className="input" placeholder="e.g. Inch" value={form.sizeUnit} onChange={(e) => setForm((f) => ({ ...f, sizeUnit: e.target.value }))} />
          </div>
        </div>

        <div>
          <label className="label">Source Type</label>
          <div className="flex flex-wrap gap-3 mb-2">
            {(Object.keys(HIST_SOURCE_LABEL) as ProductionSource[]).map((s) => (
              <label key={s} className="flex items-center gap-1.5 text-sm">
                <input
                  type="radio"
                  checked={form.source === s}
                  onChange={() =>
                    setForm((f) => ({
                      ...f,
                      source: s,
                      sourceCustomerOrderId: '',
                      sourceCustomerOrderLabel: '',
                      sourcePartyOrderItemId: '',
                      sourcePartyOrderItemLabel: '',
                    }))
                  }
                />
                {HIST_SOURCE_LABEL[s]}
              </label>
            ))}
          </div>
          {form.source === 'CUSTOMER_ORDER' && (
            <OrderSearchPicker<CustomerOrder>
              placeholder="Search Customer Order (Order ID / Customer Name)..."
              searchPath={(q) => `/customer-orders?search=${encodeURIComponent(q)}&limit=10`}
              renderLabel={(o) => `${o.orderId} - ${o.customerName}`}
              selectedLabel={form.sourceCustomerOrderLabel}
              onSelect={(o) => setForm((f) => ({ ...f, sourceCustomerOrderId: o.id, sourceCustomerOrderLabel: `${o.orderId} - ${o.customerName}` }))}
              onClear={() => setForm((f) => ({ ...f, sourceCustomerOrderId: '', sourceCustomerOrderLabel: '' }))}
            />
          )}
          {form.source === 'PARTY_ORDER' && !form.sourcePartyOrderItemLabel && (
            <>
              <OrderSearchPicker<PartyOrder>
                placeholder="Search Party Order (Shop Name)..."
                searchPath={(q) => `/party-orders?search=${encodeURIComponent(q)}&limit=10`}
                renderLabel={(o) => `${o.shopName} - ${o.jobNumber ?? o.id.slice(0, 8)}`}
                selectedLabel=""
                onSelect={(o) => setPartyOrderId(o.id)}
                onClear={() => setPartyOrderId('')}
              />
              {partyOrderId && partyOrderDetail && (
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-brand-500">{partyOrderDetail.shopName} - pick which product line:</p>
                  {partyOrderDetail.items.map((it) => (
                    <button
                      key={it.id}
                      type="button"
                      className="w-full text-left px-3 py-2 rounded-md border border-brand-100 hover:bg-brand-50 text-sm"
                      onClick={() =>
                        setForm((f) => ({
                          ...f,
                          sourcePartyOrderItemId: it.id,
                          sourcePartyOrderItemLabel: `${partyOrderDetail.shopName} - ${it.productName}`,
                        }))
                      }
                    >
                      {it.productName} {it.size ? `(${it.size}${it.sizeUnit ?? ''})` : ''}
                    </button>
                  ))}
                </div>
              )}
            </>
          )}
          {form.source === 'PARTY_ORDER' && form.sourcePartyOrderItemLabel && (
            <div className="input flex items-center justify-between gap-2 bg-brand-50">
              <span className="truncate text-sm">{form.sourcePartyOrderItemLabel}</span>
              <button
                type="button"
                className="text-red-500 text-xs shrink-0"
                onClick={() => {
                  setPartyOrderId('');
                  setForm((f) => ({ ...f, sourcePartyOrderItemId: '', sourcePartyOrderItemLabel: '' }));
                }}
              >
                Clear
              </button>
            </div>
          )}
        </div>

        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="label mb-0">Employee Work Records</label>
            <button type="button" className="text-brand-600 text-xs hover:underline" onClick={() => setLines((rows) => [...rows, { ...emptyHistLine }])}>
              + Add employee/stage
            </button>
          </div>
          <div className="space-y-2">
            {lines.map((line, idx) => (
              <div key={idx} className="grid grid-cols-1 sm:grid-cols-[110px_1fr_70px_1fr_auto] gap-2 items-center border border-brand-100 rounded-lg p-2">
                <select
                  className="input"
                  value={line.stage}
                  onChange={(e) => updateLine(idx, { stage: e.target.value as ProductionStage, carpenterId: '' })}
                >
                  {(Object.keys(HIST_STAGE_LABEL) as ProductionStage[]).map((s) => (
                    <option key={s} value={s}>
                      {HIST_STAGE_LABEL[s]}
                    </option>
                  ))}
                </select>
                <select className="input" required value={line.carpenterId} onChange={(e) => updateLine(idx, { carpenterId: e.target.value })}>
                  <option value="">Select employee...</option>
                  {workersForStage(line.stage).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <input
                  type="number"
                  min="1"
                  className="input"
                  placeholder="Qty"
                  value={line.quantity}
                  onChange={(e) => updateLine(idx, { quantity: e.target.value })}
                />
                <input
                  className="input"
                  placeholder="Remarks"
                  value={line.notes}
                  onChange={(e) => updateLine(idx, { notes: e.target.value })}
                />
                <button type="button" className="text-red-500 text-xs" disabled={lines.length === 1} onClick={() => setLines((rows) => rows.filter((_, i) => i !== idx))}>
                  Remove
                </button>
              </div>
            ))}
          </div>
        </div>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Save Historical Record'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

function HistoricalTab() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<HistoricalBatch | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<HistoricalBatch | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const { data: result, isLoading, mutate } = useSWR<PaginatedResult<HistoricalBatch>>(
    `/carpenter-work-items/historical?${new URLSearchParams({ ...(search ? { search } : {}), page: String(page), limit: '15' })}`,
    fetcher,
  );
  const data = result?.data;

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api.delete(`/carpenter-work-items/historical/${deleteTarget.batchId}`);
      setDeleteTarget(null);
      setNotice('Historical record deleted.');
      mutate();
    } catch {
      // Global toast (see lib/api.ts) already surfaces why - e.g. blocked
      // by real material-usage/QC history - dialog just stays open so the
      // user can Cancel or retry.
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-sm text-brand-600 max-w-xl">
            Manually record old paper production entries here - these are marked Historical and never enter the live Assign
            &rarr; Start &rarr; End workflow or count as pending work.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary text-sm shrink-0"
          onClick={() => {
            setEditing(null);
            setFormOpen(true);
          }}
        >
          + New Historical Record
        </button>
      </div>

      <input
        className="input max-w-xs"
        placeholder="Search Model No / Product..."
        value={search}
        onChange={(e) => {
          setSearch(e.target.value);
          setPage(1);
        }}
      />

      {notice && <p className="text-sm text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">{notice}</p>}

      <div className="card overflow-x-auto">
        <table className="table-shell">
          <thead>
            <tr>
              <th>Date</th>
              <th>Model No</th>
              <th>Product</th>
              <th>Pattern</th>
              <th>Size</th>
              <th>Source</th>
              <th>Employees</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="text-center py-8 text-brand-400">
                  Loading...
                </td>
              </tr>
            )}
            {!isLoading && data?.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-8 text-brand-400">
                  No historical records yet
                </td>
              </tr>
            )}
            {data?.map((b) => (
              <tr key={b.batchId}>
                <td>{formatDate(b.workDate)}</td>
                <td className="text-xs">{b.modelNo ?? '-'}</td>
                <td>{b.productName}</td>
                <td className="text-brand-500">{b.pattern ?? '-'}</td>
                <td className="text-brand-500">{b.size ? `${b.size}${b.sizeUnit ?? ''}` : '-'}</td>
                <td className="text-xs text-brand-500">
                  {HIST_SOURCE_LABEL[b.source]}
                  {b.sourceCustomerOrder && <div className="text-[10px]">{b.sourceCustomerOrder.orderId}</div>}
                  {b.sourcePartyOrderItem && <div className="text-[10px]">{b.sourcePartyOrderItem.order.shopName}</div>}
                </td>
                <td className="text-xs">
                  {b.entries.map((e) => `${HIST_STAGE_LABEL[e.stage]}: ${e.carpenter?.name ?? '-'}`).join(', ')}
                </td>
                <td>
                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="text-brand-600 hover:underline text-xs"
                      onClick={() => {
                        setEditing(b);
                        setFormOpen(true);
                      }}
                    >
                      Edit
                    </button>
                    <button type="button" className="text-red-500 hover:underline text-xs" onClick={() => setDeleteTarget(b)}>
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {result && <Pagination page={result.page} totalPages={result.totalPages} total={result.total} limit={result.limit} onPageChange={setPage} />}
      </div>

      {formOpen && (
        <HistoricalEntryFormModal
          editing={editing}
          onClose={() => setFormOpen(false)}
          onSaved={() => {
            setNotice(editing ? 'Historical record updated.' : 'Historical record saved.');
            mutate();
          }}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Historical Record"
          message={`Delete this historical record for ${deleteTarget.productName}${deleteTarget.modelNo ? ` (Model ${deleteTarget.modelNo})` : ''}? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

// --- Page shell: one menu entry, four tabs ---

type TopTab = 'overview' | 'dispatch' | 'verification' | 'historical';

const TOP_TABS: { key: TopTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'dispatch', label: 'Dispatch Pipeline' },
  { key: 'verification', label: 'Ready for Verification' },
  { key: 'historical', label: 'Historical Entry' },
];

function ProductionControlContent() {
  const [tab, setTab] = useState<TopTab>('overview');

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-900">Production Control</h1>
        <p className="text-sm text-brand-500 mt-1">
          Everything about production in one place - who&apos;s working on what, what&apos;s ready to verify, and what happens after a cot is finished.
        </p>
      </div>

      <div className="flex gap-1 border-b border-brand-100">
        {TOP_TABS.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={`px-4 py-2 text-sm font-medium border-b-2 -mb-px ${
              tab === key ? 'border-brand-600 text-brand-900' : 'border-transparent text-brand-400 hover:text-brand-700'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab />}
      {tab === 'dispatch' && <DispatchTab />}
      {tab === 'verification' && <VerificationTab />}
      {tab === 'historical' && <HistoricalTab />}
    </div>
  );
}

export default function ProductionControlPage() {
  return (
    <RoleGate minRole={['SUPERADMIN', 'ADMIN']}>
      <ProductionControlContent />
    </RoleGate>
  );
}
