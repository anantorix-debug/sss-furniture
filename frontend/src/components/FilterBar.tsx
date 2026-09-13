'use client';

// One reusable, controlled filter row for list pages - Search/Date/Select
// fields configured per page, rendered with the same `.input`/`.btn-*`
// classes every hand-rolled filter already used, so it's visually identical
// to what was there before. Each page owns its own filter state and query-
// string building (for both its list fetch and its PDF export) - this
// component only renders inputs and reports changes/apply/reset.
export interface FilterField {
  key: string;
  label: string;
  type: 'search' | 'date' | 'select';
  options?: { value: string; label: string }[];
  placeholder?: string;
}

export function FilterBar({
  fields,
  values,
  onChange,
  onApply,
  onReset,
}: {
  fields: FilterField[];
  values: Record<string, string>;
  onChange: (key: string, value: string) => void;
  onApply: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      {fields.map((f) => (
        <div key={f.key} className="flex flex-col gap-1">
          <label className="text-[11px] font-medium text-brand-500">{f.label}</label>
          {f.type === 'select' ? (
            <select className="input max-w-[180px]" value={values[f.key] ?? ''} onChange={(e) => onChange(f.key, e.target.value)}>
              <option value="">All</option>
              {f.options?.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          ) : f.type === 'date' ? (
            <input
              type="date"
              className="input max-w-[160px]"
              value={values[f.key] ?? ''}
              onChange={(e) => onChange(f.key, e.target.value)}
            />
          ) : (
            <input
              className="input max-w-xs"
              placeholder={f.placeholder ?? f.label}
              value={values[f.key] ?? ''}
              onChange={(e) => onChange(f.key, e.target.value)}
            />
          )}
        </div>
      ))}
      <div className="flex gap-2">
        <button type="button" className="btn-primary h-9 px-4 text-sm" onClick={onApply}>
          Apply Filters
        </button>
        <button type="button" className="btn-secondary h-9 px-4 text-sm" onClick={onReset}>
          Reset
        </button>
      </div>
    </div>
  );
}
