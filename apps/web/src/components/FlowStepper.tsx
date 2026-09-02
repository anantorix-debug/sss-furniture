interface Step {
  key: string;
  label: string;
  sub?: string;
  state: 'done' | 'current' | 'upcoming' | 'blocked';
}

const STATE_STYLE: Record<Step['state'], { circle: string; line: string; label: string }> = {
  done: { circle: 'bg-emerald-600 text-white', line: 'bg-emerald-600', label: 'text-ink' },
  current: { circle: 'bg-accent text-white ring-4 ring-accent-100', line: 'bg-brand-200', label: 'text-ink font-semibold' },
  upcoming: { circle: 'bg-white border-2 border-brand-200 text-brand-300', line: 'bg-brand-200', label: 'text-ink-muted' },
  blocked: { circle: 'bg-red-100 border-2 border-red-300 text-red-500', line: 'bg-brand-200', label: 'text-red-600' },
};

export function FlowStepper({ steps }: { steps: Step[] }) {
  return (
    <div className="card p-5">
      <div className="flex items-start">
        {steps.map((step, idx) => {
          const style = STATE_STYLE[step.state];
          return (
            <div key={step.key} className="flex-1 flex flex-col items-center relative">
              {idx > 0 && <div className={`absolute top-4 right-1/2 w-full h-0.5 -z-0 ${STATE_STYLE[steps[idx - 1].state === 'done' ? 'done' : 'upcoming'].line}`} />}
              <div className={`relative z-10 h-8 w-8 rounded-full flex items-center justify-center text-xs font-semibold shrink-0 ${style.circle}`}>
                {step.state === 'done' ? '✓' : idx + 1}
              </div>
              <p className={`mt-2 text-xs text-center ${style.label}`}>{step.label}</p>
              {step.sub && <p className="text-[10px] text-ink-muted text-center mt-0.5">{step.sub}</p>}
            </div>
          );
        })}
      </div>
    </div>
  );
}

export type { Step as FlowStep };
