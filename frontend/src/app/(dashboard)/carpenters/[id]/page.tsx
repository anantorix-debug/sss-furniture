'use client';

import { useRef, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError, getAccessToken } from '@/lib/api';
import { lookupModelNo, sanitizeModelNo, type ModelNoLookup } from '@/lib/modelNoLookup';
import { ModelNoHint } from '@/components/ModelNoHint';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate, toDateInputValue } from '@/lib/format';
import { StatCard } from '@/components/StatCard';
import { Chip, type ChipColor } from '@/components/StatusBadge';
import { Modal } from '@/components/Modal';
import { RoleGate } from '@/components/RoleGate';
import { WhatsAppModal } from '@/components/WhatsAppModal';
import { WhatsAppActionButton } from '@/components/WhatsAppActionButton';
import { useWhatsApp } from '@/hooks/useWhatsApp';
import { useForceable } from '@/hooks/useForceable';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { ImportButton } from '@/components/ImportButton';
import { CARPENTER_PAYMENT_TYPE_LABEL, type CarpenterDetail, type CarpenterPaymentType, type ProductionStage, type StockMovement, type WorkStatus } from '@/types';

const emptyWork = {
  stage: 'CARPENTER' as ProductionStage,
  workDate: new Date().toISOString().slice(0, 10),
  modelNo: '',
  productName: '',
  category: '',
  size: '',
  price: '',
  extra: '0',
  quantity: '1',
};

const STAGE_LABEL: Record<ProductionStage, string> = { CARPENTER: 'Carpenter', CARVING: 'Carving', POLISH: 'Polish' };
const STAGE_CHIP: Record<ProductionStage, ChipColor> = { CARPENTER: 'blue', CARVING: 'amber', POLISH: 'darkGreen' };

const STATUS_LABEL: Record<WorkStatus, string> = {
  ASSIGNED: 'Assigned',
  IN_PROGRESS: 'In Progress',
  QUALITY_CHECK: 'Quality Check',
  REWORK: 'Rework',
  COMPLETED: 'Completed',
};

const STATUS_CHIP: Record<WorkStatus, ChipColor> = {
  ASSIGNED: 'gray',
  IN_PROGRESS: 'blue',
  QUALITY_CHECK: 'amber',
  REWORK: 'red',
  COMPLETED: 'green',
};



function CarpenterDetailContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasRole, user } = useAuth();
  const isSuperAdmin = user?.role === 'SUPERADMIN';
  const { forcePrompt, closeForcePrompt, runForceable } = useForceable();
  const { data: carpenter, isLoading, mutate } = useSWR<CarpenterDetail>(`/carpenters/${id}`, fetcher);
  const { data: materialsUsed } = useSWR<StockMovement[]>(`/stock-movements?type=OUT&carpenterId=${id}`, fetcher);
  // Actual cost of material this worker consumed today, regardless of which
  // order/project the work item belongs to - unitCost is the material's
  // purchase rate snapshotted at the moment it was issued (see
  // RawMaterialsService.issueToWorkItem), so this stays accurate even if
  // the material's rate changes later from a new purchase.
  const todayStr = new Date().toISOString().slice(0, 10);
  const materialCostToday = (materialsUsed ?? [])
    .filter((m) => m.date.slice(0, 10) === todayStr)
    .reduce((sum, m) => sum + Math.abs(m.quantity) * (m.unitCost ?? 0), 0);
  const {
    showModal,
    whatsappOptions,
    openWhatsApp,
    closeWhatsApp,
  } = useWhatsApp();

  const [workForm, setWorkForm] = useState(emptyWork);
  const [pdfMenuOpen, setPdfMenuOpen] = useState(false);
  const [workLookup, setWorkLookup] = useState<ModelNoLookup | null>(null);
  // What the last Model No lookup put into the form, so a new Model No can replace it.
  const autoFilled = useRef({ productName: '', category: '', size: '' });
  const latestWorkModelNo = useRef('');
  const [editLookup, setEditLookup] = useState<ModelNoLookup | null>(null);
  // Typing a Model No looks it up in inventory / production history and fills
  // the blank product details; anything already typed is kept. Nothing is saved.
  async function onWorkModelNo(raw: string) {
    const modelNo = sanitizeModelNo(raw);
    latestWorkModelNo.current = modelNo;
    setWorkForm((f) => ({ ...f, modelNo }));
    setWorkLookup(null);
    const res = await lookupModelNo(modelNo);
    if (latestWorkModelNo.current !== modelNo) return; // a newer Model No was typed meanwhile
    setWorkLookup(res);
    const a = res?.autofill ?? null;
    const next = { productName: a?.productName ?? '', category: a?.category ?? '', size: a?.size ?? '' };
    // A box is replaced when it's empty or still holds what the previous
    // Model No filled in; anything typed by hand is kept.
    const prev = autoFilled.current;
    autoFilled.current = next;
    setWorkForm((f) => {
      if (f.modelNo !== modelNo) return f;
      const pick = (key: keyof typeof next) => (!f[key] || f[key] === prev[key] ? next[key] : f[key]);
      return { ...f, productName: pick('productName'), category: pick('category'), size: pick('size') };
    });
  }
  async function onEditModelNo(raw: string) {
    const modelNo = sanitizeModelNo(raw);
    setEditForm((f) => ({ ...f, modelNo }));
    setEditLookup(null);
    const res = await lookupModelNo(modelNo);
    if (res && sanitizeModelNo(res.modelNo) === modelNo) setEditLookup(res);
  }
  const [paymentForm, setPaymentForm] = useState({ date: new Date().toISOString().slice(0, 10), amount: '', mode: 'CASH', note: '', paymentType: 'SALARY' as CarpenterPaymentType, reference: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canEdit = hasRole('ADMIN');
  // Work List is sorted by Model No. (numeric-aware, so 9 < 10 < 978);
  // clicking the header flips the direction. Rows without a Model No. stay
  // at the bottom either way.
  const [modelNoSort, setModelNoSort] = useState<'asc' | 'desc'>('asc');
  // On-screen filters for the two lists (nothing is re-fetched - the page
  // already has every row; these only narrow what is shown and summed).
  const emptyWorkFilter = { modelNo: '', q: '', stage: '', status: '', category: '', from: '', to: '' };
  const [workFilter, setWorkFilter] = useState(emptyWorkFilter);
  const emptyPayFilter = { q: '', type: '', mode: '', from: '', to: '' };
  const [payFilter, setPayFilter] = useState(emptyPayFilter);

  const [statusTarget, setStatusTarget] = useState<{ id: string; current: WorkStatus } | null>(null);
  const [statusForm, setStatusForm] = useState<{ status: WorkStatus; qcNote: string }>({ status: 'ASSIGNED', qcNote: '' });
  // Edits any Work List row in place (date, Model No., product, category,
  // size, qty, price, extra) - previously only the price could be changed,
  // and anything else meant deleting and re-adding the entry.
  type WorkEditForm = { workDate: string; modelNo: string; productName: string; category: string; size: string; quantity: string; price: string; extra: string };
  const [editTarget, setEditTarget] = useState<{ id: string; original: WorkEditForm } | null>(null);
  const [editForm, setEditForm] = useState<WorkEditForm>({ workDate: '', modelNo: '', productName: '', category: '', size: '', quantity: '1', price: '', extra: '0' });


  const total = (parseFloat(workForm.price || '0') + parseFloat(workForm.extra || '0')) * parseInt(workForm.quantity || '1', 10);

  // dateFrom/dateTo (optional) narrow the rows; the box buttons pass the
  // date range currently set in that box's filter, so a filtered view
  // prints the same period.
  const [pdfBusy, setPdfBusy] = useState<'WORK' | 'VOUCHER' | null>(null);
  async function downloadWorkerPdf(kind: 'WORK' | 'SALARY' | 'VOUCHER' | 'COMBINED', range: { from?: string; to?: string } = {}) {
    setError(null);
    try {
      const token = getAccessToken();
      const query = new URLSearchParams({ kind, ...(range.from ? { dateFrom: range.from } : {}), ...(range.to ? { dateTo: range.to } : {}) });
      const res = await fetch(`${API_BASE_URL}/carpenters/${id}/pdf?${query}`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        credentials: 'include',
      });
      if (!res.ok) throw new Error(`PDF failed (${res.status})`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${(carpenter?.name ?? 'worker').replace(/[^a-z0-9]+/gi, '-').toLowerCase()}-${kind === 'VOUCHER' ? 'payments' : kind === 'WORK' ? 'work-list' : kind.toLowerCase()}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to download PDF');
    }
  }

  async function addWork(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      await api.post('/carpenter-work-items', {
        carpenterId: id,
        stage: workForm.stage,
        workDate: workForm.workDate,
        modelNo: workForm.modelNo || undefined,
        productName: workForm.productName,
        category: workForm.category || undefined,
        size: workForm.size || undefined,
        price: parseFloat(workForm.price),
        extra: parseFloat(workForm.extra || '0'),
        quantity: parseInt(workForm.quantity, 10) || 1,
        total,
        directRecord: true,
      });
      setWorkForm(emptyWork);
      setWorkLookup(null);
      autoFilled.current = { productName: '', category: '', size: '' };
      mutate();
      setNotice('Old entry recorded.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add work item');
    }
  }

  async function removeWork(workId: string) {
    await runForceable(async (force) => {
      await api.delete(`/carpenter-work-items/${workId}${force ? '?force=true' : ''}`);
      mutate();
    }, hasRole('SUPERADMIN'));
  }

  async function resendNotify(workId: string) {
    setNotice(null);
    try {
      const res = await api.post<{ sent: boolean; reason?: string }>(`/carpenter-work-items/${workId}/notify`);
      setNotice(res.sent ? 'WhatsApp notification sent.' : `Not sent (${res.reason}).`);
    } catch (err) {
      setNotice(err instanceof ApiError ? err.message : 'Failed to send notification');
    }
  }

  function openStatusModal(workId: string, current: WorkStatus) {
    setStatusTarget({ id: workId, current });
    setStatusForm({ status: current, qcNote: '' });
  }

  async function submitStatus(e: React.FormEvent) {
    e.preventDefault();
    if (!statusTarget) return;
    setError(null);
    try {
      await api.patch(`/carpenter-work-items/${statusTarget.id}/status`, {
        status: statusForm.status,
        qcNote: statusForm.qcNote || undefined,
      });
      setStatusTarget(null);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update status');
    }
  }

  function openEditModal(w: CarpenterDetail['workItems'][number]) {
    const form = {
      workDate: toDateInputValue(w.workDate),
      modelNo: w.modelNo ?? '',
      productName: w.productName,
      category: w.category ?? '',
      size: w.size ?? '',
      quantity: String(w.quantity),
      price: w.price != null ? String(w.price) : '',
      extra: w.extra != null ? String(w.extra) : '0',
    };
    setEditTarget({ id: w.id, original: form });
    setEditForm(form);
    setError(null);
  }

  // PATCH /carpenter-work-items/:id with only the fields that actually
  // changed - the server recomputes Total from Price/Extra/Qty and writes
  // an audit-log entry with the before/after values.
  async function submitEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editTarget) return;
    setError(null);
    const o = editTarget.original;
    const f = editForm;
    const patch: Record<string, string | number> = {};
    if (f.workDate !== o.workDate) patch.workDate = f.workDate;
    if (f.modelNo.trim() !== o.modelNo) patch.modelNo = f.modelNo.trim();
    if (f.productName.trim() !== o.productName) patch.productName = f.productName.trim();
    if (f.category.trim() !== o.category) patch.category = f.category.trim();
    if (f.size.trim() !== o.size) patch.size = f.size.trim();
    if (f.quantity !== o.quantity) patch.quantity = parseInt(f.quantity, 10) || 1;
    if (f.price !== o.price) patch.price = parseFloat(f.price) || 0;
    if (f.extra !== o.extra) patch.extra = parseFloat(f.extra) || 0;
    if (Object.keys(patch).length === 0) {
      setEditTarget(null);
      return;
    }
    try {
      await api.patch(`/carpenter-work-items/${editTarget.id}`, patch);
      setEditTarget(null);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to update work entry');
    }
  }





  async function addPayment(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post(`/carpenters/${id}/payments`, {
        date: paymentForm.date,
        amount: parseFloat(paymentForm.amount),
        mode: paymentForm.mode,
        note: paymentForm.note || undefined,
        paymentType: paymentForm.paymentType,
        reference: paymentForm.reference || undefined,
      });
      setPaymentForm({ date: new Date().toISOString().slice(0, 10), amount: '', mode: 'CASH', note: '', paymentType: 'SALARY', reference: '' });
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add payment');
    }
  }

  // Edit an existing payment (same fields as the Record form). The server
  // refuses a change that would duplicate another payment.
  type PayEdit = { id: string; date: string; amount: string; mode: string; note: string; paymentType: CarpenterPaymentType; reference: string };
  const [payEdit, setPayEdit] = useState<PayEdit | null>(null);
  const [payEditError, setPayEditError] = useState<string | null>(null);
  const [payEditSaving, setPayEditSaving] = useState(false);
  async function submitPayEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!payEdit) return;
    setPayEditError(null);
    setPayEditSaving(true);
    try {
      await api.patch(`/carpenters/${id}/payments/${payEdit.id}`, {
        date: payEdit.date,
        amount: parseFloat(payEdit.amount),
        mode: payEdit.mode,
        note: payEdit.note,
        paymentType: payEdit.paymentType,
        reference: payEdit.reference,
      });
      setPayEdit(null);
      setNotice('Payment updated.');
      mutate();
    } catch (err) {
      setPayEditError(err instanceof ApiError ? err.message : 'Failed to update payment');
    } finally {
      setPayEditSaving(false);
    }
  }

  async function removePayment(paymentId: string) {
    await api.delete(`/carpenters/${id}/payments/${paymentId}`);
    mutate();
  }

  function handleSendWhatsApp() {
    if (!carpenter) return;
    openWhatsApp({
      recipientName: (carpenter.name ?? '') || 'Carpenter',
      recipientPhone: carpenter.phone ?? undefined,
      defaultMessage: `Hi ${carpenter.name}
Work assigned at SSS Company.
Total Balance: ₹${carpenter.balance}
Total Work Value: ₹${carpenter.totalWorkValue}
Please confirm receipt.`,
    });
  }

  if (isLoading || !carpenter) return <p className="text-brand-400 text-sm">Loading carpenter ledger...</p>;

  const norm = (v: string | null | undefined) => (v ?? '').trim().toUpperCase();
  const inDateRange = (d: string, from: string, to: string) => (!from || d.slice(0, 10) >= from) && (!to || d.slice(0, 10) <= to);
  const workCategories = [...new Set(carpenter.workItems.map((w) => norm(w.category)).filter(Boolean))].sort();
  const filteredWork = carpenter.workItems.filter((w) => {
    const f = workFilter;
    // Model No is an exact match: "1" finds Model 1, not 10 / 100 / 1000.
    if (f.modelNo.trim() && norm(w.modelNo) !== norm(f.modelNo)) return false;
    if (f.q.trim()) {
      const q = norm(f.q);
      if (![w.productName, w.category, w.size].some((v) => norm(v).includes(q))) return false;
    }
    if (f.stage && w.stage !== f.stage) return false;
    if (f.status && w.status !== f.status) return false;
    if (f.category && norm(w.category) !== f.category) return false;
    return inDateRange(w.workDate, f.from, f.to);
  });
  const workFilterOn = Object.values(workFilter).some(Boolean);
  const filteredWorkTotal = filteredWork.reduce((t, w) => t + Number(w.total ?? 0), 0);
  const payModes = [...new Set((carpenter.payments ?? []).map((p) => norm(p.mode)).filter(Boolean))].sort();
  const filteredPayments = (carpenter.payments ?? []).filter((p) => {
    const f = payFilter;
    if (f.q.trim() && !norm(p.reference).includes(norm(f.q)) && !norm(p.note).includes(norm(f.q))) return false;
    if (f.type && (p.paymentType ?? 'SALARY') !== f.type) return false;
    if (f.mode && norm(p.mode) !== f.mode) return false;
    return inDateRange(p.date, f.from, f.to);
  });
  const payFilterOn = Object.values(payFilter).some(Boolean);
  const filteredPaidTotal = filteredPayments.reduce((t, p) => t + Number(p.amount), 0);

  return (
    <div className="space-y-6">
      <div>
        <button className="text-sm text-brand-500 hover:underline mb-2" onClick={() => router.push('/carpenters')}>
          &larr; All carpenters
        </button>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="text-2xl font-bold text-brand-900">{carpenter.name}</h1>
              <span className="badge bg-brand-50 text-brand-700">{carpenter.workerType ?? 'CARPENTER'}</span>
            </div>
            {carpenter.phone && <p className="text-sm text-brand-500 mt-1">{carpenter.phone}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {canEdit && (
              <div className="relative">
                <button type="button" className="btn-secondary text-sm" onClick={() => setPdfMenuOpen((open) => !open)}>
                  Download PDF
                </button>
                {pdfMenuOpen && (
                  <div className="absolute right-0 z-20 mt-1 w-52 bg-white border border-brand-200 rounded-lg shadow-lg py-1">
                    {(
                      [
                        ['WORK', 'Work Statement'],
                        ['SALARY', 'Salary Ledger'],
                        ['VOUCHER', 'Payment Voucher'],
                        ['COMBINED', 'Combined Statement'],
                      ] as const
                    ).map(([kind, label]) => (
                      <button
                        key={kind}
                        type="button"
                        className="w-full text-left px-3 py-2 text-sm hover:bg-brand-50"
                        onClick={() => {
                          setPdfMenuOpen(false);
                          downloadWorkerPdf(kind);
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {carpenter.phone && (
              <WhatsAppActionButton
                recipientName={carpenter.name ?? 'Carpenter'}
                recipientPhone={carpenter.phone}
                onClick={handleSendWhatsApp}
                size="md"
              />
            )}
          </div>
        </div>
      </div>

      {canEdit && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard label="Total Work Value" value={formatCurrency(carpenter.totalWorkValue ?? 0)} />
          <StatCard label="Total Paid" value={formatCurrency(carpenter.totalPaid ?? 0)} accent="success" />
          <StatCard label="Balance Payable" value={formatCurrency(carpenter.balance ?? 0)} accent="warning" />
          <StatCard label="Material Cost Today" value={formatCurrency(materialCostToday)} />
        </div>
      )}

      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">{notice}</p>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
      <div className="space-y-6">
      <div className="card p-5">
        <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-brand-100">
          <h2 className="font-semibold text-brand-900">Work List</h2>
          <div className="flex flex-wrap items-center justify-end gap-2">
          {canEdit && (
            <button
              type="button"
              className="btn-secondary text-xs px-3 py-1.5"
              disabled={pdfBusy !== null}
              onClick={async () => {
                setPdfBusy('WORK');
                await downloadWorkerPdf('WORK', { from: workFilter.from, to: workFilter.to });
                setPdfBusy(null);
              }}
            >
              {pdfBusy === 'WORK' ? 'Preparing...' : 'Download Work List PDF'}
            </button>
          )}
          {isSuperAdmin && (
            <ImportButton
              kind="worker-work"
              scope={{ carpenterId: id }}
              label="Add Multiple / Upload PDF·Excel"
              className="btn-secondary text-xs px-3 py-1.5"
              onSaved={(res) => {
                setNotice(`${res.created} old entr${res.created === 1 ? 'y' : 'ies'} recorded (${formatCurrency(res.total)}).`);
                mutate();
              }}
            />
          )}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2 text-sm">
          <input className="input !py-1.5 text-sm" placeholder="Model No." value={workFilter.modelNo} onChange={(e) => setWorkFilter((f) => ({ ...f, modelNo: e.target.value }))} />
          <input className="input !py-1.5 text-sm" placeholder="Product / category / size" value={workFilter.q} onChange={(e) => setWorkFilter((f) => ({ ...f, q: e.target.value }))} />
          <select className="input !py-1.5 text-sm" value={workFilter.stage} onChange={(e) => setWorkFilter((f) => ({ ...f, stage: e.target.value }))} aria-label="Stage">
            <option value="">All stages</option>
            {(Object.keys(STAGE_LABEL) as ProductionStage[]).map((st) => (
              <option key={st} value={st}>
                {STAGE_LABEL[st]}
              </option>
            ))}
          </select>
          <select className="input !py-1.5 text-sm" value={workFilter.status} onChange={(e) => setWorkFilter((f) => ({ ...f, status: e.target.value }))} aria-label="Status">
            <option value="">All statuses</option>
            {(Object.keys(STATUS_LABEL) as WorkStatus[]).map((st) => (
              <option key={st} value={st}>
                {STATUS_LABEL[st]}
              </option>
            ))}
          </select>
          <select className="input !py-1.5 text-sm" value={workFilter.category} onChange={(e) => setWorkFilter((f) => ({ ...f, category: e.target.value }))} aria-label="Category">
            <option value="">All categories</option>
            {workCategories.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>
          <input type="date" className="input !py-1.5 text-sm" title="From date" value={workFilter.from} onChange={(e) => setWorkFilter((f) => ({ ...f, from: e.target.value }))} />
          <input type="date" className="input !py-1.5 text-sm" title="To date" value={workFilter.to} onChange={(e) => setWorkFilter((f) => ({ ...f, to: e.target.value }))} />
          <button type="button" className="btn-secondary text-xs" disabled={!workFilterOn} onClick={() => setWorkFilter(emptyWorkFilter)}>
            Clear filters
          </button>
        </div>
        <p className="text-xs text-ink-muted mb-2">
          {workFilterOn ? `Showing ${filteredWork.length} of ${carpenter.workItems.length}` : `${carpenter.workItems.length} entries`}
          {canEdit && (
            <>
              {' '}
              · Total <span className="font-semibold text-brand-900">{formatCurrency(filteredWorkTotal)}</span>
            </>
          )}
        </p>
        <div className="max-h-80 overflow-y-auto overflow-x-auto rounded-lg border border-brand-100 mb-4">
          <table className="table-shell">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Date</th>
                <th>
                  <button
                    type="button"
                    className="uppercase tracking-wide hover:text-brand-900"
                    onClick={() => setModelNoSort((s) => (s === 'asc' ? 'desc' : 'asc'))}
                    title="Sort by Model No."
                  >
                    Model No. {modelNoSort === 'asc' ? '▲' : '▼'}
                  </button>
                </th>
                <th>Product</th>
                <th>Size</th>
                <th>Qty</th>
                {canEdit && <th>Price</th>}
                {canEdit && <th>Extra</th>}
                {canEdit && <th>Total</th>}
                <th>Materials Used</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {carpenter.workItems.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 12 : 9} className="text-center text-brand-400 py-4">
                    No work items yet
                  </td>
                </tr>
              )}
              {workFilterOn && filteredWork.length === 0 && carpenter.workItems.length > 0 && (
                <tr>
                  <td colSpan={canEdit ? 12 : 9} className="text-center text-brand-400 py-4">
                    No work matches these filters
                  </td>
                </tr>
              )}
              {[...filteredWork]
                .sort((a, b) => {
                  if (!a.modelNo && !b.modelNo) return 0;
                  if (!a.modelNo) return 1;
                  if (!b.modelNo) return -1;
                  const cmp = a.modelNo.localeCompare(b.modelNo, undefined, { numeric: true, sensitivity: 'base' });
                  return modelNoSort === 'asc' ? cmp : -cmp;
                })
                .map((w) => (
                <tr key={w.id}>
                  <td>
                    <Chip color={STAGE_CHIP[w.stage]} label={STAGE_LABEL[w.stage]} />
                  </td>
                  <td>{formatDate(w.workDate)}</td>
                  <td>{w.modelNo ?? '-'}</td>
                  <td>
                    {w.productName}
                    {w.category && <div className="text-xs text-brand-400">{w.category}</div>}
                  </td>
                  <td>{w.size ?? '-'}</td>
                  <td>{w.quantity}</td>
                  {canEdit && <td>{formatCurrency(w.price ?? 0)}</td>}
                  {canEdit && <td>{formatCurrency(w.extra ?? 0)}</td>}
                  {canEdit && <td className="font-medium">{formatCurrency(w.total ?? 0)}</td>}
                  <td className="max-w-[220px]">
                    {!w.stockMovements || w.stockMovements.length === 0 ? (
                      <span className="text-brand-300 text-xs">None issued</span>
                    ) : (
                      <div className="flex flex-col gap-0.5">
                        {w.stockMovements.map((m) => (
                          <span key={m.id} className="text-xs text-brand-600">
                            {m.rawMaterial?.name}: {Math.abs(m.quantity)} {m.rawMaterial?.unit}
                          </span>
                        ))}
                      </div>
                    )}
                  </td>
                  <td>
                    <button onClick={() => openStatusModal(w.id, w.status)} className="cursor-pointer">
                      <Chip color={STATUS_CHIP[w.status]} label={STATUS_LABEL[w.status]} />
                    </button>
                  </td>
                  <td className="space-x-2">
                    <button className="text-brand-600 hover:underline text-xs" onClick={() => resendNotify(w.id)}>
                      Notify
                    </button>
                    {canEdit && (
                      <>
                        <button className="text-brand-600 hover:underline text-xs" onClick={() => openEditModal(w)}>
                          Edit
                        </button>
                        <button className="text-red-500 hover:text-red-700 text-xs" onClick={() => removeWork(w.id)}>
                          Remove
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {isSuperAdmin && (
        <form onSubmit={addWork} className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <select className="input" value={workForm.stage} onChange={(e) => setWorkForm((f) => ({ ...f, stage: e.target.value as ProductionStage }))}>
              <option value="CARPENTER">Carpenter</option>
              <option value="CARVING">Carving</option>
              <option value="POLISH">Polish</option>
            </select>
            <input type="date" className="input" required value={workForm.workDate} onChange={(e) => setWorkForm((f) => ({ ...f, workDate: e.target.value }))} />
            <div>
              <input className="input" placeholder="Model No." value={workForm.modelNo} onChange={(e) => onWorkModelNo(e.target.value)} />
              <ModelNoHint result={workLookup} />
            </div>
            <input className="input" placeholder="Product Name" required value={workForm.productName} onChange={(e) => setWorkForm((f) => ({ ...f, productName: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input className="input" placeholder="Category (BOTTOM COT / FULL BOX)" value={workForm.category} onChange={(e) => setWorkForm((f) => ({ ...f, category: e.target.value }))} />
            <input className="input" placeholder="Size" value={workForm.size} onChange={(e) => setWorkForm((f) => ({ ...f, size: e.target.value }))} />
            <input type="number" min="1" className="input" placeholder="Qty" value={workForm.quantity} onChange={(e) => setWorkForm((f) => ({ ...f, quantity: e.target.value }))} />
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-center">
            <input type="number" step="0.01" className="input" placeholder="Price" required value={workForm.price} onChange={(e) => setWorkForm((f) => ({ ...f, price: e.target.value }))} />
            <input type="number" step="0.01" className="input" placeholder="Extra" value={workForm.extra} onChange={(e) => setWorkForm((f) => ({ ...f, extra: e.target.value }))} />
            <div className="text-sm text-brand-600 font-medium">Total: {formatCurrency(total || 0)}</div>
          </div>
          <button type="submit" className="btn-primary w-full">
            Record Old Entry
          </button>
        </form>
        )}
      </div>

      <div className="card p-5">
        <h2 className="font-semibold text-brand-900 mb-3 pb-3 border-b border-brand-100">Materials Used</h2>
        <p className="text-xs text-brand-400 mb-3">Every material issued against this employee&apos;s work items, most recent first.</p>
        <div className="max-h-64 overflow-y-auto overflow-x-auto rounded-lg border border-brand-100">
          <table className="table-shell">
            <thead>
              <tr>
                <th>Date</th>
                <th>Material</th>
                <th>Qty</th>
                {canEdit && <th>Cost</th>}
                <th>Work Item</th>
                <th>Reason</th>
              </tr>
            </thead>
            <tbody>
              {(!materialsUsed || materialsUsed.length === 0) && (
                <tr>
                  <td colSpan={canEdit ? 6 : 5} className="text-center text-brand-400 py-4">
                    No materials issued yet
                  </td>
                </tr>
              )}
              {materialsUsed?.map((m) => (
                <tr key={m.id}>
                  <td>{formatDate(m.date)}</td>
                  <td className="font-medium">{m.rawMaterial?.name ?? '-'}</td>
                  <td className="text-red-600">
                    {m.quantity} {m.rawMaterial?.unit}
                  </td>
                  {canEdit && (
                    <td className="text-brand-700 font-medium">{m.unitCost != null ? formatCurrency(Math.abs(m.quantity) * m.unitCost) : '-'}</td>
                  )}
                  <td className="text-brand-500">{m.workItem?.productName ?? '-'}</td>
                  <td className="text-brand-500">{m.reason ?? '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      </div>
      <div className="space-y-6">
      <div className="card p-5">
        <div className="flex items-center justify-between gap-2 mb-3 pb-3 border-b border-brand-100">
          <h2 className="font-semibold text-brand-900">Payments</h2>
          <div className="flex flex-wrap items-center justify-end gap-2">
          {canEdit && (
            <button
              type="button"
              className="btn-secondary text-xs px-3 py-1.5"
              disabled={pdfBusy !== null}
              onClick={async () => {
                setPdfBusy('VOUCHER');
                await downloadWorkerPdf('VOUCHER', { from: payFilter.from, to: payFilter.to });
                setPdfBusy(null);
              }}
            >
              {pdfBusy === 'VOUCHER' ? 'Preparing...' : 'Download Payments PDF'}
            </button>
          )}
          {canEdit && (
            <ImportButton
              kind="worker-payments"
              scope={{ carpenterId: id }}
              label="Add Multiple / Upload PDF·Excel"
              className="btn-secondary text-xs px-3 py-1.5"
              onSaved={(res) => {
                setNotice(`${res.created} payment${res.created === 1 ? '' : 's'} recorded (${formatCurrency(res.total)}).`);
                mutate();
              }}
            />
          )}
          </div>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 mb-2 text-sm">
          <input className="input !py-1.5 text-sm" placeholder="Voucher No. / note" value={payFilter.q} onChange={(e) => setPayFilter((f) => ({ ...f, q: e.target.value }))} />
          <select className="input !py-1.5 text-sm" value={payFilter.type} onChange={(e) => setPayFilter((f) => ({ ...f, type: e.target.value }))} aria-label="Payment type">
            <option value="">All types</option>
            {(Object.keys(CARPENTER_PAYMENT_TYPE_LABEL) as CarpenterPaymentType[]).map((t) => (
              <option key={t} value={t}>
                {CARPENTER_PAYMENT_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          <select className="input !py-1.5 text-sm" value={payFilter.mode} onChange={(e) => setPayFilter((f) => ({ ...f, mode: e.target.value }))} aria-label="Mode">
            <option value="">All modes</option>
            {payModes.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <input type="date" className="input !py-1.5 text-sm" title="From date" value={payFilter.from} onChange={(e) => setPayFilter((f) => ({ ...f, from: e.target.value }))} />
          <input type="date" className="input !py-1.5 text-sm" title="To date" value={payFilter.to} onChange={(e) => setPayFilter((f) => ({ ...f, to: e.target.value }))} />
          <button type="button" className="btn-secondary text-xs" disabled={!payFilterOn} onClick={() => setPayFilter(emptyPayFilter)}>
            Clear filters
          </button>
        </div>
        <p className="text-xs text-ink-muted mb-2">
          {payFilterOn ? `Showing ${filteredPayments.length} of ${(carpenter.payments ?? []).length}` : `${(carpenter.payments ?? []).length} payments`} · Total{' '}
          <span className="font-semibold text-brand-900">{formatCurrency(filteredPaidTotal)}</span>
        </p>
        <div className="max-h-56 overflow-y-auto overflow-x-auto rounded-lg border border-brand-100 mb-4">
          <table className="table-shell">
            <thead>
              <tr>
                <th>Date</th>
                <th>Type</th>
                <th>Voucher No.</th>
                <th>Amount</th>
                <th>Mode</th>
                <th>Note</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {(carpenter.payments ?? []).length === 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-brand-400 py-4">
                    No payments recorded
                  </td>
                </tr>
              )}
              {payFilterOn && filteredPayments.length === 0 && (carpenter.payments ?? []).length > 0 && (
                <tr>
                  <td colSpan={7} className="text-center text-brand-400 py-4">
                    No payments match these filters
                  </td>
                </tr>
              )}
              {filteredPayments.map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.date)}</td>
                  <td>{CARPENTER_PAYMENT_TYPE_LABEL[(p.paymentType ?? 'SALARY') as CarpenterPaymentType] ?? '-'}</td>
                  <td>{p.reference ?? '-'}</td>
                  <td className="font-medium">{formatCurrency(p.amount)}</td>
                  <td>{p.mode ?? '-'}</td>
                  <td>{p.note ?? '-'}</td>
                  {canEdit && (
                    <td className="whitespace-nowrap">
                      <button
                        className="text-brand-700 hover:text-brand-900 text-xs mr-3"
                        onClick={() => {
                          setPayEditError(null);
                          setPayEdit({
                            id: p.id,
                            date: String(p.date).slice(0, 10),
                            amount: String(p.amount),
                            mode: p.mode ?? 'CASH',
                            note: p.note ?? '',
                            paymentType: (p.paymentType ?? 'SALARY') as CarpenterPaymentType,
                            reference: p.reference ?? '',
                          });
                        }}
                      >
                        Edit
                      </button>
                      <button className="text-red-500 hover:text-red-700 text-xs" onClick={() => removePayment(p.id)}>
                        Remove
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {canEdit && (
          <form onSubmit={addPayment} className="grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
            <input type="date" className="input" required value={paymentForm.date} onChange={(e) => setPaymentForm((f) => ({ ...f, date: e.target.value }))} />
            <select className="input" value={paymentForm.paymentType} onChange={(e) => setPaymentForm((f) => ({ ...f, paymentType: e.target.value as CarpenterPaymentType }))}>
              {(Object.keys(CARPENTER_PAYMENT_TYPE_LABEL) as CarpenterPaymentType[]).map((t) => (
                <option key={t} value={t}>
                  {CARPENTER_PAYMENT_TYPE_LABEL[t]}
                </option>
              ))}
            </select>
            <input className="input" placeholder="Voucher No. (e.g. SSS-250)" value={paymentForm.reference} onChange={(e) => setPaymentForm((f) => ({ ...f, reference: e.target.value }))} />
            <input type="number" step="0.01" className="input" placeholder="Amount" required value={paymentForm.amount} onChange={(e) => setPaymentForm((f) => ({ ...f, amount: e.target.value }))} />
            <select className="input" value={paymentForm.mode} onChange={(e) => setPaymentForm((f) => ({ ...f, mode: e.target.value }))}>
              <option>CASH</option>
              <option>GPAY</option>
              <option>UPI</option>
            </select>
            <button type="submit" className="btn-primary">
              Record
            </button>
          </form>
        )}
      </div>
      </div>
      </div>

      {payEdit && (
        <Modal title="Edit Payment" onClose={() => setPayEdit(null)}>
          <form onSubmit={submitPayEdit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Date</label>
                <input type="date" className="input" required value={payEdit.date} onChange={(e) => setPayEdit((f) => f && { ...f, date: e.target.value })} />
              </div>
              <div>
                <label className="label">Type</label>
                <select className="input" value={payEdit.paymentType} onChange={(e) => setPayEdit((f) => f && { ...f, paymentType: e.target.value as CarpenterPaymentType })}>
                  {(Object.keys(CARPENTER_PAYMENT_TYPE_LABEL) as CarpenterPaymentType[]).map((t) => (
                    <option key={t} value={t}>
                      {CARPENTER_PAYMENT_TYPE_LABEL[t]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Voucher No.</label>
                <input className="input" value={payEdit.reference} onChange={(e) => setPayEdit((f) => f && { ...f, reference: e.target.value })} />
              </div>
              <div>
                <label className="label">Amount</label>
                <input type="number" step="0.01" min="0.01" className="input" required value={payEdit.amount} onChange={(e) => setPayEdit((f) => f && { ...f, amount: e.target.value })} />
              </div>
              <div>
                <label className="label">Mode</label>
                <select className="input" value={payEdit.mode} onChange={(e) => setPayEdit((f) => f && { ...f, mode: e.target.value })}>
                  <option>CASH</option>
                  <option>GPAY</option>
                  <option>UPI</option>
                </select>
              </div>
              <div>
                <label className="label">Note</label>
                <input className="input" value={payEdit.note} onChange={(e) => setPayEdit((f) => f && { ...f, note: e.target.value })} />
              </div>
            </div>
            {payEditError && <p className="text-sm text-red-600">{payEditError}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" className="btn-secondary" onClick={() => setPayEdit(null)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary" disabled={payEditSaving}>
                {payEditSaving ? 'Saving...' : 'Save Payment'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {forcePrompt && (
        <ConfirmDialog
          title="Force This Through?"
          message={`${forcePrompt.message}\n\nAs Super Admin you can force this through anyway - this permanently removes the connected material-usage/quality-check history rather than just losing the link to it. This cannot be undone.`}
          confirmLabel="Force Through Anyway"
          danger
          onConfirm={forcePrompt.onForce}
          onCancel={closeForcePrompt}
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

      {statusTarget && (
        <Modal title="Update Production Status" onClose={() => setStatusTarget(null)}>
          <form onSubmit={submitStatus} className="space-y-3">
            <div>
              <label className="label">Status</label>
              <select className="input" value={statusForm.status} onChange={(e) => setStatusForm((f) => ({ ...f, status: e.target.value as WorkStatus }))}>
                {(Object.keys(STATUS_LABEL) as WorkStatus[]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </div>
            {(statusForm.status === 'QUALITY_CHECK' || statusForm.status === 'REWORK') && (
              <div>
                <label className="label">Note</label>
                <textarea className="input" rows={3} value={statusForm.qcNote} onChange={(e) => setStatusForm((f) => ({ ...f, qcNote: e.target.value }))} placeholder="What needs to be checked / reworked" />
              </div>
            )}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setStatusTarget(null)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Update Status
              </button>
            </div>
          </form>
        </Modal>
      )}

      {editTarget && (
        <Modal title={`Edit Work Entry - ${editTarget.original.productName}`} onClose={() => setEditTarget(null)}>
          <form onSubmit={submitEdit} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Date</label>
                <input type="date" className="input" required value={editForm.workDate} onChange={(e) => setEditForm((f) => ({ ...f, workDate: e.target.value }))} />
              </div>
              <div>
                <label className="label">Model No.</label>
                <input className="input" value={editForm.modelNo} onChange={(e) => onEditModelNo(e.target.value)} />
                <ModelNoHint result={editLookup} />
              </div>
              <div>
                <label className="label">Product Name</label>
                <input className="input" required value={editForm.productName} onChange={(e) => setEditForm((f) => ({ ...f, productName: e.target.value }))} />
              </div>
              <div>
                <label className="label">Category</label>
                <input className="input" value={editForm.category} onChange={(e) => setEditForm((f) => ({ ...f, category: e.target.value }))} />
              </div>
              <div>
                <label className="label">Size</label>
                <input className="input" value={editForm.size} onChange={(e) => setEditForm((f) => ({ ...f, size: e.target.value }))} />
              </div>
              <div>
                <label className="label">Qty</label>
                <input type="number" min="1" className="input" required value={editForm.quantity} onChange={(e) => setEditForm((f) => ({ ...f, quantity: e.target.value }))} />
              </div>
              <div>
                <label className="label">Price (₹ per unit)</label>
                <input type="number" step="0.01" min="0" className="input" required value={editForm.price} onChange={(e) => setEditForm((f) => ({ ...f, price: e.target.value }))} />
              </div>
              <div>
                <label className="label">Extra (₹)</label>
                <input type="number" step="0.01" min="0" className="input" value={editForm.extra} onChange={(e) => setEditForm((f) => ({ ...f, extra: e.target.value }))} />
              </div>
            </div>
            <p className="text-sm font-medium text-brand-900">
              Total: {formatCurrency(((parseFloat(editForm.price) || 0) + (parseFloat(editForm.extra) || 0)) * (parseInt(editForm.quantity, 10) || 1))}
            </p>
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setEditTarget(null)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Save
              </button>
            </div>
          </form>
        </Modal>
      )}

    </div>
  );
}

export default function CarpenterDetailPage() {
  return (
    <RoleGate minRole={['ADMIN', 'CARPENTER', 'CARVER', 'POLISHER']}>
      <CarpenterDetailContent />
    </RoleGate>
  );
}
