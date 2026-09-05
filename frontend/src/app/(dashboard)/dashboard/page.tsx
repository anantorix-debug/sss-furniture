'use client';

import { useEffect, useMemo, useState } from 'react';
import useSWR from 'swr';
import {
  ResponsiveContainer,
  LineChart,
  Line,
  BarChart,
  Bar,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from 'recharts';
import { fetcher } from '@/lib/swr';
import { StatCard } from '@/components/StatCard';
import { formatCurrency } from '@/lib/format';
import { useAuth } from '@/context/AuthContext';
import type { DashboardSummary, DashboardTrendPoint, ProductionDashboard } from '@/types';

// Same dot-chip palette used across the app's StatusBadge, so chart colors
// match everything else instead of introducing a new, unrelated scheme.
const COLORS = {
  maroon: '#8a1f2b',
  gold: '#8a6100',
  green: '#2e7d32',
  darkGreen: '#1f5c45',
  blue: '#1565c0',
  red: '#b42318',
  gray: '#6b7280',
};

function formatDayLabel(dateStr: string) {
  const d = new Date(dateStr + 'T00:00:00');
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

// --- Widgets -----------------------------------------------------------

function OverviewWidget({ data }: { data: DashboardSummary }) {
  return (
    <div className="space-y-6">
      <section>
        <h3 className="text-xs font-semibold text-brand-700 uppercase tracking-wide mb-3">Customer Orders</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Orders" value={String(data.customerOrders.count)} />
          <StatCard label="Pending Delivery" value={String(data.customerOrders.pending)} accent="warning" />
          <StatCard label="Delivered" value={String(data.customerOrders.delivered)} accent="success" />
          <StatCard label="Outstanding Balance" value={formatCurrency(data.customerOrders.totalBalance)} accent="warning" />
        </div>
      </section>
      <section>
        <h3 className="text-xs font-semibold text-brand-700 uppercase tracking-wide mb-3">Party Orders</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Total Orders" value={String(data.partyOrders.count)} />
          <StatCard label="Pending Delivery" value={String(data.partyOrders.pending)} accent="warning" />
          <StatCard label="Delivered" value={String(data.partyOrders.delivered)} accent="success" />
          <StatCard label="Outstanding Balance" value={formatCurrency(data.partyOrders.totalBalance)} accent="warning" />
        </div>
      </section>
      <section>
        <h3 className="text-xs font-semibold text-brand-700 uppercase tracking-wide mb-3">Suppliers</h3>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="Suppliers" value={String(data.suppliers.count)} />
          <StatCard label="Total Purchases" value={formatCurrency(data.suppliers.totalPurchaseValue)} />
          <StatCard label="Total Paid" value={formatCurrency(data.suppliers.totalPaid)} accent="success" />
          <StatCard label="Payable Balance" value={formatCurrency(data.suppliers.totalBalance)} accent="warning" />
        </div>
      </section>
    </div>
  );
}

function ProductionWidget() {
  const { data, isLoading } = useSWR<ProductionDashboard>('/carpenter-work-items/dashboard', fetcher, { refreshInterval: 60000 });
  if (isLoading || !data) return <p className="text-brand-400 text-sm">Loading...</p>;
  return (
    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
      <StatCard label="Active Workers" value={String(data.kpis.activeWorkers)} />
      <StatCard label="Jobs In Progress" value={String(data.kpis.jobsInProgress)} accent="warning" />
      <StatCard label="Ready for Verification" value={String(data.kpis.readyForVerification)} accent="success" />
      <StatCard label="Completed Today" value={String(data.kpis.completedToday)} accent="success" />
      <StatCard label="Carpenter Pending" value={String(data.kpis.pendingByStage.CARPENTER)} />
      <StatCard label="Carving Pending" value={String(data.kpis.pendingByStage.CARVING)} />
      <StatCard label="Polish Pending" value={String(data.kpis.pendingByStage.POLISH)} />
      <StatCard label="Materials Used Today" value={String(data.kpis.materialsUsedToday)} />
    </div>
  );
}

function useTrends() {
  return useSWR<DashboardTrendPoint[]>('/dashboard/trends?days=14', fetcher);
}

function OrderTrendsChart() {
  const { data, isLoading } = useTrends();
  if (isLoading || !data) return <p className="text-brand-400 text-sm">Loading...</p>;
  const chartData = data.map((d) => ({ ...d, label: formatDayLabel(d.date) }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <LineChart data={chartData} margin={{ left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
        <Line type="monotone" dataKey="customerOrders" name="Customer Orders" stroke={COLORS.maroon} strokeWidth={2} dot={false} />
        <Line type="monotone" dataKey="partyOrders" name="Party Orders" stroke={COLORS.gold} strokeWidth={2} dot={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

function PaymentsChart() {
  const { data, isLoading } = useTrends();
  if (isLoading || !data) return <p className="text-brand-400 text-sm">Loading...</p>;
  const chartData = data.map((d) => ({ ...d, label: formatDayLabel(d.date) }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData} margin={{ left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v}`} />
        <Tooltip formatter={(v) => formatCurrency(Number(v ?? 0))} />
        <Bar dataKey="paymentsReceived" name="Payments Received" fill={COLORS.green} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function ProductionTrendChart() {
  const { data, isLoading } = useTrends();
  if (isLoading || !data) return <p className="text-brand-400 text-sm">Loading...</p>;
  const chartData = data.map((d) => ({ ...d, label: formatDayLabel(d.date) }));
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={chartData} margin={{ left: -10 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#eee" />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} />
        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
        <Tooltip />
        <Bar dataKey="productionCompleted" name="Units Completed" fill={COLORS.blue} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

function DeliveryStatusChart({ data }: { data: DashboardSummary }) {
  const pending = data.customerOrders.pending + data.partyOrders.pending;
  const delivered = data.customerOrders.delivered + data.partyOrders.delivered;
  const chartData = [
    { name: 'Pending', value: pending, color: COLORS.gold },
    { name: 'Delivered', value: delivered, color: COLORS.green },
  ];
  if (pending === 0 && delivered === 0) return <p className="text-brand-400 text-sm">No orders yet.</p>;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart>
        <Pie data={chartData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
          {chartData.map((entry) => (
            <Cell key={entry.name} fill={entry.color} />
          ))}
        </Pie>
        <Tooltip />
        <Legend wrapperStyle={{ fontSize: 12 }} />
      </PieChart>
    </ResponsiveContainer>
  );
}

// --- Widget registry + customization -----------------------------------

type WidgetId = 'overview' | 'production' | 'orderTrends' | 'paymentsChart' | 'productionChart' | 'deliveryStatus';

const WIDGET_DEFS: { id: WidgetId; title: string }[] = [
  { id: 'overview', title: 'Business Overview' },
  { id: 'production', title: 'Production Status' },
  { id: 'orderTrends', title: 'Order Trends (14 days)' },
  { id: 'paymentsChart', title: 'Payments Received (14 days)' },
  { id: 'productionChart', title: 'Production Completed (14 days)' },
  { id: 'deliveryStatus', title: 'Delivery Status' },
];

const DEFAULT_ORDER: WidgetId[] = WIDGET_DEFS.map((w) => w.id);

function layoutKey(userId: string) {
  return `sss.dashboard.layout.${userId}`;
}

function loadLayout(userId: string): { order: WidgetId[]; hidden: WidgetId[] } {
  try {
    const raw = window.localStorage.getItem(layoutKey(userId));
    if (!raw) return { order: DEFAULT_ORDER, hidden: [] };
    const parsed = JSON.parse(raw);
    const order: WidgetId[] = Array.isArray(parsed.order) ? parsed.order.filter((id: string) => DEFAULT_ORDER.includes(id as WidgetId)) : DEFAULT_ORDER;
    // Any widget added after this layout was saved (new feature) still shows up, appended at the end.
    for (const id of DEFAULT_ORDER) if (!order.includes(id)) order.push(id);
    const hidden: WidgetId[] = Array.isArray(parsed.hidden) ? parsed.hidden : [];
    return { order, hidden };
  } catch {
    return { order: DEFAULT_ORDER, hidden: [] };
  }
}

function CustomizePanel({
  order,
  hidden,
  onToggle,
  onMove,
  onClose,
}: {
  order: WidgetId[];
  hidden: WidgetId[];
  onToggle: (id: WidgetId) => void;
  onMove: (id: WidgetId, direction: -1 | 1) => void;
  onClose: () => void;
}) {
  const titleFor = (id: WidgetId) => WIDGET_DEFS.find((w) => w.id === id)?.title ?? id;
  return (
    <div className="absolute right-0 top-full mt-2 w-80 card z-30 p-3 space-y-1">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-ink-muted uppercase tracking-wide">Customize Dashboard</p>
        <button onClick={onClose} className="text-brand-400 hover:text-brand-700 text-sm">
          ✕
        </button>
      </div>
      {order.map((id, idx) => (
        <div key={id} className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-brand-50">
          <input type="checkbox" checked={!hidden.includes(id)} onChange={() => onToggle(id)} />
          <span className={`flex-1 text-sm ${hidden.includes(id) ? 'text-brand-300' : 'text-ink'}`}>{titleFor(id)}</span>
          <button
            className="text-brand-400 hover:text-brand-700 disabled:opacity-20 text-xs px-1"
            disabled={idx === 0}
            onClick={() => onMove(id, -1)}
            title="Move up"
          >
            ▲
          </button>
          <button
            className="text-brand-400 hover:text-brand-700 disabled:opacity-20 text-xs px-1"
            disabled={idx === order.length - 1}
            onClick={() => onMove(id, 1)}
            title="Move down"
          >
            ▼
          </button>
        </div>
      ))}
    </div>
  );
}

export default function DashboardPage() {
  const { user } = useAuth();
  const { data, isLoading } = useSWR<DashboardSummary>('/dashboard/summary', fetcher);
  const [order, setOrder] = useState<WidgetId[]>(DEFAULT_ORDER);
  const [hidden, setHidden] = useState<WidgetId[]>([]);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    if (user?.id) {
      const loaded = loadLayout(user.id);
      setOrder(loaded.order);
      setHidden(loaded.hidden);
    }
  }, [user?.id]);

  function persist(nextOrder: WidgetId[], nextHidden: WidgetId[]) {
    setOrder(nextOrder);
    setHidden(nextHidden);
    if (user?.id) {
      try {
        window.localStorage.setItem(layoutKey(user.id), JSON.stringify({ order: nextOrder, hidden: nextHidden }));
      } catch {
        // ignore (private browsing / storage disabled)
      }
    }
  }

  function toggleWidget(id: WidgetId) {
    persist(order, hidden.includes(id) ? hidden.filter((h) => h !== id) : [...hidden, id]);
  }

  function moveWidget(id: WidgetId, direction: -1 | 1) {
    const idx = order.indexOf(id);
    const swapWith = idx + direction;
    if (swapWith < 0 || swapWith >= order.length) return;
    const next = [...order];
    [next[idx], next[swapWith]] = [next[swapWith], next[idx]];
    persist(next, hidden);
  }

  const visibleWidgets = useMemo(() => order.filter((id) => !hidden.includes(id)), [order, hidden]);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-brand-900">Welcome back, {user?.name?.split(' ')[0]}</h1>
          <p className="text-brand-500 text-sm mt-1">Here&apos;s what&apos;s happening across the business today.</p>
        </div>
        <div className="relative">
          <button className="btn-secondary" onClick={() => setPanelOpen((v) => !v)}>
            ⚙ Customize
          </button>
          {panelOpen && (
            <CustomizePanel order={order} hidden={hidden} onToggle={toggleWidget} onMove={moveWidget} onClose={() => setPanelOpen(false)} />
          )}
        </div>
      </div>

      {isLoading || !data ? (
        <p className="text-brand-400 text-sm">Loading summary...</p>
      ) : (
        <div className="space-y-8">
          {visibleWidgets.map((id) => {
            if (id === 'overview') return <OverviewWidget key={id} data={data} />;
            const title = WIDGET_DEFS.find((w) => w.id === id)?.title ?? id;
            return (
              <section key={id} className="card p-5">
                <h3 className="text-sm font-semibold text-brand-900 mb-3">{title}</h3>
                {id === 'production' && <ProductionWidget />}
                {id === 'orderTrends' && <OrderTrendsChart />}
                {id === 'paymentsChart' && <PaymentsChart />}
                {id === 'productionChart' && <ProductionTrendChart />}
                {id === 'deliveryStatus' && <DeliveryStatusChart data={data} />}
              </section>
            );
          })}
          {visibleWidgets.length === 0 && (
            <p className="text-brand-400 text-sm">All widgets are hidden - click Customize to bring some back.</p>
          )}
        </div>
      )}
    </div>
  );
}
