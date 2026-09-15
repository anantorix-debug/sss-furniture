'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError, assetUrl } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { Chip, type ChipColor } from '@/components/StatusBadge';
import { RoleGate } from '@/components/RoleGate';
import type { CarpenterWorkItem, Product } from '@/types';

const STATUS_CHIP: Record<string, ChipColor> = {
  ASSIGNED: 'gray',
  IN_PROGRESS: 'blue',
  QUALITY_CHECK: 'amber',
  REWORK: 'red',
  COMPLETED: 'green',
};

// A multi-unit Stock Production batch can't take one shared Model No while
// it's still a single work item (one Model No = one physical piece) - the
// individual pieces only exist after Admin verifies the batch (see
// Production Control > Ready for Verification). Once they do, this lets
// whoever worked the batch assign each piece's Model No right here,
// without needing Stock Management access.
function BatchPieceRow({ product, onChanged }: { product: Product; onChanged: () => void }) {
  const [modelNo, setModelNo] = useState(product.modelNo ?? '');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function save() {
    if (!modelNo.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.patch(`/products/${product.id}/model-no`, { modelNo: modelNo.trim() });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-1">
      <div className="grid grid-cols-[1fr_auto] gap-2 items-center">
        <input className="input text-sm" placeholder="Enter Model No" value={modelNo} onChange={(e) => setModelNo(e.target.value)} />
        <button className="btn-secondary text-xs shrink-0" disabled={saving || !modelNo.trim() || modelNo.trim() === product.modelNo} onClick={save}>
          {saving ? 'Saving...' : 'Save'}
        </button>
      </div>
      {error && <p className="text-xs text-red-600">{error}</p>}
    </div>
  );
}

function BatchProducedPieces({ batchId }: { batchId: string }) {
  const { data: pieces, isLoading, mutate } = useSWR<Product[]>(`/products?sourceBatchId=${batchId}`, fetcher);

  if (isLoading) return null;
  if (!pieces || pieces.length === 0) {
    return <p className="text-xs text-brand-400">Not verified into stock yet - Model Nos can be set here once Admin verifies this batch.</p>;
  }
  return (
    <div className="space-y-2 border-t border-brand-100 pt-2">
      <p className="text-xs font-medium text-brand-500">Assign Model No to each piece ({pieces.length})</p>
      {pieces.map((p) => (
        <BatchPieceRow key={p.id} product={p} onChanged={mutate} />
      ))}
    </div>
  );
}

function WorkCard({ item, onChanged }: { item: CarpenterWorkItem; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [remarks, setRemarks] = useState('');
  const [modelNo, setModelNo] = useState(item.modelNo ?? '');
  const [savingModelNo, setSavingModelNo] = useState(false);

  async function saveModelNo() {
    if (!modelNo.trim()) return;
    setSavingModelNo(true);
    setError(null);
    try {
      await api.patch(`/carpenter-work-items/${item.id}/model-no`, { modelNo: modelNo.trim() });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save Model No');
    } finally {
      setSavingModelNo(false);
    }
  }

  async function setStatus(status: string) {
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/carpenter-work-items/${item.id}/status`, { status, qcNote: remarks || undefined });
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update status');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card p-4 space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-2 min-w-0">
          {item.referenceImage && (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={assetUrl(item.referenceImage.url) ?? ''}
              alt={item.referenceImage.fileName}
              className="h-14 w-14 object-cover rounded-md border border-brand-200 shrink-0"
            />
          )}
          <div className="min-w-0">
            <p className="font-semibold text-brand-900">{item.productName}</p>
            <p className="text-xs text-brand-500">
              {item.modelNo ? `Model ${item.modelNo}` : 'Model No not set'} · Qty {item.quantity}
              {item.size ? ` · ${item.size}${item.sizeUnit ? ` ${item.sizeUnit}` : ''}` : ''}
            </p>
            <p className="text-xs text-brand-400 mt-0.5">{formatDate(item.workDate)}</p>
          </div>
        </div>
        <Chip color={STATUS_CHIP[item.status] ?? 'gray'} label={item.status.replace('_', ' ')} />
      </div>

      {item.stage === 'POLISH' && (
        <p className={`text-xs rounded-lg px-2 py-1.5 font-medium ${item.color ? 'text-brand-700 bg-brand-50' : 'text-red-600 bg-red-50'}`}>
          {item.color ? `Colour: ${item.color}` : 'Colour not set yet - check with Admin before starting.'}
        </p>
      )}

      {item.notes && <p className="text-xs text-brand-500 bg-brand-50 rounded-lg px-2 py-1.5">Note: {item.notes}</p>}

      {item.stage !== 'POLISH' && (
        <div className="flex gap-2 items-center">
          <input
            className="input text-sm flex-1"
            placeholder="Enter Model No"
            value={modelNo}
            onChange={(e) => setModelNo(e.target.value)}
          />
          <button
            className="btn-secondary text-xs shrink-0"
            disabled={savingModelNo || !modelNo.trim() || modelNo.trim() === item.modelNo}
            onClick={saveModelNo}
          >
            {savingModelNo ? 'Saving...' : 'Save Model No'}
          </button>
        </div>
      )}

      {error && <p className="text-xs text-red-600">{error}</p>}

      <div className="flex flex-wrap gap-2">
        {item.status === 'ASSIGNED' && (
          <button className="btn-primary text-xs" disabled={busy} onClick={() => setStatus('IN_PROGRESS')}>
            Start
          </button>
        )}
        {item.status === 'IN_PROGRESS' && (
          <button className="btn-primary text-xs" disabled={busy} onClick={() => setStatus('COMPLETED')}>
            Finish
          </button>
        )}
        {(item.status === 'QUALITY_CHECK' || item.status === 'COMPLETED') && (
          <span className="text-xs text-emerald-600">{item.status === 'QUALITY_CHECK' ? 'Sent for verification' : 'Done ✓'}</span>
        )}
      </div>

      {item.status === 'IN_PROGRESS' && (
        <input
          className="input text-sm"
          placeholder="Notes for this stage (optional)"
          value={remarks}
          onChange={(e) => setRemarks(e.target.value)}
        />
      )}

      {item.source === 'STOCK' && item.quantity > 1 && item.batchId && item.status === 'COMPLETED' && (
        <BatchProducedPieces batchId={item.batchId} />
      )}

    </div>
  );
}

function MyWorkContent() {
  const { data: me, isLoading: meLoading } = useSWR<{ id: string; name: string } | null>('/carpenters/me', fetcher);
  const { data: workItems, isLoading: workLoading, mutate } = useSWR<CarpenterWorkItem[]>(
    me ? `/carpenter-work-items?carpenterId=${me.id}` : null,
    fetcher,
  );

  const active = (workItems ?? []).filter((w) => w.status === 'ASSIGNED' || w.status === 'IN_PROGRESS');
  const recent = (workItems ?? []).filter((w) => w.status === 'QUALITY_CHECK' || w.status === 'COMPLETED').slice(0, 10);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-900">My Work</h1>
        <p className="text-sm text-brand-500 mt-1">Your assigned production jobs - start and finish. Record material usage from the Material Usage page.</p>
      </div>

      {meLoading && <p className="text-brand-400 text-sm">Loading...</p>}

      {!meLoading && !me && (
        <div className="card p-5 text-sm text-brand-600">
          Your login isn&apos;t linked to a worker profile yet. Ask your Admin to link your account from the Production page so your
          assigned jobs show up here.
        </div>
      )}

      {me && (
        <>
          <section>
            <h2 className="text-sm font-semibold text-brand-700 uppercase tracking-wide mb-3">Active Work ({active.length})</h2>
            {workLoading && <p className="text-brand-400 text-sm">Loading...</p>}
            {!workLoading && active.length === 0 && <p className="text-brand-400 text-sm">Nothing assigned to you right now.</p>}
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {active.map((item) => (
                <WorkCard key={item.id} item={item} onChanged={mutate} />
              ))}
            </div>
          </section>

          {recent.length > 0 && (
            <section>
              <h2 className="text-sm font-semibold text-brand-700 uppercase tracking-wide mb-3">Recently Finished</h2>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                {recent.map((item) => (
                  <WorkCard key={item.id} item={item} onChanged={mutate} />
                ))}
              </div>
            </section>
          )}
        </>
      )}
    </div>
  );
}

export default function MyWorkPage() {
  return (
    <RoleGate minRole={['CARPENTER', 'CARVER', 'POLISHER']} exact>
      <MyWorkContent />
    </RoleGate>
  );
}
