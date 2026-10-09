'use client';

import { useRef, useState } from 'react';
import { api, ApiError, uploadSheetForPreview } from '@/lib/api';
import { downloadCsv } from '@/lib/csv';
import { formatCurrency } from '@/lib/format';

// "Upload / Add Multiple" window, shared by every page (backed by the
// server's /imports/:kind endpoints). Two ways to fill the grid, both ending
// in the same review step:
//   1. "+ Add Row" and type entries by hand, or
//   2. upload a PDF / Excel / CSV sheet - the server reads it (saving
//      nothing) and the rows land here for checking first.
// Duplicates are checked three times: on upload, again for every row
// (typed or uploaded) when Save is pressed, and finally by the server
// while saving - a row that's already recorded, or repeats another row in
// the list, is only saved after the user explicitly confirms "Save anyway".

export type GridRow = Record<string, string>;

export interface BulkColumn {
  key: string;
  label: string; // also the column heading in the downloadable template
  type: 'date' | 'text' | 'number' | 'select';
  options?: { value: string; label: string }[];
  required?: boolean;
  width?: string; // tailwind min-width class for the cell
}

type Duplicate = 'existing' | 'batch' | null;

interface PreviewResponse {
  fileName: string;
  rows: { line: number; values: GridRow; warnings: string[]; duplicate: Duplicate }[];
  sheetGrandTotal: number | null;
  parsedTotal: number;
  duplicateCount: number;
}

interface CommitResponse {
  created: number;
  failed: number;
  total: number;
  results: { ok: boolean; error?: string }[];
}

interface Row {
  id: number;
  data: GridRow;
  include: boolean;
  warnings: string[];
  duplicate: Duplicate;
  confirmed: boolean; // user chose "Save anyway" for this duplicate
  fromFile: boolean; // came from an upload - its problems show straight away
  error?: string; // why the last save refused this row
}

const DUPLICATE_LABEL: Record<'existing' | 'batch', string> = {
  existing: 'Already recorded',
  batch: 'Repeated in this list',
};

