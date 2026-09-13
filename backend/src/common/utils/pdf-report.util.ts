// Small shared building blocks for the "filtered list" PDF reports (Material
// Movement History, Suppliers, Purchase Orders, Party Orders) - not a new
// PDF engine/abstraction, just the header/filter-summary/CSS boilerplate
// every one of those reports needs, in one place instead of copy-pasted
// per service (mirrors the shape already proven by PaymentsService.buildPdfHtml).

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

// Shared <style> block - same visual language as the existing Payments PDF.
export const REPORT_PDF_STYLES = `
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2933; margin: 0; }
  .header { background: #80011f; color: #fff; padding: 24px 28px; }
  .header h1 { margin: 0; font-size: 20px; }
  .header p { margin: 4px 0 0; font-size: 12px; color: #f5c2c9; }
  .body { padding: 24px 28px; }
  .summary { display: flex; gap: 20px; margin-bottom: 18px; flex-wrap: wrap; }
  .summary div { flex: 1; min-width: 120px; border: 1px solid #e3e1d9; border-radius: 8px; padding: 10px 14px; }
  .summary .label { font-size: 10.5px; text-transform: uppercase; letter-spacing: 0.5px; color: #6b7280; }
  .summary .value { font-size: 16px; font-weight: bold; margin-top: 2px; }
  .filters { font-size: 11.5px; color: #6b7280; margin-bottom: 14px; }
  table { width: 100%; border-collapse: collapse; font-size: 11.5px; }
  th { background: #f4f2ec; text-align: left; padding: 7px 9px; border-bottom: 1px solid #e3e1d9; }
  td { padding: 7px 9px; border-bottom: 1px solid #efede6; }
  .generated { margin-top: 18px; font-size: 10.5px; color: #9ca3af; }
`;

// The "SSS Company" branded title bar every report opens with.
export function renderReportHeader(title: string): string {
  return `<div class="header"><h1>${escapeHtml(title)}</h1><p>SSS Company</p></div>`;
}

// The "Applied Filters" line - only the filters actually set are shown,
// labelled with whatever the caller passes (e.g. { 'Date From': '01 Sep
// 2026', Employee: 'Ravi' }). Renders nothing when no filters are active.
export function renderFilterSummary(filters: Record<string, string | undefined | null>): string {
  const parts = Object.entries(filters)
    .filter(([, v]) => v != null && v !== '')
    .map(([k, v]) => `${escapeHtml(k)}: ${escapeHtml(String(v))}`);
  if (parts.length === 0) return '';
  return `<div class="filters"><strong>Filters:</strong> ${parts.join(' &middot; ')}</div>`;
}

export function renderGeneratedFooter(count: number, noun: string): string {
  return `<div class="generated">Generated ${new Date().toLocaleString('en-IN')} - ${count} ${noun}${count === 1 ? '' : 's'}</div>`;
}
