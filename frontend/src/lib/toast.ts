// Tiny module-level pub/sub for toast notifications - deliberately not a
// React context, since the biggest win (surfacing every API error, see
// apiFetch in api.ts) needs to fire from plain non-component code that has
// no access to hooks. <Toaster/> (mounted once in the root layout)
// subscribes to this and renders whatever's in the list.
export type ToastKind = 'error' | 'success' | 'info';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
}

let toasts: Toast[] = [];
let nextId = 1;
const listeners = new Set<(toasts: Toast[]) => void>();

function emit() {
  for (const listener of listeners) listener(toasts);
}

export function subscribeToasts(listener: (toasts: Toast[]) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dismissToast(id: number) {
  toasts = toasts.filter((t) => t.id !== id);
  emit();
}

const AUTO_DISMISS_MS: Record<ToastKind, number> = { error: 6000, success: 3500, info: 4000 };

export function showToast(kind: ToastKind, message: string) {
  const id = nextId++;
  toasts = [...toasts, { id, kind, message }];
  emit();
  setTimeout(() => dismissToast(id), AUTO_DISMISS_MS[kind]);
}

export const toast = {
  error: (message: string) => showToast('error', message),
  success: (message: string) => showToast('success', message),
  info: (message: string) => showToast('info', message),
};
