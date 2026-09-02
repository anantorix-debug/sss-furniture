const BAR_COLOR = {
  default: 'bg-brand-700',
  warning: 'bg-brand-400',
  success: 'bg-emerald-600',
} as const;

export function StatCard({
  label,
  value,
  sub,
  accent = 'default',
}: {
  label: string;
  value: string;
  sub?: string;
  accent?: 'default' | 'warning' | 'success';
}) {
  return (
    <div className="bg-white border border-brand-200 rounded-[10px] shadow-[0px_1px_3px_0px_rgba(0,0,0,0.06)] overflow-hidden">
      <div className={`h-[3px] w-full ${BAR_COLOR[accent]}`} />
      <div className="flex flex-col gap-[7px] px-[14px] py-[13px]">
        <p className="text-ink-muted text-[10px] font-medium tracking-[0.5px] uppercase">{label}</p>
        <p className="text-ink text-[19px] font-bold">{value}</p>
        {sub && <p className="text-ink-muted text-[9.5px]">{sub}</p>}
      </div>
    </div>
  );
}
