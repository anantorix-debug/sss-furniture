'use client';

import { useState } from 'react';
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
import { formatDate } from '@/lib/format';
import type { User, Role } from '@/types';

const ROLE_LABEL: Record<Role, string> = {
  SUPERADMIN: 'Super Admin',
  ADMIN: 'Admin',
  CARPENTER: 'Carpenter Team',
  POLISHER: 'Polish Team',
};
const ROLE_CHIP_COLOR: Record<Role, ChipColor> = {
  SUPERADMIN: 'darkGreen',
  ADMIN: 'blue',
  CARPENTER: 'amber',
  POLISHER: 'gray',
};

function UsersPageContent() {
  const { user: me } = useAuth();
  const { data, isLoading, mutate } = useSWR<User[]>('/users', fetcher);

  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<User | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<Role>('CARPENTER');
  const [isActive, setIsActive] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<User | null>(null);
  const [pendingDeactivation, setPendingDeactivation] = useState(false);

  function openCreate() {
    setEditing(null);
    setName('');
    setEmail('');
    setPassword('');
    setRole('CARPENTER');
    setIsActive(true);
    setError(null);
    setFormOpen(true);
  }

  function openEdit(u: User) {
    setEditing(u);
    setName(u.name);
    setEmail(u.email);
    setPassword('');
    setRole(u.role);
    setIsActive(u.isActive);
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
          role,
          isActive,
          ...(password ? { password } : {}),
        });
      } else {
        await api.post('/users', { name, email, password, role });
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

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <StatCard label="Total Users" value={String(data?.length ?? 0)} sub="Across 4 roles" />
        <StatCard label="Super Admins" value={String(data?.filter((u) => u.role === 'SUPERADMIN').length ?? 0)} sub="Full access" />
        <StatCard label="Admins" value={String(data?.filter((u) => u.role === 'ADMIN').length ?? 0)} sub="Operational" />
        <StatCard
          label="Production Team"
          value={String(data?.filter((u) => u.role === 'CARPENTER' || u.role === 'POLISHER').length ?? 0)}
          sub="Carpenter + Polish"
        />
      </div>

      <div className="card overflow-x-auto">
        <table className="table-shell">
          <thead>
            <tr>
              <th>User</th>
              <th>Email</th>
              <th>Role</th>
              <th>Status</th>
              <th>Joined</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="text-center py-8 text-brand-400">
                  Loading users...
                </td>
              </tr>
            )}
            {data?.map((u) => (
              <tr key={u.id}>
                <td className="font-medium">
                  {u.name}
                  {u.id === me?.id && <span className="ml-2 text-xs text-brand-400">(you)</span>}
                </td>
                <td>{u.email}</td>
                <td>
                  <Chip color={ROLE_CHIP_COLOR[u.role]} label={ROLE_LABEL[u.role]} />
                </td>
                <td>{u.isActive ? <Chip color="green" label="Active" /> : <Chip color="red" label="Inactive" />}</td>
                <td>{formatDate(u.createdAt)}</td>
                <td className="space-x-2">
                  <button className="text-brand-600 hover:underline text-xs" onClick={() => openEdit(u)}>
                    Edit
                  </button>
                  {u.id !== me?.id && (
                    <button className="text-red-600 hover:underline text-xs" onClick={() => setDeleteTarget(u)}>
                      Delete
                    </button>
                  )}
                </td>
              </tr>
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
              <label className="label">{editing ? 'New Password (leave blank to keep current)' : 'Password'}</label>
              <input
                type="password"
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
                onChange={(e) => setRole(e.target.value as Role)}
              >
                <option value="CARPENTER">Carpenter Team</option>
                <option value="POLISHER">Polish Team</option>
                <option value="ADMIN">Admin</option>
                <option value="SUPERADMIN">Superadmin</option>
              </select>
              {editing?.id === me?.id && <p className="text-xs text-brand-400 mt-1">You cannot change your own role.</p>}
            </div>
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
