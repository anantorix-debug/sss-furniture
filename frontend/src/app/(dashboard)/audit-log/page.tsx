'use client';

import { useState } from 'react';
import useSWR from 'swr';
import { fetcher } from '@/lib/swr';
import { RoleGate } from '@/components/RoleGate';
import { formatDate } from '@/lib/format';
import type { AuditLogEntry } from '@/types';
import { Pagination, type PaginatedResult } from '@/components/Pagination';

const ACTION_LABEL: Record<string, string> = {
  LOGIN_SUCCESS: 'Login succeeded',
  LOGIN_FAILED: 'Login failed',
  PASSWORD_CHANGED: 'Password changed',
  PASSWORD_RESET_BY_ADMIN: 'Password reset by admin',
  USER_CREATED: 'User created',
  ROLE_CHANGED: 'Role changed',
  USER_DEACTIVATED: 'User deactivated',
  USER_ACTIVATED: 'User activated',
  USER_DELETED: 'User deleted',
};

function AuditLogContent() {
  const [action, setAction] = useState('');
  const [page, setPage] = useState(1);
  const { data: result, isLoading } = useSWR<PaginatedResult<AuditLogEntry>>(
    `/audit-logs?${new URLSearchParams({ ...(action ? { action } : {}), page: String(page), limit: '20' })}`,
    fetcher,
  );
  const data = result?.data;
  function updateAction(value: string) {
    setAction(value);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-brand-900">Audit Log</h1>
        <p className="text-sm text-brand-500 mt-1">Security-sensitive events: logins, password changes, role and access changes.</p>
      </div>

      <select className="input max-w-xs" value={action} onChange={(e) => updateAction(e.target.value)}>
        <option value="">All actions</option>
        {Object.entries(ACTION_LABEL).map(([value, label]) => (
          <option key={value} value={value}>
            {label}
          </option>
        ))}
      </select>

      <div className="card overflow-x-auto">
        <table className="table-shell">
          <thead>
            <tr>
              <th>When</th>
              <th>Action</th>
              <th>Actor</th>
              <th>Target</th>
              <th>Details</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={5} className="text-center py-8 text-brand-400">
                  Loading audit log...
                </td>
              </tr>
            )}
            {!isLoading && data?.length === 0 && (
              <tr>
                <td colSpan={5} className="text-center py-8 text-brand-400">
                  No events recorded yet
                </td>
              </tr>
            )}
            {data?.map((entry) => (
              <tr key={entry.id}>
                <td>{formatDate(entry.createdAt)}</td>
                <td className="font-medium">{ACTION_LABEL[entry.action] ?? entry.action}</td>
                <td>{entry.userEmail ?? '-'}</td>
                <td className="text-brand-500">{entry.targetType ? `${entry.targetType} ${entry.targetId?.slice(0, 8)}` : '-'}</td>
                <td className="text-brand-500 max-w-[280px] truncate">{entry.metadata ? JSON.stringify(entry.metadata) : '-'}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {result && (
          <Pagination page={result.page} totalPages={result.totalPages} total={result.total} limit={result.limit} onPageChange={setPage} />
        )}
      </div>
    </div>
  );
}

export default function AuditLogPage() {
  return (
    <RoleGate minRole="SUPERADMIN">
      <AuditLogContent />
    </RoleGate>
  );
}
