import { PrismaService } from '../prisma/prisma.service';

// The Reports page dashboard, in plain business terms:
//   Sales booked    - value of orders taken in the period (cancelled left out)
//   Money received  - payments collected from customers and shops in the period
//   Money paid out  - paid to suppliers, workers (wages/advances) and expenses
//   Cash left       - money received minus money paid out
//   Still to collect / Still to pay - balances as of today, all dates
// Everything is computed from the same tables the order, supplier, worker
// and expense pages use, so the numbers agree with those pages.

type Range = { gte?: Date; lte?: Date } | undefined;

function toRange(from?: string, to?: string): Range {
  if (!from && !to) return undefined;
  return {
    gte: from ? new Date(`${from}T00:00:00.000Z`) : undefined,
    lte: to ? new Date(`${to}T23:59:59.999Z`) : undefined,
  };
}

const round = (n: number) => Math.round(n * 100) / 100;
const num = (v: unknown) => Number(v ?? 0);
const key = (s: string | null | undefined) => (s ?? '').trim().toUpperCase().replace(/\s+/g, ' ');

function addTo<T extends Record<string, number>>(map: Map<string, T>, k: string, init: () => T, add: Partial<T>) {
  const cur = map.get(k) ?? init();
  for (const [f, v] of Object.entries(add)) (cur as Record<string, number>)[f] += v as number;
  map.set(k, cur);
}

// Month buckets (YYYY-MM), or days (YYYY-MM-DD) when the period is short.
function bucketer(range: Range, dates: Date[]) {
  const start = range?.gte ?? (dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))) : new Date());
  const end = range?.lte ?? new Date();
  const days = (end.getTime() - start.getTime()) / 86_400_000;
  const daily = days <= 45;
  const keyOf = (d: Date) => (daily ? d.toISOString().slice(0, 10) : d.toISOString().slice(0, 7));
  const keys: string[] = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), daily ? start.getUTCDate() : 1));
  while (cursor <= end && keys.length < 400) {
    keys.push(keyOf(cursor));
    if (daily) cursor.setUTCDate(cursor.getUTCDate() + 1);
    else cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return { daily, keyOf, keys };
}

