'use client';

import { useEffect } from 'react';

// GPay-style success confirmation - a circle draws itself in, then a
// checkmark draws on top, briefly overlaying the screen before
// auto-dismissing. Used after a payment is recorded or an order is saved,
// wherever a brief "yes, that went through" moment is more reassuring than
// just a toast (spec: "tick animation like GPay UI ... after payment /
// after success entry"). Purely visual - never blocks or delays the action
// it's confirming, which has already completed by the time this shows.
export function SuccessTick({ message, onDone, durationMs = 1400 }: { message?: string; onDone: () => void; durationMs?: number }) {
  useEffect(() => {
    const t = setTimeout(onDone, durationMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-white/55 animate-success-backdrop" onClick={onDone}>
      <div className="flex flex-col items-center gap-3 animate-success-pop">
        <svg width="96" height="96" viewBox="0 0 60 60" fill="none" style={{ filter: 'drop-shadow(0 8px 18px rgba(22, 163, 74, 0.45))' }}>
          <circle cx="30" cy="30" r="28" fill="#16a34a" />
          <path d="M18 30.5 L26 38.5 L42 21" stroke="#ffffff" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round" className="animate-success-check" fill="none" />
        </svg>
        {message && <p className="bg-white rounded-full px-4 py-1.5 text-sm font-medium text-ink shadow-lg">{message}</p>}
      </div>
    </div>
  );
}
