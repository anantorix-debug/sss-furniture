import Image from 'next/image';

export function PageLoader({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center gap-4 bg-brand-50">
      <div className="bg-white rounded-[10px] p-2 shadow-[0px_1px_3px_0px_rgba(0,0,0,0.08)]">
        <Image src="/logo1.jpeg" alt="SSS Company" width={594} height={339} className="h-9 w-auto" priority />
      </div>
      <div className="h-8 w-8 rounded-full border-[3px] border-brand-200 border-t-brand-700 animate-spin" />
      <p className="text-ink-muted text-sm">{label}</p>
    </div>
  );
}

export function InlineLoader({ label = 'Loading...' }: { label?: string }) {
  return (
    <div className="flex items-center gap-2.5 text-brand-500 text-sm py-6 justify-center">
      <span className="h-4 w-4 rounded-full border-2 border-brand-200 border-t-brand-700 animate-spin shrink-0" />
      {label}
    </div>
  );
}