export async function buildOverview(prisma: PrismaService, params: { from?: string; to?: string }) {
  const range = toRange(params.from, params.to);
  const notCancelled = { not: 'CANCELLED' as const };

  const [customerOrders, partyOrders, customerPays, partyPays, supplierPays, workerPays, expenses, workItems] = await Promise.all([
    prisma.customerOrder.findMany({
      where: { orderDate: range, deliveryStatus: notCancelled },
      select: { id: true, orderId: true, jobNumber: true, orderDate: true, customerName: true, product: true, orderValue: true, deliveryStatus: true, payments: { select: { amount: true } }, items: { select: { productName: true, quantity: true, unitPrice: true } } },
    }),
    prisma.partyOrder.findMany({
      where: { orderDate: range, deliveryStatus: notCancelled },
      select: { id: true, jobNumber: true, orderDate: true, shopName: true, model: true, qty: true, totalAmount: true, deliveryStatus: true, payments: { select: { amount: true } }, items: { select: { productName: true, qty: true, totalValue: true } } },
    }),
    prisma.customerOrderPayment.findMany({ where: { date: range }, select: { date: true, amount: true } }),
    prisma.partyOrderPayment.findMany({ where: { date: range }, select: { date: true, amount: true } }),
    prisma.supplierPayment.findMany({ where: { date: range }, select: { date: true, amount: true, supplier: { select: { name: true } } } }),
    prisma.carpenterPayment.findMany({ where: { date: range, paymentType: { not: 'DEDUCTION' } }, select: { date: true, amount: true } }),
    prisma.expense.findMany({ where: { date: range, status: 'ACTIVE' }, select: { date: true, amount: true, category: { select: { name: true } } } }),
    prisma.carpenterWorkItem.findMany({ where: { workDate: range }, select: { quantity: true, total: true, stage: true, carpenter: { select: { name: true, workerType: true } } } }),
  ]);

  // ---- sales booked
  const retailSales = customerOrders.reduce((s, o) => s + num(o.orderValue), 0);
  const wholesaleSales = partyOrders.reduce((s, o) => s + num(o.totalAmount), 0);
  const orderCount = customerOrders.length + partyOrders.length;

  // ---- money in / out
  const retailIn = customerPays.reduce((s, p) => s + num(p.amount), 0);
  const wholesaleIn = partyPays.reduce((s, p) => s + num(p.amount), 0);
  const suppliersOut = supplierPays.reduce((s, p) => s + num(p.amount), 0);
  const workersOut = workerPays.reduce((s, p) => s + num(p.amount), 0);
  const expensesOut = expenses.reduce((s, e) => s + num(e.amount), 0);
  const moneyIn = retailIn + wholesaleIn;
  const moneyOut = suppliersOut + workersOut + expensesOut;

  // Where money went: suppliers and workers as two lines, expenses by category.
  const outByCategory = new Map<string, { amount: number }>();
  for (const e of expenses) addTo(outByCategory, e.category?.name ?? 'Other expense', () => ({ amount: 0 }), { amount: num(e.amount) });
  const moneyOutBreakdown = [
    { name: 'Suppliers (timber, ply, materials)', amount: round(suppliersOut), kind: 'SUPPLIER' },
    { name: 'Worker wages & advances', amount: round(workersOut), kind: 'WORKER' },
    ...[...outByCategory.entries()].map(([name, v]) => ({ name: `Expense: ${name}`, amount: round(v.amount), kind: 'EXPENSE' })),
  ]
    .filter((r) => r.amount > 0)
    .sort((a, b) => b.amount - a.amount);

  // ---- trend
  const allDates = [
    ...customerOrders.map((o) => o.orderDate),
    ...partyOrders.map((o) => o.orderDate),
    ...customerPays.map((p) => p.date),
    ...partyPays.map((p) => p.date),
    ...supplierPays.map((p) => p.date),
    ...workerPays.map((p) => p.date),
    ...expenses.map((e) => e.date),
  ];
  const b = bucketer(range, allDates);
  const trendMap = new Map(b.keys.map((k) => [k, { sales: 0, moneyIn: 0, moneyOut: 0 }]));
  const bump = (d: Date, field: 'sales' | 'moneyIn' | 'moneyOut', v: number) => {
    const t = trendMap.get(b.keyOf(d));
    if (t) t[field] += v;
  };
  customerOrders.forEach((o) => bump(o.orderDate, 'sales', num(o.orderValue)));
  partyOrders.forEach((o) => bump(o.orderDate, 'sales', num(o.totalAmount)));
  customerPays.forEach((p) => bump(p.date, 'moneyIn', num(p.amount)));
  partyPays.forEach((p) => bump(p.date, 'moneyIn', num(p.amount)));
  supplierPays.forEach((p) => bump(p.date, 'moneyOut', num(p.amount)));
  workerPays.forEach((p) => bump(p.date, 'moneyOut', num(p.amount)));
  expenses.forEach((e) => bump(e.date, 'moneyOut', num(e.amount)));
  const trend = [...trendMap.entries()].map(([period, v]) => ({ period, sales: round(v.sales), moneyIn: round(v.moneyIn), moneyOut: round(v.moneyOut) }));

  // ---- best customers & shops (sales booked in the period)
  const buyers = new Map<string, { name: string; channel: string; amount: number; orders: number }>();
  for (const o of customerOrders) {
    const k = `R|${key(o.customerName)}`;
    const cur = buyers.get(k) ?? { name: o.customerName, channel: 'Retail', amount: 0, orders: 0 };
    cur.amount += num(o.orderValue);
    cur.orders += 1;
    buyers.set(k, cur);
  }
  for (const o of partyOrders) {
    const k = `W|${key(o.shopName)}`;
    const cur = buyers.get(k) ?? { name: o.shopName, channel: 'Wholesale', amount: 0, orders: 0 };
    cur.amount += num(o.totalAmount);
    cur.orders += 1;
    buyers.set(k, cur);
  }
  const topBuyers = [...buyers.values()].map((r) => ({ ...r, amount: round(r.amount) })).sort((a, b2) => b2.amount - a.amount).slice(0, 8);

  // ---- best-selling products (order lines in the period)
  const products = new Map<string, { name: string; qty: number; amount: number }>();
  const addProduct = (name: string | null | undefined, qty: number, amount: number) => {
    if (!name?.trim()) return;
    const k = key(name);
    const cur = products.get(k) ?? { name: name.trim(), qty: 0, amount: 0 };
    cur.qty += qty;
    cur.amount += amount;
    products.set(k, cur);
  };
  for (const o of customerOrders) {
    if (o.items.length) o.items.forEach((i) => addProduct(i.productName, i.quantity ?? 1, (i.quantity ?? 1) * num(i.unitPrice)));
    else addProduct(o.product, 1, num(o.orderValue));
  }
  for (const o of partyOrders) {
    if (o.items.length) o.items.forEach((i) => addProduct(i.productName, i.qty ?? 1, num(i.totalValue)));
    else addProduct(o.model, o.qty ?? 1, num(o.totalAmount));
  }
  const topProducts = [...products.values()].map((r) => ({ ...r, amount: round(r.amount) })).sort((a, b2) => b2.amount - a.amount).slice(0, 8);

  // ---- production in the period
  const workers = new Map<string, { name: string; type: string; pieces: number; value: number }>();
  let pieces = 0;
  let workValue = 0;
  for (const w of workItems) {
    pieces += w.quantity ?? 1;
    workValue += num(w.total);
    const name = w.carpenter?.name ?? 'Unassigned';
    const cur = workers.get(name) ?? { name, type: w.carpenter?.workerType ?? '-', pieces: 0, value: 0 };
    cur.pieces += w.quantity ?? 1;
    cur.value += num(w.total);
    workers.set(name, cur);
  }
  const topWorkers = [...workers.values()].map((r) => ({ ...r, value: round(r.value) })).sort((a, b2) => b2.value - a.value).slice(0, 8);

  // ---- balances as of today (all dates)
  const [openCustomer, openParty, suppliers, carpenters] = await Promise.all([
    prisma.customerOrder.findMany({ where: { deliveryStatus: notCancelled }, select: { customerName: true, orderValue: true, payments: { select: { amount: true } } } }),
    prisma.partyOrder.findMany({ where: { deliveryStatus: notCancelled }, select: { shopName: true, totalAmount: true, payments: { select: { amount: true } } } }),
    prisma.supplier.findMany({ select: { name: true, purchases: { select: { value: true } }, payments: { select: { amount: true } } } }),
    prisma.carpenter.findMany({ select: { name: true, workItems: { select: { total: true } }, payments: { select: { amount: true } } } }),
  ]);
  const owed = new Map<string, { name: string; channel: string; amount: number; orders: number }>();
  for (const o of openCustomer) {
    const due = num(o.orderValue) - o.payments.reduce((s, p) => s + num(p.amount), 0);
    if (due <= 0.5) continue;
    addTo(owed as Map<string, any>, `R|${key(o.customerName)}`, () => ({ name: o.customerName, channel: 'Retail', amount: 0, orders: 0 }), { amount: due, orders: 1 });
  }
  for (const o of openParty) {
    const due = num(o.totalAmount) - o.payments.reduce((s, p) => s + num(p.amount), 0);
    if (due <= 0.5) continue;
    addTo(owed as Map<string, any>, `W|${key(o.shopName)}`, () => ({ name: o.shopName, channel: 'Wholesale', amount: 0, orders: 0 }), { amount: due, orders: 1 });
  }
  const owedList = [...owed.values()].map((r) => ({ ...r, amount: round(r.amount) })).sort((a, b2) => b2.amount - a.amount);
  const toCollect = round(owedList.reduce((s, r) => s + r.amount, 0));

  const supplierDue = suppliers
    .map((s) => ({ name: s.name.trim(), kind: 'Supplier', amount: round(s.purchases.reduce((t, p) => t + num(p.value), 0) - s.payments.reduce((t, p) => t + num(p.amount), 0)) }))
    .filter((r) => r.amount > 0.5);
  // Same rule as the worker page: work value - payments (deductions count too).
  const workerDue = carpenters
    .map((c) => ({ name: c.name, kind: 'Worker', amount: round(c.workItems.reduce((t, w) => t + num(w.total), 0) - c.payments.reduce((t, p) => t + num(p.amount), 0)) }))
    .filter((r) => r.amount > 0.5);
  const toPayList = [...supplierDue, ...workerDue].sort((a, b2) => b2.amount - a.amount);

  return {
    period: { from: params.from ?? null, to: params.to ?? null, bucket: b.daily ? 'day' : 'month' },
    sales: {
      total: round(retailSales + wholesaleSales),
      retail: round(retailSales),
      wholesale: round(wholesaleSales),
      orders: orderCount,
      retailOrders: customerOrders.length,
      wholesaleOrders: partyOrders.length,
      averageOrder: orderCount ? round((retailSales + wholesaleSales) / orderCount) : 0,
    },
    moneyIn: { total: round(moneyIn), retail: round(retailIn), wholesale: round(wholesaleIn) },
    moneyOut: { total: round(moneyOut), suppliers: round(suppliersOut), workers: round(workersOut), expenses: round(expensesOut), breakdown: moneyOutBreakdown },
    cashLeft: round(moneyIn - moneyOut),
    toCollect: { total: toCollect, parties: owedList.length, top: owedList.slice(0, 8) },
    toPay: {
      total: round(toPayList.reduce((s, r) => s + r.amount, 0)),
      suppliers: round(supplierDue.reduce((s, r) => s + r.amount, 0)),
      workers: round(workerDue.reduce((s, r) => s + r.amount, 0)),
      top: toPayList.slice(0, 8),
    },
    production: { pieces, workValue: round(workValue), entries: workItems.length, topWorkers },
    trend,
    topBuyers,
    topProducts,
    orders: [
      ...customerOrders.map((o) => {
        const received = o.payments.reduce((s, p) => s + num(p.amount), 0);
        return { date: o.orderDate, channel: 'Retail', reference: o.jobNumber ?? o.orderId, party: o.customerName, value: round(num(o.orderValue)), received: round(received), balance: round(num(o.orderValue) - received), status: o.deliveryStatus, id: o.id };
      }),
      ...partyOrders.map((o) => {
        const received = o.payments.reduce((s, p) => s + num(p.amount), 0);
        return { date: o.orderDate, channel: 'Wholesale', reference: o.jobNumber ?? '-', party: o.shopName, value: round(num(o.totalAmount)), received: round(received), balance: round(num(o.totalAmount) - received), status: o.deliveryStatus, id: o.id };
      }),
    ].sort((a, b2) => b2.date.getTime() - a.date.getTime()),
  };
}
