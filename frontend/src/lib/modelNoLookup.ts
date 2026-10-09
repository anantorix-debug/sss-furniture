import { api } from './api';

// A Model No is only a number. Typing or pasting "PO-12" / "No. 12" leaves 12;
// Job Nos (JOB-2026-00008) are not Model Nos and pass through untouched.
export function sanitizeModelNo(raw: string): string {
  const t = raw.trim();
  if (/^JOB[\s-]/i.test(t)) return t;
  const runs = t.match(/\d+/g);
  if (!runs) return '';
  return runs[runs.length - 1].replace(/^0+(?=\d)/, '');
}

export interface ModelNoLookup {
  modelNo: string;
  status: 'FOUND' | 'HISTORY_ONLY' | 'NOT_FOUND' | 'INVALID';
  message: string;
  autofill: { productName?: string | null; category?: string | null; size?: string | null; sizeUnit?: string | null } | null;
}

// The one lookup every page uses (GET /products/lookup). Read-only.
export async function lookupModelNo(modelNo: string): Promise<ModelNoLookup | null> {
  if (!modelNo.trim()) return null;
  try {
    return await api.get<ModelNoLookup>(`/products/lookup?modelNo=${encodeURIComponent(modelNo)}`, { silent: true });
  } catch {
    return null;
  }
}
