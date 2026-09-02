'use client';

import { useState } from 'react';
import { Modal } from './Modal';

export function UpdateModelNoModal({
  title,
  currentModelNo,
  onClose,
  onSubmit,
}: {
  title: string;
  currentModelNo?: string | null;
  onClose: () => void;
  onSubmit: (modelNo: string) => Promise<void>;
}) {
  const [modelNo, setModelNo] = useState(currentModelNo ?? '');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = modelNo.trim();
    if (!trimmed) {
      setError('Model No cannot be empty');
      return;
    }
    setError(null);
    setSubmitting(true);
    try {
      await onSubmit(trimmed);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save Model No');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Modal title={title} onClose={onClose}>
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="label">Model No</label>
          <input
            className="input"
            required
            autoFocus
            value={modelNo}
            onChange={(e) => setModelNo(e.target.value)}
            placeholder="e.g. 220 or Z-220-BC"
          />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        <div className="flex justify-end gap-2 pt-2">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" disabled={submitting} className="btn-primary">
            {submitting ? 'Saving...' : 'Save Model No'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