export function BulkImportModal({
  title,
  kind,
  scope,
  columns,
  emptyRow,
  rowTotal,
  switches,
  hint,
  templateFileName,
  onClose,
  onSaved,
}: {
  title: string;
  kind: string;
  scope?: Record<string, string>;
  columns: BulkColumn[];
  emptyRow: () => GridRow;
  rowTotal?: (row: GridRow) => number;
  // Optional tick-boxes sent with the save, e.g. Purchasing's
  // { key: 'directRecord', label: 'Already received (adds stock)' }.
  switches?: { key: string; label: string }[];
  hint?: string;
  templateFileName: string;
  onClose: () => void;
  // Called after every save that stored at least one row, so the page can
  // refresh its list - even if some other rows still need fixing.
  onSaved: (result: { created: number; total: number }) => void;
}) {
  const nextId = useRef(1);
  const makeRow = (data: GridRow, extra?: Partial<Row>): Row => ({ id: nextId.current++, data, include: true, warnings: [], duplicate: null, confirmed: false, fromFile: false, ...extra });

  const [rows, setRows] = useState<Row[]>(() => [makeRow(emptyRow())]);
  const [fileInfo, setFileInfo] = useState<{ name: string; sheetGrandTotal: number | null; parsedTotal: number; duplicateCount: number } | null>(null);
  const [switchValues, setSwitchValues] = useState<Record<string, boolean>>({});
  const [reading, setReading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmCount, setConfirmCount] = useState<number | null>(null);
  // A blank row typed by hand only shows "required" problems once Save
  // has been pressed - not the moment it appears.
  const [attempted, setAttempted] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const query = scope && Object.keys(scope).length ? `?${new URLSearchParams(scope)}` : '';

  // Editing a row clears what the last check/save said about it - it gets
  // checked again on the next Save.
  function update(id: number, key: string, value: string) {
    setRows((rs) => rs.map((r) => (r.id === id ? { ...r, data: { ...r.data, [key]: value }, duplicate: null, confirmed: false, error: undefined } : r)));
    setConfirmCount(null);
  }
  const setRow = (id: number, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.id === id ? { ...r, ...patch } : r)));

  function isBlank(r: GridRow) {
    const blank = emptyRow();
    return columns.every((c) => (r[c.key] ?? '') === (blank[c.key] ?? ''));
  }

  async function handleFile(file: File) {
    setError(null);
    setNotice(null);
    setConfirmCount(null);
    setReading(true);
    try {
      const res = await uploadSheetForPreview<PreviewResponse>(`/imports/${kind}/preview${query}`, file);
      const imported = res.rows.map((p) => makeRow(p.values, { include: !p.duplicate, warnings: p.warnings, duplicate: p.duplicate, fromFile: true }));
      // Keep anything already typed by hand; drop the untouched blank row.
      setRows((rs) => [...rs.filter((r) => !isBlank(r.data)), ...imported]);
      setFileInfo({ name: res.fileName, sheetGrandTotal: res.sheetGrandTotal, parsedTotal: res.parsedTotal, duplicateCount: res.duplicateCount });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not read the file');
    } finally {
      setReading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  // Quick checks before anything is sent; the server re-validates every
  // row against the page's own rules anyway.
  function rowProblems(r: GridRow): string[] {
    const problems: string[] = [];
    for (const c of columns) {
      const v = (r[c.key] ?? '').trim();
      if (c.required && !v) problems.push(`${c.label} is required`);
      if (c.type === 'number' && v && (!Number.isFinite(Number(v)) || Number(v) < 0)) problems.push(`${c.label} must be a number`);
      if (c.type === 'date' && v && !/^\d{4}-\d{2}-\d{2}$/.test(v)) problems.push(`${c.label} is not a valid date`);
    }
    return problems;
  }

  const included = rows.filter((r) => r.include);
  const invalid = included.filter((r) => rowProblems(r.data).length > 0);
  const total = rowTotal ? included.reduce((s, r) => s + rowTotal(r.data), 0) : 0;

  async function save(confirmAll = false) {
    setAttempted(true);
    setError(null);
    setNotice(null);
    if (included.length === 0) return setError('Tick at least one row to save.');
    if (invalid.length > 0) return setError(`Fix the ${invalid.length} highlighted row${invalid.length === 1 ? '' : 's'} first (or untick them).`);

    setSaving(true);
    try {
      // 1. Duplicate check for every ticked row - typed rows included.
      const items = included.map((r) => r.data);
      const { duplicates } = await api.post<{ duplicates: Duplicate[] }>(`/imports/${kind}/check${query}`, { items });
      const checked = included.map((r, i) => ({ ...r, duplicate: duplicates[i], confirmed: r.confirmed || (confirmAll && !!duplicates[i]) }));
      setRows((rs) => rs.map((r) => checked.find((c) => c.id === r.id) ?? r));
      const unconfirmed = checked.filter((r) => r.duplicate && !r.confirmed);
      if (unconfirmed.length > 0) {
        setConfirmCount(unconfirmed.length);
        return;
      }
      setConfirmCount(null);

      // 2. Save. The server repeats the duplicate check and only lets the
      // confirmed ones through.
      const res = await api.post<CommitResponse>(`/imports/${kind}/commit${query}`, {
        items,
        confirmDuplicates: checked.map((r, i) => (r.duplicate && r.confirmed ? i : -1)).filter((i) => i >= 0),
        options: switchValues,
        sourceFileName: fileInfo?.name,
      });
      const savedIds = new Set(checked.filter((_, i) => res.results[i]?.ok).map((r) => r.id));
      const errors = new Map(checked.map((r, i) => [r.id, res.results[i]?.ok ? undefined : res.results[i]?.error]));
      setRows((rs) => rs.filter((r) => !savedIds.has(r.id)).map((r) => (errors.has(r.id) ? { ...r, error: errors.get(r.id) } : r)));
      if (res.created > 0) onSaved({ created: res.created, total: res.total });
      if (res.failed === 0) {
        onClose();
        return;
      }
      setNotice(`${res.created} saved. ${res.failed} not saved - the reason is shown on each remaining row.`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save');
    } finally {
      setSaving(false);
    }
  }

  function skipDuplicates() {
    setRows((rs) => rs.map((r) => (r.include && r.duplicate && !r.confirmed ? { ...r, include: false } : r)));
    setConfirmCount(null);
  }

  function downloadTemplate() {
    const sample = rows.find((r) => !isBlank(r.data))?.data ?? emptyRow();
    // Dropdown columns show their label (shop / supplier name), which is
    // what the upload matches on - not the internal id.
    const cell = (c: BulkColumn) => (c.type === 'select' ? (c.options?.find((o) => o.value === sample[c.key])?.label ?? '') : (sample[c.key] ?? ''));
    downloadCsv(templateFileName, [Object.fromEntries(columns.map((c) => [c.label.toUpperCase(), cell(c)]))]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-2 sm:px-4">
      <div className="card w-full max-w-6xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-100">
          <h2 className="font-semibold text-brand-900">{title}</h2>
          <button onClick={onClose} className="text-brand-400 hover:text-brand-700 text-xl leading-none" aria-label="Close">
            &times;
          </button>
        </div>

        <div className="px-5 py-3 border-b border-brand-100 flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            accept=".pdf,.xlsx,.csv,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            className="hidden"
            onChange={(e) => e.target.files?.[0] && handleFile(e.target.files[0])}
          />
          <button type="button" className="btn-primary text-sm" disabled={reading} onClick={() => fileInputRef.current?.click()}>
            {reading ? 'Reading file...' : 'Upload PDF / Excel'}
          </button>
          <button type="button" className="btn-secondary text-sm" onClick={() => setRows((rs) => [...rs, makeRow(emptyRow())])}>
            + Add Row
          </button>
          <button type="button" className="btn-secondary text-sm" onClick={downloadTemplate}>
            Download Template
          </button>
          <span className="text-xs text-ink-muted">{hint ?? 'PDF, Excel (.xlsx) or CSV with a header row.'} Nothing is saved until you press Save.</span>
        </div>

        {fileInfo && (
          <div className="px-5 py-2 text-xs border-b border-brand-100 bg-brand-50 flex flex-wrap gap-x-4 gap-y-1">
            <span>
              Read <span className="font-medium">{fileInfo.name}</span>
            </span>
            {fileInfo.sheetGrandTotal != null && rowTotal && (
              <span className={Math.abs(fileInfo.sheetGrandTotal - fileInfo.parsedTotal) < 0.5 ? 'text-emerald-700' : 'text-amber-700'}>
                Sheet total {formatCurrency(fileInfo.sheetGrandTotal)} · rows add up to {formatCurrency(fileInfo.parsedTotal)}
                {Math.abs(fileInfo.sheetGrandTotal - fileInfo.parsedTotal) < 0.5 ? ' ✓' : ' - check the rows'}
              </span>
            )}
            {fileInfo.duplicateCount > 0 && <span className="text-amber-700">{fileInfo.duplicateCount} already recorded or repeated - unticked</span>}
          </div>
        )}

        <div className="flex-1 overflow-auto">
          <table className="table-shell">
            <thead className="sticky top-0 z-10">
              <tr>
                <th className="w-8">
                  <input
                    type="checkbox"
                    aria-label="Select all rows"
                    checked={rows.length > 0 && rows.every((r) => r.include)}
                    onChange={(e) => setRows((rs) => rs.map((r) => ({ ...r, include: e.target.checked })))}
                  />
                </th>
                {columns.map((c) => (
                  <th key={c.key}>
                    {c.label}
                    {c.required && <span className="text-red-500"> *</span>}
                  </th>
                ))}
                {rowTotal && <th>Total</th>}
                <th></th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const problems = r.include && (attempted || r.fromFile) ? rowProblems(r.data) : [];
                const tone = problems.length || r.error ? 'bg-red-50' : r.duplicate && r.include ? 'bg-amber-50' : '';
                return (
                  <tr key={r.id} className={`${!r.include ? 'opacity-50' : ''} ${tone}`}>
                    <td className="align-top pt-3">
                      <input type="checkbox" aria-label="Include row" checked={r.include} onChange={(e) => setRow(r.id, { include: e.target.checked })} />
                    </td>
                    {columns.map((c) => (
                      <td key={c.key} className={`align-top ${c.width ?? 'min-w-[110px]'}`}>
                        {c.type === 'select' ? (
                          <select className="input !py-1 text-sm" value={r.data[c.key] ?? ''} onChange={(e) => update(r.id, c.key, e.target.value)}>
                            {!c.options?.some((o) => o.value === '') && <option value="">- Select -</option>}
                            {c.options?.map((o) => (
                              <option key={o.value} value={o.value}>
                                {o.label}
                              </option>
                            ))}
                          </select>
                        ) : (
                          <input
                            className="input !py-1 text-sm"
                            type={c.type === 'number' ? 'number' : c.type === 'date' ? 'date' : 'text'}
                            step={c.type === 'number' ? 'any' : undefined}
                            min={c.type === 'number' ? 0 : undefined}
                            value={r.data[c.key] ?? ''}
                            onChange={(e) => update(r.id, c.key, e.target.value)}
                          />
                        )}
                      </td>
                    ))}
                    {rowTotal && <td className="align-top font-medium whitespace-nowrap pt-3">{formatCurrency(rowTotal(r.data))}</td>}
                    <td className="align-top whitespace-nowrap pt-3">
                      <button type="button" className="text-red-500 hover:text-red-700 text-xs" onClick={() => setRows((rs) => rs.filter((x) => x.id !== r.id))}>
                        Remove
                      </button>
                    </td>
                    <td className="align-top min-w-[220px] text-[11px] leading-snug pt-2">
                      {r.duplicate && (
                        <div className="text-amber-700 font-medium">
                          {DUPLICATE_LABEL[r.duplicate]}
                          {r.confirmed && ' - will be saved anyway'}
                        </div>
                      )}
                      {r.error && <div className="text-red-600 font-medium">Not saved: {r.error}</div>}
                      {problems.map((p) => (
                        <div key={p} className="text-red-600">
                          {p}
                        </div>
                      ))}
                      {r.warnings.map((w) => (
                        <div key={w} className="text-amber-700">
                          {w}
                        </div>
                      ))}
                    </td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr>
                  <td colSpan={columns.length + 4} className="text-center text-brand-400 py-6">
                    No rows - upload a file or add a row.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {confirmCount != null && (
          <div className="px-5 py-3 border-t border-amber-200 bg-amber-50 flex flex-wrap items-center justify-between gap-2 text-sm">
            <span className="text-amber-800">
              {confirmCount} ticked row{confirmCount === 1 ? ' looks' : 's look'} already recorded or repeated (highlighted). Save {confirmCount === 1 ? 'it' : 'them'} anyway?
            </span>
            <div className="flex gap-2">
              <button type="button" className="btn-secondary text-sm" onClick={skipDuplicates} disabled={saving}>
                Skip {confirmCount === 1 ? 'it' : 'them'}
              </button>
              <button type="button" className="btn-primary text-sm" onClick={() => save(true)} disabled={saving}>
                Save anyway
              </button>
            </div>
          </div>
        )}

        <div className="px-5 py-3 border-t border-brand-100 flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm space-y-1">
            <div>
              <span className="font-medium">{included.length}</span> of {rows.length} rows selected
              {rowTotal && (
                <>
                  {' '}
                  · Total <span className="font-semibold text-brand-900">{formatCurrency(total)}</span>
                </>
              )}
            </div>
            {switches?.map((s) => (
              <label key={s.key} className="flex items-center gap-2 text-xs text-ink-muted">
                <input type="checkbox" checked={!!switchValues[s.key]} onChange={(e) => setSwitchValues((v) => ({ ...v, [s.key]: e.target.checked }))} />
                {s.label}
              </label>
            ))}
            {notice && <p className="text-amber-700 text-sm">{notice}</p>}
            {error && <p className="text-red-600 text-sm">{error}</p>}
          </div>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary" onClick={onClose} disabled={saving}>
              Close
            </button>
            <button type="button" className="btn-primary" onClick={() => save()} disabled={saving || included.length === 0}>
              {saving ? 'Saving...' : `Save ${included.length} Row${included.length === 1 ? '' : 's'}`}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
