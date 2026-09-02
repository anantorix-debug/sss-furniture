'use client';

import { useMemo, useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Chip, type ChipColor } from '@/components/StatusBadge';
import { Modal } from '@/components/Modal';
import { RoleGate } from '@/components/RoleGate';
import type { CarpenterWorkItem, QualityCheck, FinishedStockItem, DispatchRecord, QcResult } from '@/types';

// One page for the whole "cot is done, now what?" pipeline (steps 6-9 of
// the production workflow: Quality Check -> Finished Stock -> Dispatch ->
// Delivered) instead of four separate screens - every completed cot shows
// its progress as a row of dots and exactly one button for the next step,
// so nothing needs to be looked up or remembered.

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

function ProductionContent() {
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

  // Compute each completed cot's current pipeline stage from the three
  // downstream lists - this is the whole trick that keeps it to one page.
  const rows = useMemo(() => {
    if (!workItems) return [];
    return workItems.map((item) => {
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
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-900">Production Pipeline</h1>
        <p className="text-sm text-brand-500 mt-1">
          Every completed cot, one row each. The dots show progress; the button on the right is always the next thing to do.
        </p>
      </div>

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

export default function ProductionPage() {
  return (
    <RoleGate minRole="ADMIN">
      <ProductionContent />
    </RoleGate>
  );
}
