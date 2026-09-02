'use client';

import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { formatCurrency, formatDate } from '@/lib/format';
import { StatCard } from '@/components/StatCard';
import { Chip, type ChipColor } from '@/components/StatusBadge';
import { Modal } from '@/components/Modal';
import { RoleGate } from '@/components/RoleGate';
import { WhatsAppModal } from '@/components/WhatsAppModal';
import { WhatsAppActionButton } from '@/components/WhatsAppActionButton';
import { useWhatsApp } from '@/hooks/useWhatsApp';
import type { CarpenterDetail, ProductionStage, RawMaterial, WorkStatus } from '@/types';

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
  notifyWhatsapp: true,
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

interface IssueRow {
  rawMaterialId: string;
  quantity: string;
}

function CarpenterDetailContent() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { hasRole } = useAuth();
  const { data: carpenter, isLoading, mutate } = useSWR<CarpenterDetail>(`/carpenters/${id}`, fetcher);
  const { data: materials } = useSWR<RawMaterial[]>('/raw-materials', fetcher);
  const {
    canUseWhatsApp,
    showModal,
    whatsappOptions,
    openWhatsApp,
    closeWhatsApp,
  } = useWhatsApp();

  const [workForm, setWorkForm] = useState(emptyWork);
  const [paymentForm, setPaymentForm] = useState({ date: new Date().toISOString().slice(0, 10), amount: '', mode: 'CASH', note: '' });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const canEdit = hasRole('ADMIN');

  const [statusTarget, setStatusTarget] = useState<{ id: string; current: WorkStatus } | null>(null);
  const [statusForm, setStatusForm] = useState<{ status: WorkStatus; qcNote: string }>({ status: 'ASSIGNED', qcNote: '' });

  const [issueTarget, setIssueTarget] = useState<{ id: string; productName: string } | null>(null);
  const [issueRows, setIssueRows] = useState<IssueRow[]>([{ rawMaterialId: '', quantity: '' }]);
  const [issueDate, setIssueDate] = useState(new Date().toISOString().slice(0, 10));

  const total = (parseFloat(workForm.price || '0') + parseFloat(workForm.extra || '0')) * parseInt(workForm.quantity || '1', 10);

  async function addWork(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    try {
      const created = await api.post<{ whatsapp?: { sent: boolean; reason?: string } }>('/carpenter-work-items', {
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
        notifyWhatsapp: workForm.notifyWhatsapp,
      });
      setWorkForm(emptyWork);
      mutate();
      if (workForm.notifyWhatsapp) {
        setNotice(
          created.whatsapp?.sent
            ? 'Work assigned and WhatsApp notification sent.'
            : `Work assigned. WhatsApp notification not sent (${created.whatsapp?.reason ?? 'no phone on file'}).`,
        );
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add work item');
    }
  }

  async function removeWork(workId: string) {
    await api.delete(`/carpenter-work-items/${workId}`);
    mutate();
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

  function openIssueModal(workId: string, productName: string) {
    setIssueTarget({ id: workId, productName });
    setIssueRows([{ rawMaterialId: '', quantity: '' }]);
    setIssueDate(new Date().toISOString().slice(0, 10));
  }

  function updateIssueRow(idx: number, patch: Partial<IssueRow>) {
    setIssueRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }

  async function submitIssue(e: React.FormEvent) {
    e.preventDefault();
    if (!issueTarget) return;
    setError(null);
    try {
      await api.post('/raw-materials/issue', {
        workItemId: issueTarget.id,
        date: issueDate,
        items: issueRows.filter((r) => r.rawMaterialId && r.quantity).map((r) => ({ rawMaterialId: r.rawMaterialId, quantity: parseFloat(r.quantity) })),
      });
      setIssueTarget(null);
      setNotice(`Materials issued to ${issueTarget.productName}.`);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to issue material');
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
      });
      setPaymentForm({ date: new Date().toISOString().slice(0, 10), amount: '', mode: 'CASH', note: '' });
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to add payment');
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

  return (
    <div className="space-y-6">
      <div>
        <button className="text-sm text-brand-500 hover:underline mb-2" onClick={() => router.push('/carpenters')}>
          &larr; All carpenters
        </button>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold text-brand-900">{carpenter.name}</h1>
            {carpenter.phone && <p className="text-sm text-brand-500">{carpenter.phone}</p>}
          </div>
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

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatCard label="Total Work Value" value={formatCurrency(carpenter.totalWorkValue ?? 0)} />
        <StatCard label="Total Paid" value={formatCurrency(carpenter.totalPaid ?? 0)} accent="success" />
        <StatCard label="Balance Payable" value={formatCurrency(carpenter.balance ?? 0)} accent="warning" />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}
      {notice && <p className="text-sm text-brand-700 bg-brand-50 border border-brand-100 rounded-lg px-3 py-2">{notice}</p>}

      <div className="card p-5">
        <h2 className="font-semibold text-brand-900 mb-3">Work List</h2>
        <div className="max-h-80 overflow-y-auto rounded-lg border border-brand-100 mb-4">
          <table className="table-shell">
            <thead>
              <tr>
                <th>Stage</th>
                <th>Date</th>
                <th>Model No.</th>
                <th>Product</th>
                <th>Size</th>
                <th>Qty</th>
                <th>Total</th>
                <th>Materials Used</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {carpenter.workItems.length === 0 && (
                <tr>
                  <td colSpan={10} className="text-center text-brand-400 py-4">
                    No work items yet
                  </td>
                </tr>
              )}
              {carpenter.workItems.map((w) => (
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
                  <td className="font-medium">{formatCurrency(w.total ?? 0)}</td>
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
                    <button className="text-brand-600 hover:underline text-xs" onClick={() => openIssueModal(w.id, w.productName)}>
                      Issue Material
                    </button>
                    <button className="text-brand-600 hover:underline text-xs" onClick={() => resendNotify(w.id)}>
                      Notify
                    </button>
                    {canEdit && (
                      <button className="text-red-500 hover:text-red-700 text-xs" onClick={() => removeWork(w.id)}>
                        Remove
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <form onSubmit={addWork} className="space-y-2">
          <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
            <select className="input" value={workForm.stage} onChange={(e) => setWorkForm((f) => ({ ...f, stage: e.target.value as ProductionStage }))}>
              <option value="CARPENTER">Carpenter</option>
              <option value="CARVING">Carving</option>
              <option value="POLISH">Polish</option>
            </select>
            <input type="date" className="input" required value={workForm.workDate} onChange={(e) => setWorkForm((f) => ({ ...f, workDate: e.target.value }))} />
            <input className="input" placeholder="Model No." value={workForm.modelNo} onChange={(e) => setWorkForm((f) => ({ ...f, modelNo: e.target.value }))} />
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
          <label className="flex items-center gap-2 text-sm text-brand-600">
            <input type="checkbox" checked={workForm.notifyWhatsapp} onChange={(e) => setWorkForm((f) => ({ ...f, notifyWhatsapp: e.target.checked }))} />
            Notify carpenter on WhatsApp when assigned
          </label>
          <button type="submit" className="btn-primary w-full">
            Assign Work
          </button>
        </form>
      </div>

      <div className="card p-5">
        <h2 className="font-semibold text-brand-900 mb-3">Payments</h2>
        <div className="max-h-56 overflow-y-auto rounded-lg border border-brand-100 mb-4">
          <table className="table-shell">
            <thead>
              <tr>
                <th>Date</th>
                <th>Amount</th>
                <th>Mode</th>
                <th>Note</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {(carpenter.payments ?? []).length === 0 && (
                <tr>
                  <td colSpan={5} className="text-center text-brand-400 py-4">
                    No payments recorded
                  </td>
                </tr>
              )}
              {(carpenter.payments ?? []).map((p) => (
                <tr key={p.id}>
                  <td>{formatDate(p.date)}</td>
                  <td className="font-medium">{formatCurrency(p.amount)}</td>
                  <td>{p.mode ?? '-'}</td>
                  <td>{p.note ?? '-'}</td>
                  {canEdit && (
                    <td>
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
          <form onSubmit={addPayment} className="grid grid-cols-2 sm:grid-cols-4 gap-2 items-end">
            <input type="date" className="input" required value={paymentForm.date} onChange={(e) => setPaymentForm((f) => ({ ...f, date: e.target.value }))} />
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

      {issueTarget && (
        <Modal title={`Issue Material - ${issueTarget.productName}`} onClose={() => setIssueTarget(null)} wide>
          <form onSubmit={submitIssue} className="space-y-3">
            <div>
              <label className="label">Date</label>
              <input type="date" className="input" required value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
            </div>
            <div className="space-y-2">
              {issueRows.map((row, idx) => (
                <div key={idx} className="grid grid-cols-1 sm:grid-cols-[1fr_120px_auto] gap-2 sm:items-center">
                  <select className="input" required value={row.rawMaterialId} onChange={(e) => updateIssueRow(idx, { rawMaterialId: e.target.value })}>
                    <option value="">Select material</option>
                    {materials?.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.name} ({m.inStock} {m.unit} available)
                      </option>
                    ))}
                  </select>
                  <input type="number" step="0.01" className="input" placeholder="Qty" required value={row.quantity} onChange={(e) => updateIssueRow(idx, { quantity: e.target.value })} />
                  <button
                    type="button"
                    className="text-red-500 text-xs"
                    onClick={() => setIssueRows((rows) => rows.filter((_, i) => i !== idx))}
                    disabled={issueRows.length === 1}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
            <button type="button" className="text-brand-600 text-xs hover:underline" onClick={() => setIssueRows((rows) => [...rows, { rawMaterialId: '', quantity: '' }])}>
              + Add material line
            </button>

            {error && <p className="text-sm text-red-600">{error}</p>}

            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setIssueTarget(null)}>
                Cancel
              </button>
              <button type="submit" className="btn-primary">
                Issue Material
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
    <RoleGate minRole="ADMIN">
      <CarpenterDetailContent />
    </RoleGate>
  );
}
