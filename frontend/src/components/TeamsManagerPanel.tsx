'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { ConfirmDialog } from './ConfirmDialog';
import type { ProductionTeam, WorkerType } from '@/types';

const WORKER_TYPE_LABEL: Record<WorkerType, string> = {
  CARPENTER: 'Carpenter',
  POLISHER: 'Polisher',
  CARVER: 'Carving Man',
};

const emptyForm = { name: '', headName: '', workerType: 'CARPENTER' as WorkerType, groupId: '', groupName: '' };

// Named worker groupings within one category (e.g. two independent
// Carpenter crews) - each can have its own WhatsApp group, so a work
// assignment notifies the right crew instead of one shared group per
// category. Workers get assigned to a team from the worker form itself.
// Panel-only (no Modal/close button of its own) so it can live as a tab
// inside the combined Workers & Teams modal, sharing one entry point.
export function TeamsManagerPanel({ onChange }: { onChange: () => void }) {
  const { data: teams, mutate } = useSWR<ProductionTeam[]>('/production-teams', fetcher);
  const [form, setForm] = useState(emptyForm);
  const [editing, setEditing] = useState<ProductionTeam | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<ProductionTeam | null>(null);

  function startEdit(team: ProductionTeam) {
    setEditing(team);
    setForm({ name: team.name, headName: team.headName ?? '', workerType: team.workerType, groupId: team.groupId ?? '', groupName: team.groupName ?? '' });
    setError(null);
  }

  function startCreate() {
    setEditing(null);
    setForm(emptyForm);
    setError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      const payload = {
        name: form.name,
        headName: form.headName || undefined,
        workerType: form.workerType,
        groupId: form.groupId || undefined,
        groupName: form.groupName || undefined,
      };
      if (editing) {
        await api.patch(`/production-teams/${editing.id}`, payload);
      } else {
        await api.post('/production-teams', payload);
      }
      startCreate();
      mutate();
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to save team');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDelete() {
    if (!deleteTarget) return;
    try {
      await api.delete(`/production-teams/${deleteTarget.id}`);
      setDeleteTarget(null);
      mutate();
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to delete team');
      setDeleteTarget(null);
    }
  }

  return (
    <div className="space-y-4">
      <p className="text-xs text-brand-400">
        Split a category into multiple crews (e.g. two Carpenter teams) - each can have its own WhatsApp group, so a work
        assignment notifies the right crew instead of one shared group for the whole category.
      </p>

      <div className="border border-brand-100 rounded-lg divide-y divide-brand-100 max-h-64 overflow-y-auto">
        {(teams ?? []).length === 0 && <p className="text-sm text-brand-400 p-3">No teams yet - every worker is in the shared pool for their category.</p>}
        {teams?.map((team) => (
          <div key={team.id} className="flex items-center justify-between gap-3 p-3">
            <div>
              <p className="text-sm font-medium text-brand-900">
                {team.name} <span className="text-xs text-brand-400 font-normal">({WORKER_TYPE_LABEL[team.workerType]})</span>
              </p>
              <p className="text-xs text-brand-400">
                {team.headName ? `Head: ${team.headName} · ` : ''}
                {team.workers?.length ?? 0} worker{team.workers?.length === 1 ? '' : 's'}
                {team.groupName ? ` · WhatsApp: ${team.groupName}` : ''}
              </p>
            </div>
            <div className="flex gap-3 shrink-0">
              <button type="button" className="text-brand-600 hover:underline text-xs" onClick={() => startEdit(team)}>
                Edit
              </button>
              <button type="button" className="text-red-500 hover:underline text-xs" onClick={() => setDeleteTarget(team)}>
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="border-t border-brand-100 pt-4 space-y-3">
        <h3 className="text-sm font-semibold text-brand-900">{editing ? `Edit "${editing.name}"` : 'New Team'}</h3>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">Team Name</label>
            <input className="input" required value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="Carpenter Team A" />
          </div>
          <div>
            <label className="label">Category</label>
            <select className="input" value={form.workerType} onChange={(e) => setForm((f) => ({ ...f, workerType: e.target.value as WorkerType }))}>
              <option value="CARPENTER">Carpenter</option>
              <option value="CARVER">Carving Man</option>
              <option value="POLISHER">Polisher</option>
            </select>
          </div>
        </div>
        <div>
          <label className="label">Team Head Name (optional)</label>
          <input className="input" value={form.headName} onChange={(e) => setForm((f) => ({ ...f, headName: e.target.value }))} placeholder="e.g. Ramesh" />
          <p className="text-[11px] text-brand-400 mt-1">Who leads this crew - shown alongside the team so it's clear who to check with.</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="label">WhatsApp Group ID (optional)</label>
            <input className="input" value={form.groupId} onChange={(e) => setForm((f) => ({ ...f, groupId: e.target.value }))} placeholder="1234567890-1234567890@g.us" />
          </div>
          <div>
            <label className="label">Group Name (optional, for display)</label>
            <input className="input" value={form.groupName} onChange={(e) => setForm((f) => ({ ...f, groupName: e.target.value }))} placeholder="Carpenter Team A Group" />
          </div>
        </div>
        <p className="text-[11px] text-brand-400">
          Leave the WhatsApp fields blank to fall back to the category-wide group set in WhatsApp Settings.
        </p>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2">
          {editing && (
            <button type="button" className="btn-secondary" onClick={startCreate}>
              Cancel Edit
            </button>
          )}
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Saving...' : editing ? 'Save Changes' : 'Add Team'}
          </button>
        </div>
      </form>

      {deleteTarget && (
        <ConfirmDialog
          title="Delete Team"
          message={`Delete "${deleteTarget.name}"? Its workers stay - they'll just have no team until reassigned.`}
          confirmLabel="Delete"
          danger
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}
