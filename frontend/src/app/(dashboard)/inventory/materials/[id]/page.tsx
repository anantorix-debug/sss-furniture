'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError, getAccessToken } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate } from '@/lib/format';
import { StatCard } from '@/components/StatCard';
import { Chip } from '@/components/StatusBadge';
import { FilterBar } from '@/components/FilterBar';
import { boardFeetPreview } from '@/lib/boardFeet';
import type { PaginatedResult } from '@/components/Pagination';
import type { RawMaterialDetail, CarpenterWorkItem, CarpenterSummary, StockMovement, WorkerType } from '@/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

const MOVEMENT_TYPE_OPTIONS = [
  { value: 'IN', label: 'Stock In' },
  { value: 'OUT', label: 'Issued / Consumed' },
  { value: 'ADJUSTMENT', label: 'Adjustment' },
];
const MOVEMENT_ROLE_OPTIONS: { value: WorkerType; label: string }[] = [
  { value: 'CARPENTER', label: 'Carpenter' },
  { value: 'CARVER', label: 'Carving' },
  { value: 'POLISHER', label: 'Polisher' },
];
const emptyMovementFilters: Record<string, string> = {};

export default function MaterialDetailPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasRole } = useAuth();
  // Recording a purchase/receipt now happens on the Suppliers ledger, so
  // stock and the supplier/financial record always stay in sync - this
  // page only links there. Issuing material against a work item stays open
  // to Carpenter/Polisher - that's the flow that lets Super Admin see how
  // much material each employee actually used. Stock Adjustment (damage/
  // wastage correction) is Admin-only.
  const canRecordPurchase = hasRole('ADMIN');
  const canIssue = hasRole('ADMIN', 'CARPENTER', 'CARVER', 'POLISHER');
  const canAdjust = hasRole('ADMIN');
  const canSeeCost = hasRole('ADMIN');
  const { data: material, isLoading, mutate } = useSWR<RawMaterialDetail>(`/raw-materials/${id}`, fetcher);
  // Open work items to issue material against - lets Super Admin see
  // exactly which employee (via the work item's assigned carpenter) took
  // how much of this material, instead of issues going unattributed.
  const { data: workItems } = useSWR<CarpenterWorkItem[]>(canIssue ? '/carpenter-work-items' : null, fetcher);
  const openWorkItems = (workItems ?? []).filter((w) => w.status !== 'COMPLETED');

  const [adjustForm, setAdjustForm] = useState({ date: new Date().toISOString().slice(0, 10), quantity: '', reason: '' });
  const [issueForm, setIssueForm] = useState({
    date: new Date().toISOString().slice(0, 10),
    workItemId: '',
    quantity: '',
    thicknessIn: '',
    widthIn: '',
    lengthFt: '',
    pieces: '',
    reason: '',
  });
  const [error, setError] = useState<string | null>(null);

  const { data: carpenters } = useSWR<CarpenterSummary[]>('/carpenters', fetcher);
  const [movementValues, setMovementValues] = useState<Record<string, string>>(emptyMovementFilters);
  const [movementApplied, setMovementApplied] = useState<Record<string, string>>(emptyMovementFilters);
  const [downloadingPdf, setDownloadingPdf] = useState(false);
  const movementParams = new URLSearchParams({ ...movementApplied, rawMaterialId: id, page: '1', limit: '200' });
  const { data: movementsResult, mutate: mutateMovements } = useSWR<PaginatedResult<StockMovement>>(`/stock-movements?${movementParams}`, fetcher);
  const movements = movementsResult?.data ?? [];

  function applyMovementFilters() {
    setMovementApplied(movementValues);
  }
  function resetMovementFilters() {
    setMovementValues(emptyMovementFilters);
    setMovementApplied(emptyMovementFilters);
  }

  async function downloadMaterialPdf() {
    setDownloadingPdf(true);
    try {
      const token = getAccessToken();
      const res = await fetch(`${API_BASE_URL}/raw-materials/${id}/pdf?${new URLSearchParams(movementApplied)}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${material?.name ?? 'material'}-detail.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } finally {
      setDownloadingPdf(false);
    }
  }

  const isBoardFeet = material?.measurementKind === 'BOARD_FEET';
  // Plank size from the most recent Purchase - when known, the employee
  // only enters Pieces; the size itself isn't re-typed every issue.
  const lastDims = material?.lastPieceDimensions ?? null;
  // Board Feet per single piece at the last recorded size - used to turn
  // the raw stock/rate figures into a pieces-based view (In Stock, Purchase
  // Rate) for anyone who thinks in "how many planks" rather than in CFT.
  const perPieceBF = lastDims ? (lastDims.thicknessIn * lastDims.widthIn * lastDims.lengthFt) / 12 : null;
  const issueBf = isBoardFeet
    ? lastDims
      ? boardFeetPreview(String(lastDims.thicknessIn), String(lastDims.widthIn), String(lastDims.lengthFt), issueForm.pieces)
      : boardFeetPreview(issueForm.thicknessIn, issueForm.widthIn, issueForm.lengthFt, issueForm.pieces)
    : null;

  function resetIssueForm() {
    setIssueForm({ date: new Date().toISOString().slice(0, 10), workItemId: '', quantity: '', thicknessIn: '', widthIn: '', lengthFt: '', pieces: '', reason: '' });
  }

  async function submitIssue(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/raw-materials/issue', {
        workItemId: issueForm.workItemId,
        date: issueForm.date,
        reason: issueForm.reason || undefined,
        items: [
          isBoardFeet
            ? {
                rawMaterialId: id,
                quantity: issueBf?.total ?? 0.01, // server recomputes/overrides this for BOARD_FEET materials anyway
                thicknessIn: lastDims ? lastDims.thicknessIn : parseFloat(issueForm.thicknessIn),
                widthIn: lastDims ? lastDims.widthIn : parseFloat(issueForm.widthIn),
                lengthFt: lastDims ? lastDims.lengthFt : parseFloat(issueForm.lengthFt),
                pieces: parseInt(issueForm.pieces, 10),
              }
            : { rawMaterialId: id, quantity: parseFloat(issueForm.quantity) },
        ],
      });
      resetIssueForm();
      mutate();
      mutateMovements();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record issue');
    }
  }

  async function submitAdjustment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/raw-materials/stock-adjustment', {
        rawMaterialId: id,
        date: adjustForm.date,
        quantity: parseFloat(adjustForm.quantity),
        reason: adjustForm.reason,
      });
      setAdjustForm({ date: new Date().toISOString().slice(0, 10), quantity: '', reason: '' });
      mutate();
      mutateMovements();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record adjustment');
    }
  }

  if (isLoading || !material) return <p className="text-brand-400 text-sm">Loading material...</p>;

  return (
    <div className="space-y-6">
      <div>
        <button
          className="text-sm text-brand-500 hover:underline mb-2"
          onClick={() => (window.history.length > 1 ? router.back() : router.push('/inventory'))}
        >
          &larr; All materials
        </button>
        <h1 className="text-2xl font-bold text-brand-900">{material.name}</h1>
        <p className="text-sm text-brand-500">
          {material.type ?? 'Uncategorized'} &middot; Unit: {material.unit}
        </p>
      </div>

      <div className={`grid grid-cols-1 sm:grid-cols-2 gap-4 ${canSeeCost ? 'lg:grid-cols-6' : 'lg:grid-cols-4'}`}>
        <StatCard
          label="In Stock"
          value={
            material.totalPurchasedPieces != null
              ? `${material.totalPurchasedPieces - (material.totalConsumedPieces ?? 0)} pcs`
              : String(material.inStock)
          }
          sub={
            material.totalPurchasedPieces != null
              ? `${material.inStock} ${material.unit}${material.hasUntrackedAdjustment ? ' · adjustments not counted in pcs' : ''}`
              : undefined
          }
        />
        <StatCard
          label="Purchased"
          value={material.totalPurchasedPieces != null ? `${material.totalPurchasedPieces} pcs` : String(material.totalPurchased)}
          sub={material.totalPurchasedPieces != null ? `${material.totalPurchased} ${material.unit}` : undefined}
        />
        <StatCard
          label="Consumed"
          value={material.totalConsumedPieces != null ? `${material.totalConsumedPieces} pcs` : String(material.totalConsumed)}
          sub={material.totalConsumedPieces != null ? `${material.totalConsumed} ${material.unit}` : undefined}
        />
        <StatCard label="Adjusted" value={String(material.totalAdjusted)} />
        {canSeeCost && (
          <>
            <StatCard
              label="Purchase Rate"
              value={perPieceBF ? `${formatCurrency(material.purchaseRate * perPieceBF)}/pc` : formatCurrency(material.purchaseRate)}
              sub={perPieceBF ? `${formatCurrency(material.purchaseRate)}/${material.unit}` : undefined}
            />
            <StatCard label="Stock Value" value={formatCurrency(material.stockValue)} />
          </>
        )}
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div className="card p-5">
        <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
          <h2 className="font-semibold text-brand-900">Movement History</h2>
          <button className="btn-secondary h-9 px-4 text-sm" onClick={downloadMaterialPdf} disabled={downloadingPdf}>
            {downloadingPdf ? 'Preparing...' : 'Download PDF'}
          </button>
        </div>
        <FilterBar
          fields={[
            { key: 'dateFrom', label: 'Date From', type: 'date' },
            { key: 'dateTo', label: 'Date To', type: 'date' },
            { key: 'type', label: 'Movement Type', type: 'select', options: MOVEMENT_TYPE_OPTIONS },
            { key: 'carpenterId', label: 'Employee', type: 'select', options: (carpenters ?? []).map((c) => ({ value: c.id, label: c.name })) },
            { key: 'workerType', label: 'Role', type: 'select', options: MOVEMENT_ROLE_OPTIONS },
          ]}
          values={movementValues}
          onChange={(key, value) => setMovementValues((v) => ({ ...v, [key]: value }))}
          onApply={applyMovementFilters}
          onReset={resetMovementFilters}
        />
        <div className="max-h-80 overflow-auto rounded-lg border border-brand-100 mt-3">
          <table className="table-shell">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Qty</th>
                <th>Length</th>
                <th>Width</th>
                <th>Amount</th>
                <th>Supplier / Employee</th>
                <th>Role</th>
                <th>Reason</th>
                <th>By</th>
              </tr>
            </thead>
            <tbody>
              {movements.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center text-brand-400 py-4">
                    No movements recorded
                  </td>
                </tr>
              )}
              {movements.map((m) => (
                <tr key={m.id}>
                  <td>{formatDate(m.date)}</td>
                  <td>
                    {m.type === 'IN' && <Chip color="green" label="Stock In" />}
                    {m.type === 'OUT' && <Chip color="amber" label="Issued" />}
                    {m.type === 'ADJUSTMENT' && <Chip color="blue" label="Adjustment" />}
                  </td>
                  <td className={m.quantity < 0 ? 'text-red-600' : 'text-emerald-600'}>
                    {m.pieces != null ? (
                      <>
                        {m.pieces} pcs <span className="text-brand-400">({m.quantity > 0 ? '+' : ''}{m.quantity} {material.unit})</span>
                      </>
                    ) : (
                      <>
                        {m.quantity > 0 ? '+' : ''}
                        {m.quantity}
                      </>
                    )}
                  </td>
                  <td className="text-brand-500">{m.lengthFt != null ? `${m.lengthFt} ft` : '-'}</td>
                  <td className="text-brand-500">{m.widthIn != null ? `${m.widthIn} in` : '-'}</td>
                  <td className="text-brand-500">{m.amount != null ? formatCurrency(m.amount) : '-'}</td>
                  <td className="text-brand-500">{m.purchase?.supplier?.name ?? m.workItem?.carpenter?.name ?? '-'}</td>
                  <td className="text-brand-500">{m.workItem?.carpenter?.workerType ?? '-'}</td>
                  <td className="text-brand-500">{m.reason ?? '-'}</td>
                  <td>{m.createdBy?.name ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {(canRecordPurchase || canIssue || canAdjust) && (
        <div className="grid lg:grid-cols-2 gap-6">
          {canRecordPurchase && (
            <div className="card p-5">
              <h2 className="font-semibold text-brand-900 mb-3">Record a Purchase</h2>
              <p className="text-xs text-brand-400 mb-3">
                Purchases are recorded from a Purchase Order - supplier, price, and this material&apos;s stock update together once
                it&apos;s received.
              </p>
              <button className="btn-primary w-full" onClick={() => router.push(`/purchase-orders?materialId=${id}`)}>
                Record a purchase for this material &rarr; Purchase Orders
              </button>
            </div>
          )}

          {canIssue && (
            <div className="card p-5">
              <h2 className="font-semibold text-brand-900 mb-3">Issue Material (to a Work Item)</h2>
              <p className="text-xs text-brand-400 mb-2">
                Attributes this material to whichever employee is assigned to the work item, so Super Admin can see how much each
                employee has used.
              </p>
              <form onSubmit={submitIssue} className="space-y-2">
                <select
                  className="input"
                  required
                  value={issueForm.workItemId}
                  onChange={(e) => setIssueForm((f) => ({ ...f, workItemId: e.target.value }))}
                >
                  <option value="">Select work item...</option>
                  {openWorkItems.map((w) => (
                    <option key={w.id} value={w.id}>
                      {w.productName}
                      {w.modelNo ? ` (${w.modelNo})` : ''} - {w.carpenter?.name ?? 'Unassigned'} - {w.status}
                    </option>
                  ))}
                </select>
                <input type="date" className="input" required value={issueForm.date} onChange={(e) => setIssueForm((f) => ({ ...f, date: e.target.value }))} />
                {isBoardFeet ? (
                  lastDims ? (
                    <>
                      <div className="flex items-center gap-2">
                        <input
                          type="number"
                          min="1"
                          className="input text-sm flex-1"
                          placeholder="Pieces used"
                          required
                          value={issueForm.pieces}
                          onChange={(e) => setIssueForm((f) => ({ ...f, pieces: e.target.value }))}
                        />
                        <span className="text-xs text-brand-400 whitespace-nowrap">
                          {lastDims.thicknessIn}&quot; &times; {lastDims.widthIn}&quot; &times; {lastDims.lengthFt}ft each
                        </span>
                      </div>
                      <div className="input text-xs bg-brand-50 text-brand-700 flex items-center justify-center">
                        {issueBf ? (
                          <span>{issueBf.perPiece} BF/pc &times; {issueForm.pieces} = <strong>{issueBf.total} BF</strong> ({issueBf.totalCft} CFT)</span>
                        ) : (
                          <span className="text-brand-400">Enter pieces used</span>
                        )}
                      </div>
                    </>
                  ) : (
                    <>
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <input type="number" step="0.01" className="input text-sm" placeholder="Thickness (in)" required value={issueForm.thicknessIn} onChange={(e) => setIssueForm((f) => ({ ...f, thicknessIn: e.target.value }))} />
                        <input type="number" step="0.01" className="input text-sm" placeholder="Width (in)" required value={issueForm.widthIn} onChange={(e) => setIssueForm((f) => ({ ...f, widthIn: e.target.value }))} />
                        <input type="number" step="0.01" className="input text-sm" placeholder="Length (ft)" required value={issueForm.lengthFt} onChange={(e) => setIssueForm((f) => ({ ...f, lengthFt: e.target.value }))} />
                        <input type="number" min="1" className="input text-sm" placeholder="Pieces" required value={issueForm.pieces} onChange={(e) => setIssueForm((f) => ({ ...f, pieces: e.target.value }))} />
                      </div>
                      <div className="input text-xs bg-brand-50 text-brand-700 flex items-center justify-center">
                        {issueBf ? (
                          <span>{issueBf.perPiece} BF/pc &times; {issueForm.pieces} = <strong>{issueBf.total} BF</strong> ({issueBf.totalCft} CFT)</span>
                        ) : (
                          <span className="text-brand-400">No recorded plank size yet - enter dimensions</span>
                        )}
                      </div>
                    </>
                  )
                ) : (
                  <input
                    type="number"
                    step="0.01"
                    className="input"
                    placeholder={`Quantity (${material.unit})`}
                    required
                    value={issueForm.quantity}
                    onChange={(e) => setIssueForm((f) => ({ ...f, quantity: e.target.value }))}
                  />
                )}
                <input className="input" placeholder="Reason / reference (optional)" value={issueForm.reason} onChange={(e) => setIssueForm((f) => ({ ...f, reason: e.target.value }))} />
                <button type="submit" className="btn-primary w-full">
                  Record Issue
                </button>
              </form>
            </div>
          )}

          {canAdjust && (
            <div className="card p-5">
              <h2 className="font-semibold text-brand-900 mb-3">Stock Adjustment</h2>
              <p className="text-xs text-brand-400 mb-2">Use a negative quantity for damage/wastage, positive for a found surplus.</p>
              <form onSubmit={submitAdjustment} className="space-y-2">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <input type="date" className="input" required value={adjustForm.date} onChange={(e) => setAdjustForm((f) => ({ ...f, date: e.target.value }))} />
                  <input type="number" step="0.01" className="input" placeholder="+/- quantity" required value={adjustForm.quantity} onChange={(e) => setAdjustForm((f) => ({ ...f, quantity: e.target.value }))} />
                </div>
                <input className="input" placeholder="Reason (required)" required value={adjustForm.reason} onChange={(e) => setAdjustForm((f) => ({ ...f, reason: e.target.value }))} />
                <button type="submit" className="btn-primary w-full">
                  Record Adjustment
                </button>
              </form>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
