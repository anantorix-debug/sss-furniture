'use client';

import { useState, Fragment } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/context/AuthContext';
import { RoleGate } from '@/components/RoleGate';
import { Modal } from '@/components/Modal';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { Chip, type ChipColor } from '@/components/StatusBadge';
import { StatCard } from '@/components/StatCard';
import { PermissionMatrix } from '@/components/PermissionMatrix';
import { PasswordInput } from '@/components/PasswordInput';
import { WhatsAppModal } from '@/components/WhatsAppModal';
import { useWhatsApp } from '@/hooks/useWhatsApp';
import { buildCredentialsMessage } from '@/lib/credentialsMessage';
import { formatDate } from '@/lib/format';
import type { User, Role, CarpenterSummary } from '@/types';

const PRODUCTION_ROLES: Role[] = ['CARPENTER', 'CARVER', 'POLISHER'];

const ROLE_LABEL: Record<Role, string> = {
  SUPERADMIN: 'Super Admin',
  ADMIN: 'Admin',
  CARPENTER: 'Carpenter Team',
  CARVER: 'Carving Team',
  POLISHER: 'Polish Team',
};
const ROLE_CHIP_COLOR: Record<Role, ChipColor> = {
  SUPERADMIN: 'darkGreen',
  ADMIN: 'blue',
  CARPENTER: 'amber',
  CARVER: 'green',
  POLISHER: 'gray',
};

