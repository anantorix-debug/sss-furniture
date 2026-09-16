'use client';

import { useEffect, useState } from 'react';
import { subscribeToasts, dismissToast, type Toast } from '@/lib/toast';

const KIND_STYLE: Record<Toast['kind'], string> = {
  error: 'bg-red-600 text-white',
  success: 'bg-emerald-600 text-white',
  info: 'bg-brand-900 text-white',
};

const KIND_ICON: Record<Toast['kind'], string> = {
  error: '⚠',
  success: '✓',
  info: 'ℹ',
};

// Single global toast stack, mounted once in the root layout - every
// api.ts request failure (see apiFetch) surfaces here automatically, plus
// any page can call toast.success()/toast.error()/toast.info() directly
// (see @/lib/toast). Stacks bottom-up on mobile/tablet width so it never
// covers more than a couple of lines of content, top-right on wider
// screens to stay out of the way of the Sidebar and page header.
export function Toaster() {
  const [toasts, setToasts] = useState<Toast[]>([]);

  useEffect(() => subscribeToasts(setToasts), []);

  if (toasts.length === 0) return null;

  return (
    <div className="fixed z-[200] inset-x-3 top-3 sm:inset-x-auto sm:right-4 sm:top-4 flex flex-col gap-2 sm:w-[380px] max-w-[calc(100vw-1.5rem)] pointer-events-none">
      {toasts.map((t) => (
        <div
          key={t.id}
          role="alert"
          className={`pointer-events-auto rounded-lg shadow-lg px-4 py-3 flex items-start gap-2.5 text-sm ${KIND_STYLE[t.kind]}`}
        >
          <span className="leading-5 shrink-0" aria-hidden>
            {KIND_ICON[t.kind]}
          </span>
          <p className="flex-1 leading-5 break-words">{t.message}</p>
          <button
            className="shrink-0 text-white/70 hover:text-white text-base leading-none px-0.5"
            onClick={() => dismissToast(t.id)}
            aria-label="Dismiss"
          >
            &times;
          </button>
        </div>
      ))}
    </div>
  );
}
