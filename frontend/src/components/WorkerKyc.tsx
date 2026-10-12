'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { formatDate } from '@/lib/format';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import {
  DOC_KIND_LABEL,
  formatFileSize,
  kycFormFrom,
  kycPayload,
  maskAadhaar,
  maskAccount,
  maskPan,
  openWorkerDocument,
  uploadWorkerDocument,
  validateKycForm,
  validateWorkerDocFile,
  WORKER_DOC_ACCEPT,
  type KycForm,
  type WorkerDocument,
  type WorkerDocumentKind,
  type WorkerKyc,
} from '@/lib/workerKyc';

const KINDS: WorkerDocumentKind[] = ['AADHAAR', 'PAN', 'BANK'];

// Aadhaar / PAN / bank account inputs - used by the New/Edit Worker form
// and the worker page's Worker Information box.
export function KycFields({ value, onChange }: { value: KycForm; onChange: (next: KycForm) => void }) {
  const set = (key: keyof KycForm) => (e: React.ChangeEvent<HTMLInputElement>) => onChange({ ...value, [key]: e.target.value });
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Aadhaar Number</label>
          <input className="input" inputMode="numeric" autoComplete="off" placeholder="1234 5678 9012" maxLength={14} value={value.aadhaarNumber} onChange={set('aadhaarNumber')} />
        </div>
        <div>
          <label className="label">PAN Number</label>
          <input className="input uppercase" autoComplete="off" placeholder="ABCDE1234F" maxLength={10} value={value.panNumber} onChange={set('panNumber')} />
        </div>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="label">Account Holder Name</label>
          <input className="input" autoComplete="off" value={value.bankAccountHolder} onChange={set('bankAccountHolder')} />
        </div>
        <div>
          <label className="label">Bank Account Number</label>
          <input className="input" inputMode="numeric" autoComplete="off" maxLength={20} value={value.bankAccountNumber} onChange={set('bankAccountNumber')} />
        </div>
        <div>
          <label className="label">IFSC Code</label>
          <input className="input uppercase" autoComplete="off" placeholder="SBIN0001234" maxLength={11} value={value.bankIfsc} onChange={set('bankIfsc')} />
        </div>
        <div>
          <label className="label">Bank Name</label>
          <input className="input" autoComplete="off" value={value.bankName} onChange={set('bankName')} />
        </div>
        <div className="sm:col-span-2">
          <label className="label">Branch</label>
          <input className="input" autoComplete="off" value={value.bankBranch} onChange={set('bankBranch')} />
        </div>
      </div>
    </div>
  );
}