function UsersPageContent() {
  const { user: me } = useAuth();
  const { data, isLoading, mutate } = useSWR<User[]>('/users', fetcher);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('CARPENTER');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [pendingDeactivation, setPendingDeactivation] = useState(false);
  const [linkCarpenterId, setLinkCarpenterId] = useState('');

  const { showModal, whatsappOptions, openWhatsApp, closeWhatsApp } = useWhatsApp();
  const [sharingError, setSharingError] = useState<string | null>(null);
  const [generatingPassword, setGeneratingPassword] = useState(false);
  // Per-user cache of a revealed password, keyed by user id - lets the
  // show/hide eye toggle flip visibility instantly without re-fetching,
  // and lets "WhatsApp" reuse exactly what's already shown.
  const [revealedPasswords, setRevealedPasswords] = useState<Record<string, { password: string; isNew: boolean; visible: boolean }>>({});

  // Inline password change directly from the table row - a lighter-weight
  // alternative to opening the full Edit modal just to set a password.
  const [passwordEditId, setPasswordEditId] = useState<string | null>(null);
  const [passwordEditValue, setPasswordEditValue] = useState('');
  const [passwordEditError, setPasswordEditError] = useState<string | null>(null);
  const [passwordEditSubmitting, setPasswordEditSubmitting] = useState(false);

  function startPasswordEdit(u: User) {
    setPasswordEditId(u.id);
    setPasswordEditValue('');
    setPasswordEditError(null);
  }

  async function savePasswordEdit(u: User) {
    if (passwordEditValue.length < 6) {
      setPasswordEditError('Password must be at least 6 characters');
      return;
    }
    setPasswordEditSubmitting(true);
    setPasswordEditError(null);
    try {
      await api.patch(`/users/${u.id}`, { password: passwordEditValue });
      setPasswordEditId(null);
      setPasswordEditValue('');
      // Any cached reveal is now stale (the password just changed).
      setRevealedPasswords((prev) => {
        if (!(u.id in prev)) return prev;
        const rest = { ...prev };
        delete rest[u.id];
        return rest;
      });
      mutate();
    } catch (err) {
      setPasswordEditError(err instanceof ApiError ? err.message : 'Failed to change password');
    } finally {
      setPasswordEditSubmitting(false);
    }
  }
  // Required (not optional) - independent of the WhatsApp modal, so a
  // cancelled/failed send never strands the admin without the password.
  // When isNew is true, this is the only place a freshly-generated
  // password will ever be recoverable (bcrypt is one-way).
  const [tempPasswordBanner, setTempPasswordBanner] = useState<{ user: User; password: string; isNew: boolean } | null>(null);

  // Unlinked worker profiles matching the selected role - lets a brand new
  // Carpenter/Carver/Polisher login be tied to their payee profile in the
  // same step, instead of a separate trip to Production > Edit worker.
  const { data: carpentersForRole } = useSWR<CarpenterSummary[]>(
    formOpen && !editing && PRODUCTION_ROLES.includes(role) ? `/carpenters?workerType=${role}` : null,
    fetcher,
  );
  const allCarpentersForRole = carpentersForRole ?? [];

  function openCreate() {
    setEditing(null);
    setName('');
    setEmail('');
    setPhone('');
    setPassword('');
    setRole('CARPENTER');
    setIsActive(true);
    setLinkCarpenterId('');
    setError(null);
    setFormOpen(true);
  }

  function openEdit(u: User) {
    setEditing(u);
    setName(u.name);
    setEmail(u.email);
    setPhone(u.phone ?? '');
    setPassword('');
    setRole(u.role);
    setIsActive(u.isActive);
    setLinkCarpenterId('');
    setError(null);
    setFormOpen(true);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (editing && editing.isActive && !isActive) {
      setPendingDeactivation(true);
      return;
    }

    await saveUser();
  }

  async function saveUser() {
    setError(null);
    setSubmitting(true);
    try {
      if (editing) {
        await api.patch(`/users/${editing.id}`, {
          name,
          email,
          phone: phone || undefined,
          role,
          isActive,
          ...(password ? { password } : {}),
        });
      } else {
        const created = await api.post<User>('/users', { name, email, phone: phone || undefined, password, role });
        if (linkCarpenterId) {
          await api.patch(`/carpenters/${linkCarpenterId}`, { userId: created.id });
        }
      }
      setFormOpen(false);
      setPendingDeactivation(false);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save user');
      setPendingDeactivation(false);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api.delete(`/users/${deleteTarget.id}`);
      setDeleteTarget(null);
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete user');
      setDeleteTarget(null);
    }
  }

  // Per-row password reveal: click the eye once -> fetches (their actual
  // current password whenever it's recoverable) and shows it in place;
  // click again -> just hides it back to dots, no re-fetch. Cached per
  // user id so toggling back and forth never re-hits the backend.
  async function togglePasswordVisible(u: User) {
    const existing = revealedPasswords[u.id];
    if (existing) {
      setRevealedPasswords((prev) => ({ ...prev, [u.id]: { ...existing, visible: !existing.visible } }));
      return;
    }
    setSharingError(null);
    setGeneratingPassword(true);
    try {
      const { password, isNew } = await api.post<{ password: string; isNew: boolean }>(`/users/${u.id}/generate-temp-password`);
      setRevealedPasswords((prev) => ({ ...prev, [u.id]: { password, isNew, visible: true } }));
      if (isNew) setTempPasswordBanner({ user: u, password, isNew });
    } catch (err) {
      setSharingError(err instanceof ApiError ? err.message : 'Failed to retrieve login credentials');
    } finally {
      setGeneratingPassword(false);
    }
  }

  // WhatsApp reuses whatever's already been revealed for this row (so what
  // gets sent is exactly what's shown) - fetches first only if it hasn't
  // been revealed yet this session.
  async function shareViaWhatsApp(u: User) {
    let entry = revealedPasswords[u.id];
    if (!entry) {
      setSharingError(null);
      setGeneratingPassword(true);
      try {
        const { password, isNew } = await api.post<{ password: string; isNew: boolean }>(`/users/${u.id}/generate-temp-password`);
        entry = { password, isNew, visible: true };
        setRevealedPasswords((prev) => ({ ...prev, [u.id]: entry! }));
        if (isNew) setTempPasswordBanner({ user: u, password, isNew });
      } catch (err) {
        setSharingError(err instanceof ApiError ? err.message : 'Failed to retrieve login credentials');
        return;
      } finally {
        setGeneratingPassword(false);
      }
    }
    openWhatsApp({
      recipientName: u.name,
      recipientPhone: u.phone ?? undefined,
      defaultMessage: buildCredentialsMessage(u, ROLE_LABEL[u.role], entry.password),
    });
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">Users & Roles</h1>
          <p className="text-sm text-brand-500 mt-1">
            Superadmin, Admin, Carpenter and Polisher accounts. Only Superadmin can manage users and roles.
          </p>
        </div>
        <button className="btn-primary" onClick={openCreate}>
          + New User
        </button>
      </div>

      {tempPasswordBanner && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm flex flex-wrap items-center justify-between gap-2">
          <div className="flex items-center gap-2">
            <span>
              {tempPasswordBanner.isNew ? 'New password' : 'Current password'} for{' '}
              <span className="font-medium">{tempPasswordBanner.user.name}</span>:
            </span>
            <PasswordInput className="input h-8 w-40 text-xs" readOnly value={tempPasswordBanner.password} />
          </div>
          <button className="text-xs text-brand-500 hover:underline" onClick={() => setTempPasswordBanner(null)}>
            Dismiss
          </button>
        </div>
      )}
      {sharingError && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 flex items-center justify-between">
          <span>{sharingError}</span>
          <button className="text-xs text-red-500 hover:underline" onClick={() => setSharingError(null)}>
            Dismiss
          </button>
        </div>
      )}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Users" value={String(data?.length ?? 0)} sub="Across 4 roles" />
        <StatCard label="Super Admins" value={String(data?.filter((u) => u.role === 'SUPERADMIN').length ?? 0)} sub="Full access" />
        <StatCard label="Admins" value={String(data?.filter((u) => u.role === 'ADMIN').length ?? 0)} sub="Operational" />
        <StatCard
          label="Production Team"
          value={String(data?.filter((u) => u.role === 'CARPENTER' || u.role === 'CARVER' || u.role === 'POLISHER').length ?? 0)}
          sub="Carpenter + Carving + Polish"
        />
      </div>

      <div className="card overflow-x-auto">
        <table className="table-shell">
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Password</th>
              <th>Role</th>
              <th>Status</th>
              <th>Joined</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="text-center py-8 text-brand-400">
                  Loading users...
                </td>
              </tr>
            )}
            {data?.map((u) => (
              <Fragment key={u.id}>
              <tr>
                <td className="font-medium">
                  {u.name}
                  {u.id === me?.id && <span className="ml-2 text-xs text-brand-400">(you)</span>}
                </td>
                <td>{u.email}</td>
                <td>
                  <div className="inline-flex items-center gap-1.5 font-mono text-xs">
                    <span>{revealedPasswords[u.id]?.visible ? revealedPasswords[u.id].password : '••••••••'}</span>
                    <button
                      type="button"
                      className="text-brand-400 hover:text-brand-700 disabled:opacity-50"
                      disabled={generatingPassword}
                      title={revealedPasswords[u.id]?.visible ? 'Hide password' : 'Show password'}
                      onClick={() => togglePasswordVisible(u)}
                    >
                      {revealedPasswords[u.id]?.visible ? '🙈' : '👁'}
                    </button>
                  </div>
                </td>
                <td>
                  <Chip color={ROLE_CHIP_COLOR[u.role]} label={ROLE_LABEL[u.role]} />
                </td>
                <td>{u.isActive ? <Chip color="green" label="Active" /> : <Chip color="red" label="Inactive" />}</td>
                <td>{formatDate(u.createdAt)}</td>
                <td className="space-x-2 whitespace-nowrap">
                  <button className="text-brand-600 hover:underline text-xs" onClick={() => openEdit(u)}>
                    Edit
                  </button>
                  {u.id !== me?.id && (
                    <button className="text-red-600 hover:underline text-xs" onClick={() => setDeleteTarget(u)}>
                      Delete
                    </button>
                  )}
                  <button
                    className="text-emerald-600 hover:underline text-xs disabled:opacity-50"
                    disabled={generatingPassword}
                    title="Share via WhatsApp"
                    onClick={() => shareViaWhatsApp(u)}
                  >
                    WhatsApp
                  </button>
                  <button
                    className="text-brand-600 hover:underline text-xs"
                    title="Change Password"
                    onClick={() => (passwordEditId === u.id ? setPasswordEditId(null) : startPasswordEdit(u))}
                  >
                    Password
                  </button>
                </td>
              </tr>
              {passwordEditId === u.id && (
                <tr>
                  <td colSpan={7} className="bg-brand-50">
                    <div className="flex flex-wrap items-center gap-2 py-1">
                      <span className="text-xs text-brand-500 whitespace-nowrap">New password for {u.name}:</span>
                      <PasswordInput
                        className="input h-8 w-44 text-xs"
                        autoFocus
                        minLength={6}
                        value={passwordEditValue}
                        onChange={(e) => setPasswordEditValue(e.target.value)}
                        onKeyDown={(e) => e.key === 'Enter' && savePasswordEdit(u)}
                      />
                      <button
                        className="btn-primary text-xs px-3 py-1.5"
                        disabled={passwordEditSubmitting}
                        onClick={() => savePasswordEdit(u)}
                      >
                        {passwordEditSubmitting ? 'Saving...' : 'Save'}
                      </button>
                      <button className="text-xs text-brand-500 hover:underline" onClick={() => setPasswordEditId(null)}>
                        Cancel
                      </button>
                      {passwordEditError && <span className="text-xs text-red-600">{passwordEditError}</span>}
                    </div>
                  </td>
                </tr>
              )}
              </Fragment>
            ))}
          </tbody>
        </table>
      </div>

      <PermissionMatrix />

      {formOpen && (
        <Modal title={editing ? `Edit ${editing.name}` : 'New User'} onClose={() => setFormOpen(false)}>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="label">Name</label>
              <input className="input" required value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div>
              <label className="label">Email</label>
              <input type="email" className="input" required value={email} onChange={(e) => setEmail(e.target.value)} />
            </div>
            <div>
              <label className="label">WhatsApp Number (optional)</label>
              <input type="tel" className="input" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="9876543210" />
              <p className="text-xs text-brand-400 mt-1">Used for the &quot;Share Credentials&quot; WhatsApp action.</p>
            </div>
            <div>
              <label className="label">{editing ? 'New Password (leave blank to keep current)' : 'Password'}</label>
              <PasswordInput
                className="input"
                required={!editing}
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div>
              <label className="label">Role</label>
              <select
                className="input"
                value={role}
                disabled={editing?.id === me?.id}
                onChange={(e) => {
                  setRole(e.target.value as Role);
                  setLinkCarpenterId('');
                }}
              >
                <option value="CARPENTER">Carpenter Team</option>
                <option value="CARVER">Carving Team</option>
                <option value="POLISHER">Polish Team</option>
                <option value="ADMIN">Admin</option>
                <option value="SUPERADMIN">Superadmin</option>
              </select>
              {editing?.id === me?.id && <p className="text-xs text-brand-400 mt-1">You cannot change your own role.</p>}
            </div>
            {!editing && PRODUCTION_ROLES.includes(role) && (
              <div>
                <label className="label">Link to Worker Profile (optional)</label>
                <select
                  className="input"
                  value={linkCarpenterId}
                  onChange={(e) => {
                    const id = e.target.value;
                    setLinkCarpenterId(id);
                    const worker = allCarpentersForRole.find((c) => c.id === id);
                    if (worker) {
                      setName(worker.name);
                      if (worker.phone) setPhone(worker.phone);
                    }
                  }}
                >
                  <option value="">Not now - link later from Production</option>
                  {allCarpentersForRole.map((c) => (
                    <option key={c.id} value={c.id} disabled={Boolean(c.user)}>
                      {c.name} {c.phone ? `(${c.phone})` : ''}
                      {c.user ? ' - already linked' : ''}
                    </option>
                  ))}
                </select>
                <p className="text-xs text-brand-400 mt-1">
                  Ties this login to their existing worker profile so their jobs show up on their My Work page. Every{' '}
                  {ROLE_LABEL[role]} worker is shown - one already linked to another login can&apos;t be picked again; create the
                  worker profile first in Production if it doesn&apos;t exist yet.
                </p>
              </div>
            )}
            {editing && (
              <label className="flex items-center gap-2 text-sm text-brand-600">
                <input
                  type="checkbox"
                  checked={isActive}
                  disabled={editing.id === me?.id}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                Active
              </label>
            )}
            {error && <p className="text-sm text-red-600">{error}</p>}
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" className="btn-secondary" onClick={() => setFormOpen(false)}>
                Cancel
              </button>
              <button type="submit" disabled={submitting} className="btn-primary">
                {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Create User'}
              </button>
            </div>
          </form>
        </Modal>
      )}

      {pendingDeactivation && editing && (
        <ConfirmDialog
          title="Deactivate User"
          message={`${editing.name} will immediately lose access and be signed out everywhere. Their past records (orders, payments, work items) stay unchanged and attributed to them. You can reactivate this account any time.`}
          confirmLabel="Deactivate"
          danger
          onConfirm={saveUser}
          onCancel={() => setPendingDeactivation(false)}
        />
      )}

      {deleteTarget && (
        <ConfirmDialog
          title="Delete User"
          message={`Delete ${deleteTarget.name} (${deleteTarget.email})? This cannot be undone.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}

      {showModal && whatsappOptions && (
        <WhatsAppModal
          onClose={closeWhatsApp}
          recipientInfo={{ name: whatsappOptions.recipientName, phone: whatsappOptions.recipientPhone }}
          defaultMessage={whatsappOptions.defaultMessage}
        />
      )}
    </div>
  );
}

export default function UsersPage() {
  return (
    <RoleGate minRole="SUPERADMIN">
      <UsersPageContent />
    </RoleGate>
  );
}
