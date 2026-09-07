'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { StatCard } from '@/components/StatCard';
import { Chip, type ChipColor } from '@/components/StatusBadge';
import { Modal } from '@/components/Modal';
import { RoleGate } from '@/components/RoleGate';
import { ModelNoPicker } from '@/components/ModelNoPicker';
import { ViewField } from '@/components/ViewField';
import type {
  ProductionDashboard,
  CarpenterWorkItem,
  CarpenterSummary,
  Product,
  QualityCheck,
  FinishedStockItem,
  DispatchRecord,
  QcResult,
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
      <td>{item.productName}{item.size ? ` · ${item.size}` : ''}</td>
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

function StartStockProductionModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const { data: carpenters } = useSWR<CarpenterSummary[]>('/carpenters', fetcher);
  const [modelNo, setModelNo] = useState('');
  const [template, setTemplate] = useState<Product | null>(null);
  const [productName, setProductName] = useState('');
  const [size, setSize] = useState('');
  const [quantity, setQuantity] = useState('1');
  const [carpenterId, setCarpenterId] = useState('');
  const [notes, setNotes] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function selectTemplate(product: Product | null) {
    setTemplate(product);
    if (product) {
      setProductName(product.name);
      setSize(product.modelSize ?? '');
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (!productName.trim()) {
      setError('Product name is required');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/carpenter-work-items', {
        carpenterId: carpenterId || undefined,
        stage: 'CARPENTER',
        workDate: new Date().toISOString().slice(0, 10),
        modelNo: modelNo || undefined,
        productName,
        size: size || undefined,
        quantity: quantity ? parseInt(quantity, 10) : 1,
        price: 0,
        productId: template?.id,
        notes: notes || undefined,
        notifyWhatsapp: false,
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to start stock production');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title="Start Stock Production" onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <p className="text-xs text-brand-400">Manufacture without a Customer/Party Order - finished units go straight to Godown Stock once verified.</p>
        <div>
          <label className="label">Model No (optional - reuse an existing design as a template, or leave blank)</label>
          <ModelNoPicker modelNo={modelNo} onChangeModelNo={setModelNo} onSelect={selectTemplate} placeholder="Search or type new Model No" />
        </div>
        <div>
          <label className="label">Product Name</label>
          <input className="input" required value={productName} onChange={(e) => setProductName(e.target.value)} placeholder="HEARTEN Cot" />
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Size</label>
            <input className="input" value={size} onChange={(e) => setSize(e.target.value)} placeholder="5FT" />
          </div>
          <div>
            <label className="label">Quantity</label>
            <input type="number" min="1" className="input" value={quantity} onChange={(e) => setQuantity(e.target.value)} />
          </div>
        </div>
        <div>
          <label className="label">Assign Carpenter (optional - leave unassigned to pick later)</label>
          <select className="input" value={carpenterId} onChange={(e) => setCarpenterId(e.target.value)}>
            <option value="">Unassigned for now</option>
            {carpenters?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} ({c.workerType})
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Notes (optional)</label>
          <input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Starting...' : 'Start Production'}
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

          <div className="card overflow-hidden">
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

      <div className="card overflow-hidden">
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
                <td>{item.productName}{item.size ? ` · ${item.size}` : ''}</td>
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

      <div className="card overflow-hidden">
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
                <td>{item.productName}{item.size ? ` · ${item.size}` : ''}</td>
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

// --- Page shell: one menu entry, three tabs ---

type TopTab = 'overview' | 'dispatch' | 'verification';

const TOP_TABS: { key: TopTab; label: string }[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'dispatch', label: 'Dispatch Pipeline' },
  { key: 'verification', label: 'Ready for Verification' },
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
