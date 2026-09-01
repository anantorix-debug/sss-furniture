import { Chip, type ChipColor } from './StatusBadge';

const LEVEL_LABEL = {
  full: 'Full',
  limited: 'Limited',
  read: 'View only',
  none: 'No access',
} as const;

type Level = keyof typeof LEVEL_LABEL;

const LEVEL_COLOR: Record<Level, ChipColor> = {
  full: 'green',
  limited: 'amber',
  read: 'blue',
  none: 'gray',
};

interface Row {
  module: string;
  superadmin: Level;
  admin: Level;
  employee: Level;
}

// Mirrors the @Roles() guards actually enforced by the API controllers -
// this is documentation of real behavior, not aspirational.
const ROWS: Row[] = [
  { module: 'Customer Orders (create / edit)', superadmin: 'full', admin: 'full', employee: 'limited' },
  { module: 'Customer Orders (delete)', superadmin: 'full', admin: 'full', employee: 'none' },
  { module: 'Party Orders (create / edit)', superadmin: 'full', admin: 'full', employee: 'limited' },
  { module: 'Party Orders (delete)', superadmin: 'full', admin: 'full', employee: 'none' },
  { module: 'All Payments (record / delete)', superadmin: 'full', admin: 'full', employee: 'read' },
  { module: 'Suppliers & Purchase Ledger', superadmin: 'full', admin: 'full', employee: 'read' },
  { module: 'Raw Materials (definitions, stock-in, adjustments)', superadmin: 'full', admin: 'full', employee: 'read' },
  { module: 'Raw Materials (issue to a work item)', superadmin: 'full', admin: 'full', employee: 'limited' },
  { module: 'Carpenter Work Assignment', superadmin: 'full', admin: 'full', employee: 'limited' },
  { module: 'Carpenter Payments', superadmin: 'full', admin: 'full', employee: 'read' },
  { module: 'Users & Role Management', superadmin: 'full', admin: 'none', employee: 'none' },
  { module: 'WhatsApp Settings', superadmin: 'full', admin: 'full', employee: 'none' },
];

export function PermissionMatrix() {
  return (
    <div className="card overflow-hidden">
      <div className="px-4 py-3.5 border-b border-brand-100">
        <p className="font-medium text-ink text-sm">Roles & Permission Matrix</p>
        <p className="text-ink-muted text-xs mt-0.5">What each role can actually do - enforced server-side, not just hidden in the UI.</p>
      </div>
      <div className="overflow-x-auto">
        <table className="table-shell">
          <thead>
            <tr>
              <th>Module</th>
              <th>Superadmin</th>
              <th>Admin</th>
              <th>Employee</th>
            </tr>
          </thead>
          <tbody>
            {ROWS.map((row) => (
              <tr key={row.module}>
                <td className="whitespace-normal max-w-xs">{row.module}</td>
                <td>
                  <Chip color={LEVEL_COLOR[row.superadmin]} label={LEVEL_LABEL[row.superadmin]} />
                </td>
                <td>
                  <Chip color={LEVEL_COLOR[row.admin]} label={LEVEL_LABEL[row.admin]} />
                </td>
                <td>
                  <Chip color={LEVEL_COLOR[row.employee]} label={LEVEL_LABEL[row.employee]} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
