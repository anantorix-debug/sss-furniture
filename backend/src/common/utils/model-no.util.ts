// One definition of "what is a Model No." for the whole backend, so every
// module (orders, production, stock, imports) normalizes, validates and
// compares it the same way.
//
// A Model No is ONLY a number - "985", "1000", "52". Prefix text people
// sometimes add ("PO-NEW-2", "CO-MODEL-1", "No. 12") is dropped and the
// number is kept, so "PO-NEW-2", "CO-MODEL-2" and "2" are the same Model No
// and end up as one product. Leading zeros don't matter ("007" is 7).
//
// Job Nos ("JOB-2026-00008") are a different identifier that production
// sometimes parks in the same field before a real Model No exists. They are
// NOT Model Nos and must never be reduced to a number (that would turn a
// job into "Model 8") - isJobNumber() recognises them so callers leave
// them alone.

export const MODEL_NO_MAX_LENGTH = 50;

// Display clean-up only: trim and collapse inner spaces.
export function cleanModelNo(raw: unknown): string {
  if (typeof raw !== 'string' && typeof raw !== 'number') return '';
  return String(raw).replace(/\s+/g, ' ').trim();
}

export function isJobNumber(raw: unknown): boolean {
  return /^JOB[\s-]/i.test(cleanModelNo(raw));
}

// The number inside a Model No, or null when there is none (or it is a Job
// No). With several numbers in the text ("CO-2026-12") the LAST one is the
// Model No, the same place a prefix-then-number code puts it.
export function extractModelNumber(raw: unknown): string | null {
  const text = cleanModelNo(raw);
  if (!text || isJobNumber(text)) return null;
  const runs = text.match(/\d+/g);
  if (!runs) return null;
  const last = runs[runs.length - 1];
  return last.replace(/^0+(?=\d)/, '');
}

// Comparison key. Plain numbers and their prefixed spellings share one key;
// anything else (a Job No, free text) falls back to its upper-cased text so
// it still compares sensibly without ever colliding with a real number.
export function modelNoKey(raw: unknown): string {
  return extractModelNumber(raw) ?? cleanModelNo(raw).toUpperCase();
}

// True when the stored text is already in its final form (digits only, no
// leading zeros).
export function isCanonicalModelNo(raw: unknown): boolean {
  const text = cleanModelNo(raw);
  return /^\d+$/.test(text) && text === extractModelNumber(text);
}

export type ModelNoValidation = { ok: true; value: string } | { ok: false; reason: string };

export function validateModelNo(raw: unknown): ModelNoValidation {
  const text = cleanModelNo(raw);
  if (!text) return { ok: false, reason: 'Enter a Model No.' };
  if (text.length > MODEL_NO_MAX_LENGTH) return { ok: false, reason: `Model No must be ${MODEL_NO_MAX_LENGTH} characters or fewer.` };
  if (isJobNumber(text)) return { ok: false, reason: `${text} is a Job No, not a Model No. A Model No is just a number (for example 985).` };
  const value = extractModelNumber(text);
  if (!value) return { ok: false, reason: `"${text}" is not a Model No - a Model No is just a number (for example 985).` };
  return { ok: true, value };
}

// Product names are written loosely on paper sheets ("HEAM-ROSLI",
// "HEAM ROSLI", "HEAM ROLSI"). nameKey() strips everything but letters and
// digits; sameDesign() treats two names as the same design when their keys
// are equal, one contains the other, or - for longer names - they differ by
// at most two characters (a typo).
export function nameKey(raw: unknown): string {
  return (typeof raw === 'string' ? raw : '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function editDistance(a: string, b: string, limit: number): number {
  if (Math.abs(a.length - b.length) > limit) return limit + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      rowMin = Math.min(rowMin, cur[j]);
    }
    if (rowMin > limit) return limit + 1;
    prev = cur;
  }
  return prev[b.length];
}

export function sameDesign(a: unknown, b: unknown): boolean {
  const x = nameKey(a);
  const y = nameKey(b);
  if (!x || !y) return false;
  if (x === y) return true;
  const [short, long] = x.length <= y.length ? [x, y] : [y, x];
  if (short.length >= 4 && long.includes(short)) return true;
  return short.length >= 6 && editDistance(x, y, 2) <= 2;
}
