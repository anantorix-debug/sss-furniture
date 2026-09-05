// A single labeled read-only field, used by the "View full details" modals
// (Stock Management, Party Orders) so a trimmed-down table can still show
// every field on demand without opening an editable form.
export function ViewField({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-brand-400">{label}</p>
      <p className="text-ink">{value}</p>
    </div>
  );
}
