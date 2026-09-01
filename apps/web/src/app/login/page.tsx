'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import { useAuth, ApiError } from '@/context/AuthContext';

const FEATURES = [
  { icon: '₹', text: 'Customer & party orders as separate channels' },
  { icon: '▤', text: 'Supplier purchase & payment ledgers' },
  { icon: '✦', text: 'Carpenter work assignment with WhatsApp alerts' },
  { icon: '▣', text: 'Superadmin, Admin and Employee access control' },
];

const REMEMBER_EMAIL_KEY = 'sss.rememberedEmail';

export default function LoginPage() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [rememberMe, setRememberMe] = useState(true);
  const [showForgotHelp, setShowForgotHelp] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    const remembered = window.localStorage.getItem(REMEMBER_EMAIL_KEY);
    if (remembered) setEmail(remembered);
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(email, password);
      if (rememberMe) {
        window.localStorage.setItem(REMEMBER_EMAIL_KEY, email);
      } else {
        window.localStorage.removeItem(REMEMBER_EMAIL_KEY);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Unable to log in. Please try again.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-brand-50 p-4">
      <div className="w-full max-w-4xl rounded-card border border-brand-300 overflow-hidden flex shadow-card bg-brand-50">
        <div className="hidden md:flex w-[46%] bg-brand-700 flex-col justify-between p-10">
          <div className="bg-white rounded-[10px] p-2.5 inline-block w-fit">
            <Image src="/logo2.jpeg" alt="SSS Company" width={1600} height={492} className="h-11 w-auto" priority />
          </div>

          <div className="space-y-5 py-8">
            <h1 className="text-white text-[28px] font-bold leading-tight">
              One system for the entire order & ledger cycle.
            </h1>
            <p className="text-white/70 text-sm leading-relaxed">
              From customer order to production, delivery and final payment - replacing every spreadsheet in one place.
            </p>
            <div className="space-y-3 pt-2">
              {FEATURES.map((f) => (
                <div key={f.text} className="flex items-center gap-3">
                  <div className="h-[30px] w-[30px] rounded-[7px] bg-white/10 flex items-center justify-center text-[13px] text-brand-400 shrink-0">
                    {f.icon}
                  </div>
                  <p className="text-white/85 text-[13px]">{f.text}</p>
                </div>
              ))}
            </div>
          </div>

          <p className="text-white/40 text-[11px]">&copy; {new Date().getFullYear()} SSS Company &middot; v1.0</p>
        </div>

        <div className="flex-1 flex items-center justify-center p-4 sm:p-8 md:p-12 bg-brand-50">
          <form onSubmit={handleSubmit} className="w-full max-w-sm card p-6 sm:p-10 space-y-[18px]">
            <div>
              <p className="text-ink text-[26px] font-bold">Welcome back</p>
              <p className="text-ink-muted text-[13px] mt-1">Sign in to continue to your dashboard</p>
            </div>

            <div className="space-y-1.5">
              <label className="label" htmlFor="email">
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                autoComplete="email"
                className="input"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@sss.com"
              />
            </div>

            <div className="space-y-1.5">
              <label className="label" htmlFor="password">
                Password
              </label>
              <input
                id="password"
                type="password"
                required
                autoComplete="current-password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>

            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <span
                  className={`h-[17px] w-[17px] rounded-[4px] flex items-center justify-center text-white text-[10px] font-bold ${
                    rememberMe ? 'bg-accent' : 'bg-white border border-brand-300'
                  }`}
                  onClick={() => setRememberMe((v) => !v)}
                >
                  {rememberMe && '✓'}
                </span>
                <input type="checkbox" className="sr-only" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
                <span className="text-ink-muted text-[12.5px]">Keep me signed in</span>
              </label>
              <button
                type="button"
                className="text-accent text-[12.5px] font-medium hover:underline"
                onClick={() => setShowForgotHelp((v) => !v)}
              >
                Forgot password?
              </button>
            </div>

            {showForgotHelp && (
              <p className="text-[11.5px] text-ink-muted bg-brand-50 border border-brand-100 rounded-control px-3 py-2 -mt-2">
                Password resets aren&apos;t self-service. Ask your Superadmin or Admin to reset it from Users &amp; Roles.
              </p>
            )}

            {error && <p className="text-sm text-accent-600 bg-accent-50 border border-accent-100 rounded-control px-3 py-2">{error}</p>}

            <button type="submit" disabled={submitting} className="btn-primary w-full h-[46px] text-[15px] tracking-wide">
              {submitting ? 'Signing in...' : 'Sign In'}
            </button>

            <div className="h-px bg-brand-100 w-full" />

            <div className="flex gap-2.5 items-start rounded-lg bg-[#e9f0ed] px-[13px] py-[11px]">
              <div className="h-5 w-5 rounded-full bg-brand-700 flex items-center justify-center text-white text-[11px] shrink-0">i</div>
              <p className="text-brand-700 text-[11.5px] leading-4">
                Access is role-based: Superadmin, Admin, and Employee accounts see different data and actions.
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}
