'use client';

import { ReactNode } from 'react';

export function Modal({
  title,
  onClose,
  children,
  wide,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4" onClick={onClose}>
      <div
        className={`card w-full ${wide ? 'max-w-3xl' : 'max-w-md'} max-h-[90vh] overflow-y-auto`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between px-5 py-4 border-b border-brand-100">
          <h2 className="font-semibold text-brand-900">{title}</h2>
          <button onClick={onClose} className="text-brand-400 hover:text-brand-700 text-xl leading-none">
            &times;
          </button>
        </div>
        <div className="p-4 sm:p-5">{children}</div>
      </div>
    </div>
  );
}
