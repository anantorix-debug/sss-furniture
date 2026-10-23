'use client';

import type { ItemSpecs } from '@/types';

// Optional quotation details for one order line (Customer / Party Order),
// printed in the order PDF's spec boxes. Collapsed by default; empty fields
// are simply left out of the PDF.
const GROUPS: { title: string; fields: { key: keyof ItemSpecs; label: string; placeholder: string }[] }[] = [
  {
    title: 'Size',
    fields: [
      { key: 'overallSize', label: 'Overall size', placeholder: `6'-2" W × 6'-7" L` },
      { key: 'headboardHeight', label: 'Headboard height', placeholder: `3'-8"` },
      { key: 'frameHeight', label: 'Frame height', placeholder: `1'-2"` },
    ],
  },
  {
    title: 'Material Details',
    fields: [
      { key: 'plywood', label: 'Plywood', placeholder: 'Century BWP' },
      { key: 'innerSide', label: 'Inner side', placeholder: 'Fabric Mica' },
      { key: 'outerSide', label: 'Outer side', placeholder: 'Veneer Sheet' },
    ],
  },
  {
    title: 'Process',
    fields: [
      { key: 'work', label: 'Work', placeholder: 'Machine Press Work' },
      { key: 'polish', label: 'Polish', placeholder: 'Both Work Polish' },
      { key: 'finishType', label: 'Finish type', placeholder: 'Natural Semi-Glossy' },
    ],
  },
  {
    title: 'Headboard Cushion',
    fields: [
      { key: 'foam', label: 'Foam', placeholder: '32 Density Foam' },
      { key: 'headboard', label: 'Headboard', placeholder: '3" Thick Fabric' },
    ],
  },
  {
    title: 'Assembly',
    fields: [
      { key: 'assemblyMethod', label: 'Method', placeholder: 'All Dismantle' },
      { key: 'fittings', label: 'Fittings', placeholder: 'Hex Bolt & Clamp' },
    ],
  },
];

export function ItemSpecsEditor({ value, onChange }: { value: ItemSpecs | undefined; onChange: (next: ItemSpecs) => void }) {
  const specs = value ?? {};
  const filled = Object.values(specs).filter((v) => typeof v === 'string' && v.trim()).length;
  return (
    <details className="rounded-lg border border-brand-100 bg-brand-50/40">
      <summary className="cursor-pointer select-none px-3 py-1.5 text-xs font-medium text-brand-700">
        Quotation details for PDF (optional){filled ? ` · ${filled} filled` : ''}
      </summary>
      <div className="px-3 pb-3 pt-1 space-y-3">
        {GROUPS.map((g) => (
          <div key={g.title}>
            <p className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted mb-1">{g.title}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              {g.fields.map((f) => (
                <input
                  key={f.key}
                  className="input !py-1.5 text-sm"
                  aria-label={f.label}
                  title={f.label}
                  placeholder={`${f.label} (e.g. ${f.placeholder})`}
                  maxLength={80}
                  value={specs[f.key] ?? ''}
                  onChange={(e) => onChange({ ...specs, [f.key]: e.target.value })}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </details>
  );
}

// Trimmed, blanks dropped - what is sent to the server.
export function specsPayload(specs: ItemSpecs | undefined): ItemSpecs {
  const out: ItemSpecs = {};
  for (const [k, v] of Object.entries(specs ?? {})) if (typeof v === 'string' && v.trim()) out[k as keyof ItemSpecs] = v.trim();
  return out;
}
