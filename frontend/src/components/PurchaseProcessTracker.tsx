'use client';

import type { Purchase } from '@/types';

type StepStatus = 'complete' | 'active' | 'pending' | 'failed';

interface Step {
  key: string;
  label: string;
  status: StepStatus;
}

function StepNode({ step }: { step: Step }) {
  const circleClass =
    step.status === 'complete'
      ? 'bg-emerald-600 text-white'
      : step.status === 'active'
        ? 'bg-accent text-white animate-step-glow'
        : step.status === 'failed'
          ? 'bg-red-600 text-white'
          : 'bg-brand-100 text-brand-400';
  return (
    <div className="flex flex-col items-center gap-2 relative z-10 flex-1">
      <div
        className={`h-9 w-9 shrink-0 rounded-full flex items-center justify-center text-sm font-bold transition-colors duration-500 ${circleClass}`}
      >
        {step.status === 'complete' ? '✓' : step.status === 'failed' ? '✕' : step.status === 'active' ? '●' : ''}
      </div>
      <span className={`text-[11px] font-medium text-center leading-tight ${step.status === 'pending' ? 'text-brand-400' : 'text-ink'}`}>
        {step.label}
      </span>
    </div>
  );
}

// Real-time process tracker for a Purchase Order's workflow (spec: "the
// animation must be driven by REAL backend status, never a fake completed
// animation"). Every step's status is derived straight from the Purchase
// record - nothing here is a client-side optimistic guess except the
// transient "Approving.../Receiving.../Sending..." button labels while a
// request is in flight, and those flip back to whatever the server
// actually returned the instant it responds (see the detail page's
// onApprove/onReceive/onRetryWhatsapp).
//
// Approval and receipt are two separate real-world events (approving a PO
// doesn't mean the material has physically arrived) - so "Stock Updated"
// only completes once a Super-Admin-approved PO is explicitly marked
// Received, not the moment it's approved.
export function PurchaseProcessTracker({
  purchase,
  canApprove,
  approving,
  onApprove,
  canReceive,
  receiving,
  onReceive,
  onRetryWhatsapp,
  retrying,
}: {
  purchase: Purchase;
  canApprove: boolean;
  approving: boolean;
  onApprove: () => void;
  canReceive: boolean;
  receiving: boolean;
  onReceive: () => void;
  onRetryWhatsapp: () => void;
  retrying: boolean;
}) {
  if (purchase.status === 'CANCELLED') return null;

  const pendingApproval = purchase.status === 'PENDING_APPROVAL';
  const awaitingReceipt = purchase.status === 'APPROVED';
  const received = purchase.status === 'RECORDED';
  const approved = awaitingReceipt || received;

  let whatsappStatus: StepStatus = 'pending';
  let whatsappLabel = 'Supplier WhatsApp';
  if (approved) {
    if (purchase.whatsappStatus === 'SENT') {
      whatsappStatus = 'complete';
      whatsappLabel = 'WhatsApp Sent';
    } else if (purchase.whatsappStatus === 'FAILED') {
      whatsappStatus = 'failed';
      whatsappLabel = 'WhatsApp Failed';
    } else {
      whatsappStatus = 'active';
      whatsappLabel = 'Sending WhatsApp...';
    }
  }

  const steps: Step[] = [
    { key: 'raised', label: 'Raised', status: 'complete' },
    { key: 'approval', label: pendingApproval ? 'Pending Approval' : 'Approval', status: pendingApproval ? 'active' : 'complete' },
    { key: 'approved', label: 'Approved', status: approved ? 'complete' : 'pending' },
    { key: 'stock', label: 'Stock Updated', status: received ? 'complete' : awaitingReceipt ? 'active' : 'pending' },
    { key: 'whatsapp', label: whatsappLabel, status: whatsappStatus },
  ];

  const completedCount = steps.filter((s) => s.status === 'complete').length;
  const progressPct = (completedCount / (steps.length - 1)) * 100;

  return (
    <div className="card p-5">
      <div className="relative flex items-start max-w-2xl mx-auto px-2">
        <div className="absolute top-[18px] left-[calc(10%)] right-[calc(10%)] h-[2px] bg-brand-100 rounded-full overflow-hidden">
          <div className="h-full bg-emerald-600 transition-all duration-700 ease-out" style={{ width: `${Math.min(progressPct, 100)}%` }} />
        </div>
        {steps.map((s) => (
          <StepNode key={s.key} step={s} />
        ))}
      </div>

      {awaitingReceipt && (
        <div className="relative h-6 max-w-[140px] mx-auto mt-3 overflow-hidden text-base">
          <span className="absolute right-0 top-1/2 -translate-y-1/2">📦</span>
          <span className="absolute top-1/2 -translate-y-1/2 animate-doc-send">🚚</span>
        </div>
      )}
      {whatsappStatus === 'active' && (
        <div className="relative h-6 max-w-[140px] mx-auto mt-3 overflow-hidden text-base">
          <span className="absolute right-0 top-1/2 -translate-y-1/2">💬</span>
          <span className="absolute top-1/2 -translate-y-1/2 animate-doc-send">📄</span>
        </div>
      )}

      {pendingApproval && (
        <div className="text-center mt-4">
          <p className="text-xs text-brand-500 mb-2">Awaiting Super Admin approval</p>
          {canApprove && (
            <button type="button" className="btn-primary" disabled={approving} onClick={onApprove}>
              {approving ? 'Approving...' : 'Approve Purchase Order'}
            </button>
          )}
        </div>
      )}

      {awaitingReceipt && (
        <div className="text-center mt-4">
          <p className="text-xs text-brand-500 mb-2">Approved - waiting for the material to be received</p>
          {canReceive && (
            <button type="button" className="btn-primary" disabled={receiving} onClick={onReceive}>
              {receiving ? 'Marking as Received...' : 'Mark as Received'}
            </button>
          )}
        </div>
      )}

      {whatsappStatus === 'failed' && (
        <div className="text-center mt-3">
          <p className="text-xs text-red-600 mb-1">{purchase.whatsappError || 'Could not send the PDF via WhatsApp.'}</p>
          <button type="button" className="text-xs text-brand-600 hover:underline font-medium" disabled={retrying} onClick={onRetryWhatsapp}>
            {retrying ? 'Retrying...' : 'Retry WhatsApp'}
          </button>
        </div>
      )}
    </div>
  );
}
