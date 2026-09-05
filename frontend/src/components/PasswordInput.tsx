'use client';

import { useState, forwardRef } from 'react';

// Drop-in replacement for <input type="password" className="input" ... />
// with a show/hide eye toggle - accepts the same props (id, required,
// minLength, autoComplete, value, onChange, etc.) via passthrough.
export const PasswordInput = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(function PasswordInput(
  { className, ...props },
  ref,
) {
  const [visible, setVisible] = useState(false);

  return (
    <div className="relative">
      <input ref={ref} type={visible ? 'text' : 'password'} className={`${className ?? 'input'} pr-9`} {...props} />
      <button
        type="button"
        tabIndex={-1}
        onClick={() => setVisible((v) => !v)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-brand-400 hover:text-brand-700 text-sm leading-none"
        aria-label={visible ? 'Hide password' : 'Show password'}
        title={visible ? 'Hide password' : 'Show password'}
      >
        {visible ? '🙈' : '👁'}
      </button>
    </div>
  );
});
