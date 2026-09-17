'use client';

import { useState } from 'react';
import { ApiError } from '@/lib/api';

// Shared "this is blocked by real connected data - Super Admin, force it
// through anyway?" flow. Every delete/edit guard in the backend responds
// with a 409 Conflict and a message explaining exactly what's connected;
// this hook catches that, and - only for Super Admin - offers to retry the
// same action with force=true appended to the request. Non-Super-Admin
// users just see the normal error toast (already automatic, see lib/api.ts)
// with no force option, since only Super Admin may bypass these checks.
export function useForceable() {
  const [prompt, setPrompt] = useState<{ message: string; onForce: () => void } | null>(null);

  // `action` must itself understand `force` (typically by appending
  // `?force=true` to its own request URL when called with force=true).
  async function runForceable(action: (force?: boolean) => Promise<void>, canForce: boolean) {
    try {
      await action();
    } catch (err) {
      if (canForce && err instanceof ApiError && err.status === 409) {
        setPrompt({
          message: err.message,
          onForce: async () => {
            setPrompt(null);
            await action(true).catch(() => {
              // Global toast already surfaces why, if the force attempt itself fails.
            });
          },
        });
        return;
      }
      // Any other error (or a non-Super-Admin's 409) is already shown via
      // the global toast - nothing else to do here.
    }
  }

  return { forcePrompt: prompt, closeForcePrompt: () => setPrompt(null), runForceable };
}
