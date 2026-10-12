'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import useSWR from 'swr';
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { fetcher } from '@/lib/swr';
import { getAccessToken } from '@/lib/api';
import { RoleGate } from '@/components/RoleGate';
import { InlineLoader } from '@/components/PageLoader';
import { StatusBadge } from '@/components/StatusBadge';
import { formatCurrency, formatDate } from '@/lib/format';
import type { DeliveryStatus } from '@/types';

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000/api';

// Chart colours - fixed meaning across the whole page (validated set:
// colour-blind safe on the white card surface). Text never uses them.
const C = {
  sales: '#2a78d6', // sales booked / customers / products
  moneyIn: '#1baf7a', // money received
  moneyOut: '#eb6834', // money paid out / what we owe
  production: '#6250d6', // production
};

interface Ranked {
  name: string;
  amount: number;
  channel?: string;
  orders?: number;
  kind?: string;
  qty?: number;
}

interface Overview {
  period: { from: string | null; to: string | null; bucket: 'day' | 'month' };
  sales: { total: number; retail: number; wholesale: number; orders: number; retailOrders: number; wholesaleOrders: number; averageOrder: number };
  moneyIn: { total: number; retail: number; wholesale: number };
  moneyOut: { total: number; suppliers: number; workers: number; expenses: number; breakdown: Ranked[] };
  cashLeft: number;
  toCollect: { total: number; parties: number; top: Ranked[] };
  toPay: { total: number; suppliers: number; workers: number; top: Ranked[] };
  production: { pieces: number; workValue: number; entries: number; topWorkers: { name: string; type: string; pieces: number; value: number }[] };
  trend: { period: string; sales: number; moneyIn: number; moneyOut: number }[];
  topBuyers: Ranked[];
  topProducts: Ranked[];
  orders: { id: string; date: string; channel: string; reference: string; party: string; value: number; received: number; balance: number; status: DeliveryStatus }[];
}

// ---- periods ---------------------------------------------------------------
type PeriodKey = 'this-month' | 'last-month' | 'last-3' | 'this-year' | 'all' | 'custom';
const PERIODS: { key: PeriodKey; label: string }[] = [
  { key: 'this-month', label: 'This month' },
  { key: 'last-month', label: 'Last month' },
  { key: 'last-3', label: 'Last 3 months' },
  { key: 'this-year', label: 'This year' },
  { key: 'all', label: 'All time' },
  { key: 'custom', label: 'Custom dates' },
];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function periodRange(key: PeriodKey, custom: { from: string; to: string }): { from: string; to: string } {
  const now = new Date();
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case 'this-month':
      return { from: iso(new Date(y, m, 1)), to: iso(now) };
    case 'last-month':
      return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
    case 'last-3':
      return { from: iso(new Date(y, m - 2, 1)), to: iso(now) };
    case 'this-year':
      return { from: iso(new Date(y, 0, 1)), to: iso(now) };
    case 'all':
      return { from: '', to: '' };
    default:
      return custom;
  }
}

// ₹ in Indian short form for axes: 1.2L, 3.4Cr, 45K.
function shortRupees(v: number) {
  const a = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (a >= 1e7) return `${sign}₹${(a / 1e7).toFixed(a >= 1e8 ? 0 : 1)}Cr`;
  if (a >= 1e5) return `${sign}₹${(a / 1e5).toFixed(a >= 1e6 ? 0 : 1)}L`;
  if (a >= 1e3) return `${sign}₹${(a / 1e3).toFixed(0)}K`;
  return `${sign}₹${a.toFixed(0)}`;
}
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function periodLabel(p: string, bucket: 'day' | 'month') {
  if (bucket === 'month') {
    const [y, mm] = p.split('-');
    return `${MONTHS[Number(mm) - 1]} ${y.slice(2)}`;
  }
  const [, mm, dd] = p.split('-');
  return `${Number(dd)} ${MONTHS[Number(mm) - 1]}`;
}

// ---- building blocks -------------------------------------------------------
function Kpi({ label, value, help, tone }: { label: string; value: string; help: React.ReactNode; tone?: 'good' | 'bad' }) {
  return (
    <div className="card p-4 flex flex-col gap-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">{label}</p>
      <p className={`text-2xl font-bold ${tone === 'good' ? 'text-emerald-700' : tone === 'bad' ? 'text-red-700' : 'text-ink'}`}>
        {tone === 'good' && <span aria-hidden className="mr-1 text-lg">▲</span>}
        {tone === 'bad' && <span aria-hidden className="mr-1 text-lg">▼</span>}
        {value}
      </p>
      <div className="text-xs text-ink-muted leading-relaxed">{help}</div>
    </div>
  );
}

