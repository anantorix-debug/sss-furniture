'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatDate } from '@/lib/format';
import { RoleGate } from '@/components/RoleGate';
import { boardFeetPreview } from '@/lib/boardFeet';
import { Pagination, type PaginatedResult } from '@/components/Pagination';
import type { RawMaterial, StockMovement } from '@/types';

const todayStr = () => new Date().toISOString().slice(0, 10);

const emptyForm = {
  date: todayStr(),
  rawMaterialId: '',
  quantity: '',
  thicknessIn: '',
  widthIn: '',
  lengthFt: '',
  pieces: '',
  notes: '',
};

// Employee "Material Usage" - deliberately the ONLY thing this page does:
// what material, how much, when, optional notes. One submission = one
// record. No production job/stage/customer/work order selection - see
// RawMaterialsService.recordUsage on the backend.
function MaterialUsageContent() {
  const { user } = useAuth();
  const { data: materials, isLoading: materialsLoading } = useSWR<RawMaterial[]>('/raw-materials', fetcher);
  const [form, setForm] = useState(emptyForm);
  const [materialQuery, setMaterialQuery] = useState('');
  const [materialDropdownOpen, setMaterialDropdownOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [historyPage, setHistoryPage] = useState(1);

  const material = materials?.find((m) => m.id === form.rawMaterialId) ?? null;
  const isBoardFeet = material?.measurementKind === 'BOARD_FEET';
  const bf = isBoardFeet ? boardFeetPreview(form.thicknessIn, form.widthIn, form.lengthFt, form.pieces) : null;
  const filteredMaterials = (materials ?? []).filter((m) => m.name.toLowerCase().includes(materialQuery.toLowerCase()));

  const { data: todayResult, mutate: mutateToday } = useSWR<StockMovement[]>(
    user ? `/stock-movements?reference=USAGE&createdById=${user.id}&dateFrom=${todayStr()}&dateTo=${todayStr()}` : null,
    fetcher,
  );
  const { data: historyResult, mutate: mutateHistory } = useSWR<PaginatedResult<StockMovement>>(
    user ? `/stock-movements?reference=USAGE&createdById=${user.id}&page=${historyPage}&limit=15` : null,
    fetcher,
  );

  function selectMaterial(id: string) {
    const m = materials?.find((mm) => mm.id === id);
    const dims = m?.lastPieceDimensions;
    setForm((f) => ({
      ...f,
      rawMaterialId: id,
      quantity: '',
      thicknessIn: dims ? String(dims.thicknessIn) : '',
      widthIn: dims ? String(dims.widthIn) : '',
      lengthFt: dims ? String(dims.lengthFt) : '',
      pieces: '',
    }));
    setMaterialQuery(m?.name ?? '');
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(null);
    if (!material) {
      setError('Select a material.');
      return;
    }
    if (isBoardFeet ? !bf : !form.quantity) {
      setError(isBoardFeet ? 'Enter thickness, width, length and pieces.' : 'Enter the quantity used.');
      return;
    }
    setSubmitting(true);
    try {
      await api.post('/raw-materials/usage', {
        rawMaterialId: form.rawMaterialId,
        date: form.date,
        quantity: isBoardFeet ? (bf?.total ?? 0.01) : parseFloat(form.quantity),
        thicknessIn: isBoardFeet ? parseFloat(form.thicknessIn) : undefined,
        widthIn: isBoardFeet ? parseFloat(form.widthIn) : undefined,
        lengthFt: isBoardFeet ? parseFloat(form.lengthFt) : undefined,
        pieces: isBoardFeet ? parseInt(form.pieces, 10) : undefined,
        notes: form.notes || undefined,
      });
      setSuccess(`Recorded ${isBoardFeet ? bf?.total : form.quantity} ${material.unit} of ${material.name}.`);
      setForm({ ...emptyForm, date: form.date });
      setMaterialQuery('');
      mutateToday();
      mutateHistory();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to record usage');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="max-w-xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-900">Material Usage</h1>
        <p className="text-sm text-brand-500 mt-1">Record materials you actually used. One material per entry.</p>
      </div>

      <form onSubmit={submit} className="card p-5 space-y-4">
        <div>
          <label className="label">Date</label>
          <input
            type="date"
            className="input h-12 text-base"
            required
            value={form.date}
            onChange={(e) => setForm((f) => ({ ...f, date: e.target.value }))}
          />
        </div>

        <div className="relative">
          <label className="label">Material</label>
          <input
            className="input h-12 text-base"
            placeholder={materialsLoading ? 'Loading materials...' : 'Search or tap to see all materials...'}
            value={materialQuery}
            onFocus={() => setMaterialDropdownOpen(true)}
            onBlur={() => setTimeout(() => setMaterialDropdownOpen(false), 150)}
            onChange={(e) => {
              setMaterialQuery(e.target.value);
              setMaterialDropdownOpen(true);
              if (form.rawMaterialId) setForm((f) => ({ ...f, rawMaterialId: '' }));
            }}
          />
          {materialDropdownOpen && !form.rawMaterialId && (
            <div className="absolute z-10 mt-1 w-full max-h-56 overflow-y-auto card p-1 shadow-lg">
              {filteredMaterials.length === 0 && (
                <p className="px-3 py-2.5 text-sm text-brand-400">{materialsLoading ? 'Loading...' : 'No materials found'}</p>
              )}
              {filteredMaterials.map((m) => (
                <button
                  type="button"
                  key={m.id}
                  className="w-full text-left px-3 py-2.5 rounded-md hover:bg-brand-50 text-sm"
                  onClick={() => {
                    selectMaterial(m.id);
                    setMaterialDropdownOpen(false);
                  }}
                >
                  <span className="font-medium text-ink">{m.name}</span>
                  <span className="text-brand-400"> &middot; {m.inStock} {m.unit} available</span>
                </button>
              ))}
            </div>
          )}
        </div>

        {material && (
          <>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="label">Available Stock</label>
                <div className="input h-12 text-base bg-brand-50 text-brand-700 font-medium flex items-center">
                  {material.inStock} {material.unit}
                </div>
              </div>
              <div>
                <label className="label">Unit</label>
                <div className="input h-12 text-base bg-brand-50 text-brand-700 font-medium flex items-center">{material.unit}</div>
              </div>
            </div>

            {isBoardFeet ? (
              <div className="space-y-2">
                <label className="label">Quantity Used</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    step="0.01"
                    className="input h-12 text-base"
                    placeholder="Thickness (in)"
                    required
                    value={form.thicknessIn}
                    onChange={(e) => setForm((f) => ({ ...f, thicknessIn: e.target.value }))}
                  />
                  <input
                    type="number"
                    step="0.01"
                    className="input h-12 text-base"
                    placeholder="Width (in)"
                    required
                    value={form.widthIn}
                    onChange={(e) => setForm((f) => ({ ...f, widthIn: e.target.value }))}
                  />
                  <input
                    type="number"
                    step="0.01"
                    className="input h-12 text-base"
                    placeholder="Length (ft)"
                    required
                    value={form.lengthFt}
                    onChange={(e) => setForm((f) => ({ ...f, lengthFt: e.target.value }))}
                  />
                  <input
                    type="number"
                    min="1"
                    className="input h-12 text-base"
                    placeholder="Pieces"
                    required
                    value={form.pieces}
                    onChange={(e) => setForm((f) => ({ ...f, pieces: e.target.value }))}
                  />
                </div>
                <p className="text-xs text-brand-500">
                  {bf ? (
                    <>
                      {bf.perPiece} BF/pc &times; {form.pieces} = <strong>{bf.total} BF</strong> ({bf.totalCft} CFT)
                    </>
                  ) : (
                    'Enter thickness, width, length and pieces'
                  )}
                </p>
              </div>
            ) : (
              <div>
                <label className="label">Quantity Used</label>
                <input
                  type="number"
                  step="0.01"
                  min="0.01"
                  className="input h-12 text-base"
                  placeholder={`Quantity in ${material.unit}`}
                  required
                  value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: e.target.value }))}
                />
              </div>
            )}
          </>
        )}

        <div>
          <label className="label">Notes (optional)</label>
          <input
            className="input h-12 text-base"
            placeholder="What was it used for?"
            value={form.notes}
            onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
          />
        </div>

        {error && <p className="text-sm text-red-700 bg-red-50 border border-red-100 rounded-lg px-3 py-2.5">{error}</p>}
        {success && <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg px-3 py-2.5">{success}</p>}

        <button type="submit" disabled={submitting || !material} className="btn-primary w-full h-12 text-base">
          {submitting ? 'Recording...' : 'Record Usage'}
        </button>
      </form>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-brand-900">Today&apos;s Usage</h2>
        <div className="card overflow-x-auto">
          <table className="table-shell">
            <thead>
              <tr>
                <th>Material</th>
                <th>Quantity</th>
                <th>Time</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {!todayResult && (
                <tr>
                  <td colSpan={4} className="text-center py-6 text-brand-400">
                    Loading...
                  </td>
                </tr>
              )}
              {todayResult?.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center py-6 text-brand-400">
                    No usage recorded today yet
                  </td>
                </tr>
              )}
              {todayResult?.map((m) => (
                <tr key={m.id}>
                  <td>{m.rawMaterial?.name}</td>
                  <td>
                    {Math.abs(m.quantity)} {m.rawMaterial?.unit}
                  </td>
                  <td className="text-brand-500">{new Date(m.createdAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</td>
                  <td className="text-brand-500">{m.reason && m.reason !== 'Material usage' ? m.reason : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="space-y-2">
        <h2 className="text-sm font-semibold text-brand-900">Previous Usage</h2>
        <div className="card overflow-x-auto">
          <table className="table-shell">
            <thead>
              <tr>
                <th>Date</th>
                <th>Material</th>
                <th>Quantity</th>
                <th>Notes</th>
              </tr>
            </thead>
            <tbody>
              {!historyResult && (
                <tr>
                  <td colSpan={4} className="text-center py-6 text-brand-400">
                    Loading...
                  </td>
                </tr>
              )}
              {historyResult?.data.length === 0 && (
                <tr>
                  <td colSpan={4} className="text-center py-6 text-brand-400">
                    No usage history yet
                  </td>
                </tr>
              )}
              {historyResult?.data.map((m) => (
                <tr key={m.id}>
                  <td>{formatDate(m.date)}</td>
                  <td>{m.rawMaterial?.name}</td>
                  <td>
                    {Math.abs(m.quantity)} {m.rawMaterial?.unit}
                  </td>
                  <td className="text-brand-500">{m.reason && m.reason !== 'Material usage' ? m.reason : '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {historyResult && (
            <Pagination
              page={historyResult.page}
              totalPages={historyResult.totalPages}
              total={historyResult.total}
              limit={historyResult.limit}
              onPageChange={setHistoryPage}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function MaterialUsagePage() {
  return (
    <RoleGate minRole={['CARPENTER', 'CARVER', 'POLISHER']} exact>
      <MaterialUsageContent />
    </RoleGate>
  );
}