// Uploaded ID / bank proof files, grouped by type, with upload (PDF or
// image, max 5 MB), view and remove.
export function WorkerDocuments({ carpenterId, documents, onChanged }: { carpenterId: string; documents: WorkerDocument[]; onChanged: () => void }) {
  const [busyKind, setBusyKind] = useState<WorkerDocumentKind | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [removeTarget, setRemoveTarget] = useState<WorkerDocument | null>(null);

  async function upload(kind: WorkerDocumentKind, files: FileList | null) {
    if (!files?.length) return;
    setError(null);
    const list = Array.from(files);
    const bad = list.map(validateWorkerDocFile).find(Boolean);
    if (bad) {
      setError(bad);
      return;
    }
    setBusyKind(kind);
    try {
      for (const f of list) await uploadWorkerDocument(carpenterId, kind, f);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to upload the file');
      onChanged();
    } finally {
      setBusyKind(null);
    }
  }

  async function view(doc: WorkerDocument) {
    setError(null);
    try {
      await openWorkerDocument(carpenterId, doc);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Could not open the document');
    }
  }

  return (
    <div className="space-y-3">
      {KINDS.map((kind) => {
        const docs = documents.filter((d) => d.kind === kind);
        return (
          <div key={kind} className="border border-brand-100 rounded-lg p-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-brand-900">{DOC_KIND_LABEL[kind]}</span>
              <label className={`btn-secondary text-xs px-3 py-1.5 cursor-pointer ${busyKind ? 'opacity-60 pointer-events-none' : ''}`}>
                {busyKind === kind ? 'Uploading...' : '+ Upload'}
                <input
                  type="file"
                  className="hidden"
                  accept={WORKER_DOC_ACCEPT}
                  multiple
                  data-kind={kind}
                  onChange={(e) => {
                    upload(kind, e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
            </div>
            {docs.length === 0 ? (
              <p className="text-xs text-brand-400 mt-1">Not uploaded</p>
            ) : (
              <ul className="mt-2 space-y-1">
                {docs.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2 text-xs">
                    <span className="truncate" title={d.fileName}>
                      {d.fileName} <span className="text-brand-400">· {formatFileSize(d.size)} · {formatDate(d.createdAt)}</span>
                    </span>
                    <span className="whitespace-nowrap">
                      <button type="button" className="text-brand-700 hover:underline mr-3" onClick={() => view(d)}>
                        View
                      </button>
                      <button type="button" className="text-red-500 hover:underline" onClick={() => setRemoveTarget(d)}>
                        Remove
                      </button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        );
      })}
      <p className="text-[11px] text-brand-400">PDF, JPG, PNG or WEBP - up to 5 MB each.</p>
      {error && <p className="text-xs text-red-600">{error}</p>}

      {removeTarget && (
        <ConfirmDialog
          title="Remove Document"
          message={`Remove "${removeTarget.fileName}" (${DOC_KIND_LABEL[removeTarget.kind]})? The file is deleted permanently.`}
          confirmLabel="Remove"
          danger
          onConfirm={async () => {
            const target = removeTarget;
            setRemoveTarget(null);
            try {
              await api.delete(`/carpenters/${carpenterId}/documents/${target.id}`);
            } catch (err) {
              setError(err instanceof ApiError ? err.message : 'Failed to remove the document');
            }
            onChanged();
          }}
          onCancel={() => setRemoveTarget(null)}
        />
      )}
    </div>
  );
}

// "Worker Information" box on the worker page (Admin and above): ID and
// bank details shown masked until "Show" is pressed, an Edit form, and
// the uploaded documents.
export function WorkerKycPanel({ carpenterId }: { carpenterId: string }) {
  const { data: kyc, mutate, error: loadError } = useSWR<WorkerKyc>(`/carpenters/${carpenterId}/kyc`, fetcher);
  const [reveal, setReveal] = useState(false);
  const [editing, setEditing] = useState(false);
  const [form, setForm] = useState<KycForm>(kycFormFrom(null));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    const invalid = validateKycForm(form);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    setSaving(true);
    try {
      await api.put(`/carpenters/${carpenterId}/kyc`, kycPayload(form));
      await mutate();
      setEditing(false);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save details');
    } finally {
      setSaving(false);
    }
  }

  const row = (label: string, full: string | null, masked: string | null) => (
    <div className="flex justify-between gap-3 py-1.5 border-b border-brand-50 text-sm">
      <span className="text-brand-500">{label}</span>
      <span className="font-medium text-ink text-right break-all">{full ? (reveal ? full : masked ?? full) : <span className="text-brand-300 font-normal">Not added</span>}</span>
    </div>
  );

  return (
    <div className="card p-5">
      <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-brand-100">
        <h2 className="font-semibold text-brand-900 whitespace-nowrap">Worker Information</h2>
        {kyc && !editing && (
          <div className="flex gap-2">
            <button type="button" className="btn-secondary text-xs px-3 py-1.5" onClick={() => setReveal((r) => !r)}>
              {reveal ? 'Hide numbers' : 'Show numbers'}
            </button>
            <button
              type="button"
              className="btn-secondary text-xs px-3 py-1.5"
              onClick={() => {
                setForm(kycFormFrom(kyc));
                setError(null);
                setEditing(true);
              }}
            >
              Edit
            </button>
          </div>
        )}
      </div>
      {loadError && <p className="text-sm text-red-600">Could not load worker information.</p>}
      {!kyc && !loadError && <p className="text-sm text-brand-400">Loading...</p>}
      {kyc && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-500 mb-2">ID &amp; Bank Details</h3>
            {editing ? (
              <form onSubmit={save} className="space-y-3">
                <KycFields value={form} onChange={setForm} />
                {error && <p className="text-sm text-red-600">{error}</p>}
                <div className="flex justify-end gap-2">
                  <button type="button" className="btn-secondary" onClick={() => setEditing(false)}>
                    Cancel
                  </button>
                  <button type="submit" className="btn-primary" disabled={saving}>
                    {saving ? 'Saving...' : 'Save Details'}
                  </button>
                </div>
              </form>
            ) : (
              <div>
                {row('Aadhaar', kyc.aadhaarNumber ? kyc.aadhaarNumber.replace(/(\d{4})(?=\d)/g, '$1 ') : null, maskAadhaar(kyc.aadhaarNumber))}
                {row('PAN', kyc.panNumber, maskPan(kyc.panNumber))}
                {row('Account Holder', kyc.bankAccountHolder, kyc.bankAccountHolder)}
                {row('Account Number', kyc.bankAccountNumber, maskAccount(kyc.bankAccountNumber))}
                {row('IFSC', kyc.bankIfsc, kyc.bankIfsc)}
                {row('Bank', kyc.bankName, kyc.bankName)}
                {row('Branch', kyc.bankBranch, kyc.bankBranch)}
              </div>
            )}
          </div>
          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wide text-brand-500 mb-2">Documents</h3>
            <WorkerDocuments carpenterId={carpenterId} documents={kyc.documents} onChanged={() => mutate()} />
          </div>
        </div>
      )}
    </div>
  );
}
