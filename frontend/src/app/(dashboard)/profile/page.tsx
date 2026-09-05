'use client';

import { useState } from 'react';
import { useAuth, ApiError } from '@/context/AuthContext';
import { api } from '@/lib/api';
import { Chip } from '@/components/StatusBadge';
import { PasswordInput } from '@/components/PasswordInput';
import type { Role } from '@/types';

const ROLE_LABEL: Record<Role, string> = {
  SUPERADMIN: 'Super Admin',
  ADMIN: 'Admin',
  CARPENTER: 'Carpenter Team',
  CARVER: 'Carving Team',
  POLISHER: 'Polish Team',
};
const ROLE_COLOR: Record<Role, 'darkGreen' | 'blue' | 'gray'> = {
  SUPERADMIN: 'darkGreen',
  ADMIN: 'blue',
  CARPENTER: 'gray',
  CARVER: 'gray',
  POLISHER: 'gray',
};

export default function ProfilePage() {
  const { user } = useAuth();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSuccess(false);

    if (newPassword !== confirmPassword) {
      setError('New password and confirmation do not match');
      return;
    }
    if (newPassword.length < 6) {
      setError('New password must be at least 6 characters');
      return;
    }

    setSubmitting(true);
    try {
      await api.post('/auth/change-password', { currentPassword, newPassword });
      setSuccess(true);
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to change password');
    } finally {
      setSubmitting(false);
    }
  }

  if (!user) return null;

  const initials = user.name
    .split(' ')
    .map((p) => p[0])
    .slice(0, 2)
    .join('')
    .toUpperCase();

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-900">My Profile & Security</h1>
        <p className="text-sm text-brand-500 mt-1">Your account details and password.</p>
      </div>

      <div className="card p-6 flex items-center gap-4">
        <div className="h-16 w-16 rounded-full bg-brand-700 flex items-center justify-center text-white text-xl font-semibold shrink-0">
          {initials}
        </div>
        <div className="min-w-0">
          <p className="font-semibold text-ink text-lg">{user.name}</p>
          <p className="text-ink-muted text-sm">{user.email}</p>
          <div className="mt-2">
            <Chip color={ROLE_COLOR[user.role]} label={ROLE_LABEL[user.role]} />
          </div>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="card p-6 space-y-4">
        <h2 className="font-semibold text-ink">Change Password</h2>

        <div>
          <label className="label">Current Password</label>
          <PasswordInput
            className="input"
            required
            value={currentPassword}
            onChange={(e) => setCurrentPassword(e.target.value)}
          />
        </div>
        <div>
          <label className="label">New Password</label>
          <PasswordInput className="input" required minLength={6} value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        </div>
        <div>
          <label className="label">Confirm New Password</label>
          <PasswordInput
            className="input"
            required
            minLength={6}
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>

        {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-control px-3 py-2">{error}</p>}
        {success && (
          <p className="text-sm text-emerald-700 bg-emerald-50 border border-emerald-200 rounded-control px-3 py-2">
            Password updated. You&apos;ll stay signed in on this device.
          </p>
        )}

        <button type="submit" disabled={submitting} className="btn-primary">
          {submitting ? 'Updating...' : 'Update Password'}
        </button>
      </form>
    </div>
  );
}