function Panel({ title, subtitle, children, right }: { title: string; subtitle?: string; children: React.ReactNode; right?: React.ReactNode }) {
  return (
    <section className="card p-5">
      <div className="flex flex-wrap items-start justify-between gap-2 mb-4">
        <div>
          <h2 className="font-semibold text-brand-900">{title}</h2>
          {subtitle && <p className="text-xs text-ink-muted mt-0.5">{subtitle}</p>}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

// Ranked horizontal bars (one series): name on the left, bar, value on the
// right. Values are always printed, so the colour is never the only cue.
function RankedBars({ rows, color, valueFn, detailOf, empty }: { rows: Ranked[]; color: string; valueFn?: (r: Ranked) => number; detailOf?: (r: Ranked) => string; empty: string }) {
  const val = valueFn ?? ((r: Ranked) => r.amount);
  const max = Math.max(1, ...rows.map(val));
  if (rows.length === 0) return <p className="text-sm text-ink-muted py-6 text-center">{empty}</p>;
  return (
    <ul className="space-y-2.5">
      {rows.map((r, i) => (
        <li key={`${r.name}-${i}`} className="group" title={`${r.name}: ${formatCurrency(val(r))}${detailOf ? ` · ${detailOf(r)}` : ''}`}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="truncate text-ink">
              {r.name}
              {detailOf && <span className="text-xs text-ink-muted"> · {detailOf(r)}</span>}
            </span>
            <span className="font-semibold text-ink whitespace-nowrap">{formatCurrency(val(r))}</span>
          </div>
          <div className="mt-1 h-2.5 w-full rounded bg-brand-50">
            <div className="h-2.5 rounded-r transition-opacity group-hover:opacity-80" style={{ width: `${Math.max(2, (val(r) / max) * 100)}%`, background: color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// Retail vs wholesale share as one split bar with both values written out.
function SplitBar({ a, b }: { a: { label: string; value: number; sub: string }; b: { label: string; value: number; sub: string } }) {
  const total = a.value + b.value;
  const pa = total ? (a.value / total) * 100 : 50;
  return (
    <div>
      <div className="flex h-3 w-full gap-[2px] overflow-hidden rounded">
        <div style={{ width: `${pa}%`, background: C.sales }} />
        <div style={{ width: `${100 - pa}%`, background: '#9fc4f0' }} />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 text-sm">
        <div>
          <span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 align-middle" style={{ background: C.sales }} />
          <span className="text-ink-muted">{a.label}</span>
          <p className="font-semibold text-ink">
            {formatCurrency(a.value)} <span className="text-xs font-normal text-ink-muted">({total ? Math.round(pa) : 0}%) · {a.sub}</span>
          </p>
        </div>
        <div>
          <span className="inline-block w-2.5 h-2.5 rounded-sm mr-1.5 align-middle" style={{ background: '#9fc4f0' }} />
          <span className="text-ink-muted">{b.label}</span>
          <p className="font-semibold text-ink">
            {formatCurrency(b.value)} <span className="text-xs font-normal text-ink-muted">({total ? Math.round(100 - pa) : 0}%) · {b.sub}</span>
          </p>
        </div>
      </div>
    </div>
  );
}

function TrendTooltip({ active, payload, label }: { active?: boolean; payload?: { dataKey: string; value: number; color: string; name: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-brand-200 bg-white px-3 py-2 shadow-card text-xs">
      <p className="font-semibold text-ink mb-1">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="flex items-center gap-2 text-ink">
          <span className="inline-block w-2.5 h-[2px]" style={{ background: p.color }} />
          <span className="text-ink-muted">{p.name}</span>
          <span className="ml-auto font-semibold pl-3">{formatCurrency(p.value)}</span>
        </p>
      ))}
    </div>
  );
}

// ---- page -----------------------------------------------------------------
function ReportsContent() {
  const [periodKey, setPeriodKey] = useState<PeriodKey>('this-month');
  const [custom, setCustom] = useState({ from: '', to: '' });
  const [trendAsTable, setTrendAsTable] = useState(false);
  const [orderSearch, setOrderSearch] = useState('');
  const [orderChannel, setOrderChannel] = useState<'' | 'Retail' | 'Wholesale'>('');
  const range = periodRange(periodKey, custom);
  const qs = new URLSearchParams({ ...(range.from ? { from: range.from } : {}), ...(range.to ? { to: range.to } : {}) });
  const { data, isLoading } = useSWR<Overview>(`/reports/overview?${qs}`, fetcher, { keepPreviousData: true });

  const trend = useMemo(() => (data ? data.trend.map((t) => ({ ...t, label: periodLabel(t.period, data.period.bucket) })) : []), [data]);
  const orders = useMemo(() => {
    const q = orderSearch.trim().toUpperCase();
    return (data?.orders ?? []).filter((o) => (!orderChannel || o.channel === orderChannel) && (!q || `${o.reference} ${o.party}`.toUpperCase().includes(q)));
  }, [data, orderSearch, orderChannel]);

  async function exportCsv() {
    const token = getAccessToken();
    const res = await fetch(`${API_BASE_URL}/reports/sales/export?${new URLSearchParams({ ...Object.fromEntries(qs), channel: 'ALL' })}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });
    const url = URL.createObjectURL(await res.blob());
    const a = document.createElement('a');
    a.href = url;
    a.download = `sales-report${range.from ? `-${range.from}` : ''}${range.to ? `-to-${range.to}` : ''}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const periodText =
    periodKey === 'all' ? 'all time' : range.from && range.to ? `${formatDate(range.from)} – ${formatDate(range.to)}` : range.from ? `from ${formatDate(range.from)}` : range.to ? `up to ${formatDate(range.to)}` : 'all time';

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">Business Reports</h1>
          <p className="text-sm text-brand-500 mt-1">How the business is doing - sales, money in and out, and who owes what. Showing {periodText}.</p>
        </div>
        <button className="btn-secondary" onClick={exportCsv}>
          Export Orders (Excel/CSV)
        </button>
      </div>

      {/* Period picker - one row */}
      <div className="flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <button
            key={p.key}
            type="button"
            onClick={() => setPeriodKey(p.key)}
            className={`rounded-full px-3.5 py-1.5 text-sm border transition-colors ${
              periodKey === p.key ? 'bg-brand-700 border-brand-700 text-white' : 'bg-white border-brand-200 text-ink hover:border-brand-400'
            }`}
          >
            {p.label}
          </button>
        ))}
        {periodKey === 'custom' && (
          <div className="flex items-center gap-2">
            <input type="date" className="input !py-1.5 max-w-[160px]" value={custom.from} onChange={(e) => setCustom((c) => ({ ...c, from: e.target.value }))} />
            <span className="text-ink-muted text-sm">to</span>
            <input type="date" className="input !py-1.5 max-w-[160px]" value={custom.to} onChange={(e) => setCustom((c) => ({ ...c, to: e.target.value }))} />
          </div>
        )}
        {isLoading && <span className="text-xs text-ink-muted">Updating...</span>}
      </div>

      {!data ? (
        <InlineLoader />
      ) : (
        <>
          {/* Headline numbers */}
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
            <Kpi
              label="Sales booked"
              value={formatCurrency(data.sales.total)}
              help={
                <>
                  {data.sales.orders} order{data.sales.orders === 1 ? '' : 's'} taken in this period
                  {data.sales.orders > 0 && <> · average {formatCurrency(data.sales.averageOrder)}</>}
                </>
              }
            />
            <Kpi label="Money received" value={formatCurrency(data.moneyIn.total)} help={<>Collected from customers ({formatCurrency(data.moneyIn.retail)}) and shops ({formatCurrency(data.moneyIn.wholesale)})</>} />
            <Kpi
              label="Money paid out"
              value={formatCurrency(data.moneyOut.total)}
              help={
                <>
                  Suppliers {formatCurrency(data.moneyOut.suppliers)} · Workers {formatCurrency(data.moneyOut.workers)} · Expenses {formatCurrency(data.moneyOut.expenses)}
                </>
              }
            />
            <Kpi
              label="Cash left (in − out)"
              value={formatCurrency(data.cashLeft)}
              tone={data.cashLeft > 0 ? 'good' : data.cashLeft < 0 ? 'bad' : undefined}
              help={data.cashLeft >= 0 ? 'More money came in than went out' : 'More money went out than came in (often stock bought for later sales)'}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Kpi label="Still to collect" value={formatCurrency(data.toCollect.total)} help={<>Owed to us by {data.toCollect.parties} customer{data.toCollect.parties === 1 ? '' : 's'}/shop{data.toCollect.parties === 1 ? '' : 's'} - as of today, all orders</>} />
            <Kpi label="Still to pay" value={formatCurrency(data.toPay.total)} help={<>We owe suppliers {formatCurrency(data.toPay.suppliers)} and workers {formatCurrency(data.toPay.workers)} - as of today</>} />
          </div>

          {/* Trend */}
          <Panel
            title={`Sales and cash, ${data.period.bucket === 'day' ? 'day by day' : 'month by month'}`}
            subtitle="Hover over the chart to see the exact amounts for each period."
            right={
              <button type="button" className="btn-secondary text-xs px-3 py-1.5" onClick={() => setTrendAsTable((t) => !t)}>
                {trendAsTable ? 'Show chart' : 'Show as table'}
              </button>
            }
          >
            {trendAsTable ? (
              <div className="overflow-x-auto max-h-80">
                <table className="table-shell">
                  <thead>
                    <tr>
                      <th>{data.period.bucket === 'day' ? 'Day' : 'Month'}</th>
                      <th className="!text-right">Sales booked</th>
                      <th className="!text-right">Money received</th>
                      <th className="!text-right">Money paid out</th>
                    </tr>
                  </thead>
                  <tbody>
                    {trend.map((t) => (
                      <tr key={t.period}>
                        <td>{t.label}</td>
                        <td className="text-right">{formatCurrency(t.sales)}</td>
                        <td className="text-right">{formatCurrency(t.moneyIn)}</td>
                        <td className="text-right">{formatCurrency(t.moneyOut)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : trend.every((t) => !t.sales && !t.moneyIn && !t.moneyOut) ? (
              <p className="text-sm text-ink-muted py-10 text-center">No sales or payments in this period.</p>
            ) : (
              <div className="h-72">
                <div className="flex flex-wrap gap-4 text-xs text-ink mb-2" aria-label="Legend">
                  {[
                    { c: C.sales, l: 'Sales booked' },
                    { c: C.moneyIn, l: 'Money received' },
                    { c: C.moneyOut, l: 'Money paid out' },
                  ].map((x) => (
                    <span key={x.l} className="flex items-center gap-1.5">
                      <span className="inline-block w-4 h-[2px]" style={{ background: x.c }} />
                      {x.l}
                    </span>
                  ))}
                </div>
                <ResponsiveContainer width="100%" height="90%">
                  <LineChart data={trend} margin={{ top: 8, right: 12, left: 4, bottom: 0 }}>
                    <CartesianGrid stroke="#efede6" vertical={false} />
                    <XAxis dataKey="label" tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={{ stroke: '#e3e1d9' }} minTickGap={16} />
                    <YAxis tickFormatter={shortRupees} tick={{ fontSize: 11, fill: '#6b7280' }} tickLine={false} axisLine={false} width={56} />
                    <Tooltip content={<TrendTooltip />} cursor={{ stroke: '#c49a5a', strokeWidth: 1 }} />
                    <Line isAnimationActive={false} type="linear" dataKey="sales" name="Sales booked" stroke={C.sales} strokeWidth={2} dot={trend.length <= 15 ? { r: 4, strokeWidth: 2, stroke: '#fff' } : false} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} />
                    <Line isAnimationActive={false} type="linear" dataKey="moneyIn" name="Money received" stroke={C.moneyIn} strokeWidth={2} dot={trend.length <= 15 ? { r: 4, strokeWidth: 2, stroke: '#fff' } : false} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} />
                    <Line isAnimationActive={false} type="linear" dataKey="moneyOut" name="Money paid out" stroke={C.moneyOut} strokeWidth={2} dot={trend.length <= 15 ? { r: 4, strokeWidth: 2, stroke: '#fff' } : false} activeDot={{ r: 5, stroke: '#fff', strokeWidth: 2 }} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            )}
          </Panel>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
            <Panel title="Who owes us money" subtitle={`Top unpaid balances as of today · total ${formatCurrency(data.toCollect.total)}`}>
              <RankedBars rows={data.toCollect.top} color={C.sales} detailOf={(r) => `${r.channel} · ${r.orders} order${r.orders === 1 ? '' : 's'}`} empty="Nobody owes us anything right now." />
            </Panel>
            <Panel title="What we still have to pay" subtitle={`Suppliers and workers as of today · total ${formatCurrency(data.toPay.total)}`}>
              <RankedBars rows={data.toPay.top} color={C.moneyOut} detailOf={(r) => r.kind ?? ''} empty="Nothing pending - all suppliers and workers are paid." />
            </Panel>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
            <Panel title="Where the money went" subtitle={`Everything paid out in this period · ${formatCurrency(data.moneyOut.total)}`}>
              <RankedBars rows={data.moneyOut.breakdown} color={C.moneyOut} empty="No payments made in this period." />
            </Panel>
            <Panel title="Retail vs wholesale" subtitle="Share of sales booked in this period">
              {data.sales.total === 0 ? (
                <p className="text-sm text-ink-muted py-6 text-center">No orders in this period.</p>
              ) : (
                <SplitBar
                  a={{ label: 'Retail (customers)', value: data.sales.retail, sub: `${data.sales.retailOrders} orders` }}
                  b={{ label: 'Wholesale (shops)', value: data.sales.wholesale, sub: `${data.sales.wholesaleOrders} orders` }}
                />
              )}
              <div className="mt-6">
                <h3 className="text-sm font-semibold text-brand-900 mb-3">Best customers &amp; shops</h3>
                <RankedBars rows={data.topBuyers} color={C.sales} detailOf={(r) => `${r.channel} · ${r.orders} order${r.orders === 1 ? '' : 's'}`} empty="No orders in this period." />
              </div>
            </Panel>
          </div>

          <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 items-start">
            <Panel title="Best-selling products" subtitle="By order value in this period">
              <RankedBars rows={data.topProducts} color={C.sales} detailOf={(r) => `${r.qty} pc${r.qty === 1 ? '' : 's'}`} empty="No products sold in this period." />
            </Panel>
            <Panel title="Production" subtitle={`${data.production.pieces} piece${data.production.pieces === 1 ? '' : 's'} of work recorded · work value ${formatCurrency(data.production.workValue)}`}>
              <RankedBars
                rows={data.production.topWorkers.map((w) => ({ name: w.name, amount: w.value, qty: w.pieces, kind: w.type }))}
                color={C.production}
                detailOf={(r) => `${r.qty} pc${r.qty === 1 ? '' : 's'}`}
                empty="No production work recorded in this period."
              />
            </Panel>
          </div>

          {/* Orders */}
          <Panel title="Orders in this period" subtitle="Every order taken, newest first. Click a wholesale Job No. to open that order.">
            <div className="flex flex-wrap gap-2 mb-3">
              <input className="input !py-1.5 max-w-xs" placeholder="Search Job No. / customer / shop" value={orderSearch} onChange={(e) => setOrderSearch(e.target.value)} />
              <select className="input !py-1.5 max-w-[180px]" value={orderChannel} onChange={(e) => setOrderChannel(e.target.value as '' | 'Retail' | 'Wholesale')}>
                <option value="">Retail &amp; wholesale</option>
                <option value="Retail">Retail only</option>
                <option value="Wholesale">Wholesale only</option>
              </select>
              <span className="text-xs text-ink-muted self-center">
                {orders.length} order{orders.length === 1 ? '' : 's'} · value {formatCurrency(orders.reduce((s, o) => s + o.value, 0))} · unpaid {formatCurrency(orders.reduce((s, o) => s + Math.max(0, o.balance), 0))}
              </span>
            </div>
            <div className="overflow-x-auto max-h-[560px] rounded-lg border border-brand-100">
              <table className="table-shell [&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>Job No.</th>
                    <th>Customer / Shop</th>
                    <th>Type</th>
                    <th className="!text-right">Order value</th>
                    <th className="!text-right">Paid</th>
                    <th className="!text-right">Still to pay</th>
                    <th>Delivery</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.length === 0 && (
                    <tr>
                      <td colSpan={8} className="text-center py-8 text-brand-400">
                        No orders in this period.
                      </td>
                    </tr>
                  )}
                  {orders.map((o) => (
                    <tr key={`${o.channel}-${o.id}`}>
                      <td className="whitespace-nowrap">{formatDate(o.date)}</td>
                      <td className="font-medium">
                        {o.channel === 'Wholesale' ? (
                          <Link href={`/party-orders/${o.id}`} className="text-brand-700 hover:underline">
                            {o.reference}
                          </Link>
                        ) : (
                          o.reference
                        )}
                      </td>
                      <td>{o.party}</td>
                      <td>{o.channel}</td>
                      <td className="text-right">{formatCurrency(o.value)}</td>
                      <td className="text-right">{formatCurrency(o.received)}</td>
                      <td className={`text-right ${o.balance > 0 ? 'font-semibold text-ink' : 'text-ink-muted'}`}>{o.balance > 0 ? formatCurrency(o.balance) : 'Paid'}</td>
                      <td>
                        <StatusBadge status={o.status} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Panel>

          <p className="text-xs text-ink-muted">
            How these are worked out: <b>Sales booked</b> counts orders by order date (cancelled orders left out). <b>Money received / paid out</b> count payments by payment date. <b>Still to collect / to pay</b> are today&apos;s balances across all dates, the same as the order, supplier and worker pages.
          </p>
        </>
      )}
    </div>
  );
}

export default function ReportsPage() {
  return (
    <RoleGate minRole="SUPERADMIN">
      <ReportsContent />
    </RoleGate>
  );
}
