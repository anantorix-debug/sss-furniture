'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { api, ApiError } from '@/lib/api';
import { Chip } from '@/components/StatusBadge';
import type { ExpenseCategory, ExpenseReferenceType, ExpensePaymentMode, ExpenseScope } from '@/types';

type ConfigTab = 'categories' | 'reference' | 'modes';

export function ExpenseSettingsTab() {
  const [tab, setTab] = useState<ConfigTab>('categories');

  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-lg font-semibold text-brand-900">Settings</h2>
        <p className="text-sm text-brand-500">
          Categories, reference codes, and payment modes are fully editable - add your own as the business&apos;s tracking needs change.
        </p>
      </div>

      <div className="flex gap-1 border-b border-brand-200">
        {([
          ['categories', 'Categories'],
          ['reference', 'Reference Codes'],
          ['modes', 'Payment Modes'],
        ] as [ConfigTab, string][]).map(([value, label]) => (
          <button
            key={value}
            onClick={() => setTab(value)}
            className={`px-4 py-2.5 text-sm font-medium border-b-2 -mb-px transition-colors ${
              tab === value ? 'border-brand-700 text-brand-900' : 'border-transparent text-ink-muted hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === 'categories' && <CategoriesPanel />}
      {tab === 'reference' && <ReferenceTypesPanel />}
      {tab === 'modes' && <PaymentModesPanel />}
    </div>
  );
}

function CategoriesPanel() {
  const { data: categories, mutate } = useSWR<ExpenseCategory[]>('/expense-config/categories?includeInactive=true', fetcher);
  const { data: referenceTypes } = useSWR<ExpenseReferenceType[]>('/expense-config/reference-types', fetcher);
  const [name, setName] = useState('');
  const [scope, setScope] = useState<ExpenseScope | ''>('');
  const [defaultReferenceTypeId, setDefaultReferenceTypeId] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/expense-config/categories', {
        name,
        scope: scope || undefined,
        defaultReferenceTypeId: defaultReferenceTypeId || undefined,
      });
      setName('');
      setScope('');
      setDefaultReferenceTypeId('');
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create category');
    }
  }

  async function toggleActive(cat: ExpenseCategory) {
    await api.patch(`/expense-config/categories/${cat.id}`, { isActive: !cat.isActive });
    mutate();
  }

  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto">
        <table className="table-shell">
          <thead>
            <tr>
              <th>Name</th>
              <th>Scope</th>
              <th>Default Reference</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {categories?.map((c) => (
              <tr key={c.id}>
                <td className="font-medium">{c.name}</td>
                <td>{c.scope ? <Chip color={c.scope === 'COMPANY' ? 'blue' : 'darkGreen'} label={c.scope} /> : <span className="text-brand-400">Either</span>}</td>
                <td>{c.defaultReferenceType ? `${c.defaultReferenceType.code} - ${c.defaultReferenceType.label}` : '-'}</td>
                <td>{c.isActive ? <Chip color="green" label="Active" /> : <Chip color="gray" label="Disabled" />}</td>
                <td className="text-right">
                  <button className="text-brand-600 hover:underline text-xs" onClick={() => toggleActive(c)}>
                    {c.isActive ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={handleCreate} className="card p-4 grid grid-cols-1 sm:grid-cols-4 gap-2 items-end">
        <div>
          <label className="label">New Category</label>
          <input className="input" required placeholder="e.g. Rent" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <div>
          <label className="label">Scope</label>
          <select className="input" value={scope} onChange={(e) => setScope(e.target.value as ExpenseScope | '')}>
            <option value="">Either</option>
            <option value="COMPANY">Company only</option>
            <option value="PERSONAL">Personal only</option>
          </select>
        </div>
        <div>
          <label className="label">Default Reference</label>
          <select className="input" value={defaultReferenceTypeId} onChange={(e) => setDefaultReferenceTypeId(e.target.value)}>
            <option value="">-</option>
            {referenceTypes?.map((r) => (
              <option key={r.id} value={r.id}>
                {r.code} - {r.label}
              </option>
            ))}
          </select>
        </div>
        <button type="submit" className="btn-primary h-[38px]">
          Add Category
        </button>
        {error && <p className="text-sm text-red-600 col-span-full">{error}</p>}
      </form>
    </div>
  );
}

function ReferenceTypesPanel() {
  const { data: refs, mutate } = useSWR<ExpenseReferenceType[]>('/expense-config/reference-types?includeInactive=true', fetcher);
  const [code, setCode] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/expense-config/reference-types', { code: code.toUpperCase(), label });
      setCode('');
      setLabel('');
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create reference code');
    }
  }

  async function toggleActive(r: ExpenseReferenceType) {
    await api.patch(`/expense-config/reference-types/${r.id}`, { isActive: !r.isActive });
    mutate();
  }

  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto">
        <table className="table-shell">
          <thead>
            <tr>
              <th>Code</th>
              <th>Label</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {refs?.map((r) => (
              <tr key={r.id}>
                <td className="font-mono font-medium">{r.code}</td>
                <td>{r.label}</td>
                <td>{r.isActive ? <Chip color="green" label="Active" /> : <Chip color="gray" label="Disabled" />}</td>
                <td className="text-right">
                  <button className="text-brand-600 hover:underline text-xs" onClick={() => toggleActive(r)}>
                    {r.isActive ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={handleCreate} className="card p-4 grid grid-cols-1 sm:grid-cols-3 gap-2 items-end">
        <div>
          <label className="label">Code</label>
          <input className="input" required placeholder="e.g. RNT" maxLength={6} value={code} onChange={(e) => setCode(e.target.value)} />
        </div>
        <div>
          <label className="label">Label</label>
          <input className="input" required placeholder="e.g. Rent" value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary h-[38px]">
          Add Reference Code
        </button>
        {error && <p className="text-sm text-red-600 col-span-full">{error}</p>}
      </form>
    </div>
  );
}

function PaymentModesPanel() {
  const { data: modes, mutate } = useSWR<ExpensePaymentMode[]>('/expense-config/payment-modes?includeInactive=true', fetcher);
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    try {
      await api.post('/expense-config/payment-modes', { name });
      setName('');
      mutate();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Failed to create payment mode');
    }
  }

  async function toggleActive(m: ExpensePaymentMode) {
    await api.patch(`/expense-config/payment-modes/${m.id}`, { isActive: !m.isActive });
    mutate();
  }

  return (
    <div className="space-y-4">
      <div className="card overflow-x-auto">
        <table className="table-shell">
          <thead>
            <tr>
              <th>Name</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {modes?.map((m) => (
              <tr key={m.id}>
                <td className="font-medium">{m.name}</td>
                <td>{m.isActive ? <Chip color="green" label="Active" /> : <Chip color="gray" label="Disabled" />}</td>
                <td className="text-right">
                  <button className="text-brand-600 hover:underline text-xs" onClick={() => toggleActive(m)}>
                    {m.isActive ? 'Disable' : 'Enable'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <form onSubmit={handleCreate} className="card p-4 flex gap-2 items-end">
        <div className="flex-1">
          <label className="label">New Payment Mode</label>
          <input className="input" required placeholder="e.g. UPI-SBI" value={name} onChange={(e) => setName(e.target.value)} />
        </div>
        <button type="submit" className="btn-primary h-[38px]">
          Add
        </button>
      </form>
      {error && <p className="text-sm text-red-600">{error}</p>}
    </div>
  );
}
