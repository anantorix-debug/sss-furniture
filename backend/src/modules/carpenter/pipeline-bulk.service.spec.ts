import { PipelineBulkService, pipelineStage, pipelineSteps, PipelineStage } from './pipeline-bulk.service';
import { PipelineTarget } from './dto/pipeline-bulk.dto';

// In-memory stand-in for the tables the service touches.
function setup(seed: { items?: any[]; qcs?: any[]; stocks?: any[]; dispatches?: any[]; failOn?: string } = {}) {
  const db = { items: seed.items ?? [], qcs: seed.qcs ?? [], stocks: seed.stocks ?? [], dispatches: seed.dispatches ?? [] };
  let seq = 0;
  const tx = {
    carpenterWorkItem: {
      findMany: async ({ where }: any) => db.items.filter((i) => where.id.in.includes(i.id) && i.status === where.status && i.batchId === where.batchId),
      update: async ({ where, data }: any) => Object.assign(db.items.find((i) => i.id === where.id), data),
    },
    qualityCheck: {
      findMany: async ({ where }: any) => db.qcs.filter((q) => where.workItemId.in.includes(q.workItemId)),
      create: async ({ data }: any) => (db.qcs.push(data), data),
    },
    finishedStockItem: {
      findMany: async ({ where }: any) => db.stocks.filter((s) => where.jobNumber.in.includes(s.jobNumber)),
      create: async ({ data }: any) => {
        if (seed.failOn === data.jobNumber) throw new Error('db error');
        const row = { id: `s${++seq}`, ...data };
        db.stocks.push(row);
        return row;
      },
      update: async ({ where, data }: any) => Object.assign(db.stocks.find((s) => s.id === where.id), data),
    },
    dispatchRecord: {
      findMany: async ({ where }: any) => db.dispatches.filter((d) => where.jobNumber.in.includes(d.jobNumber)),
      create: async ({ data }: any) => (db.dispatches.push(data), data),
    },
  };
  const prisma = { $transaction: (fn: any) => fn(tx) } as any;
  const audit = { log: jest.fn() } as any;
  return { db, audit, service: new PipelineBulkService(prisma, audit) };
}

const item = (id: string, modelNo: string | null = id, extra: object = {}) => ({
  id,
  modelNo,
  productName: `Cot ${id}`,
  quantity: 1,
  status: 'COMPLETED',
  batchId: null,
  ...extra,
});
const user = { userId: 'u1', email: 'a@b.c' };

describe('pipelineStage', () => {
  it.each([
    [{ dispatched: true }, 'dispatched'],
    [{ dispatched: false, stockStatus: 'DISPATCHED' }, 'dispatched'],
    [{ dispatched: false, stockStatus: 'AVAILABLE' }, 'in_stock'],
    [{ dispatched: false, latestQc: 'PASSED' }, 'awaiting_stock'],
    [{ dispatched: false, latestQc: 'FAILED' }, 'rework'],
    [{ dispatched: false }, 'awaiting_qc'],
  ])('%j -> %s', (input, expected) => {
    expect(pipelineStage(input)).toBe(expected);
  });
});

describe('pipelineSteps', () => {
  const T = PipelineTarget;
  const cases: [PipelineStage, PipelineTarget, string[]][] = [
    ['awaiting_qc', T.QC_PASSED, ['qc_pass']],
    ['awaiting_qc', T.IN_STOCK, ['qc_pass', 'stock']],
    ['awaiting_qc', T.DISPATCHED, ['qc_pass', 'stock', 'dispatch']],
    ['rework', T.DISPATCHED, ['qc_pass', 'stock', 'dispatch']],
    ['awaiting_stock', T.DISPATCHED, ['stock', 'dispatch']],
    ['in_stock', T.DISPATCHED, ['dispatch']],
    ['awaiting_qc', T.REWORK, ['qc_reject']],
    ['awaiting_qc', T.FAILED, ['qc_reject']],
    // Never backwards, never twice.
    ['awaiting_stock', T.QC_PASSED, []],
    ['awaiting_stock', T.REWORK, []],
    ['in_stock', T.IN_STOCK, []],
    ['in_stock', T.FAILED, []],
    ['dispatched', T.DISPATCHED, []],
    ['dispatched', T.REWORK, []],
  ];
  it.each(cases)('%s to %s', (stage, target, steps) => {
    expect(pipelineSteps(stage, target)).toEqual(steps);
  });
});

describe('PipelineBulkService', () => {
  it('takes pieces straight from QC to dispatched, once each', async () => {
    const { db, service, audit } = setup({ items: [item('381'), item('407')] });
    const res = await service.apply({ workItemIds: ['381', '407'], target: PipelineTarget.DISPATCHED }, user);
    expect(res).toEqual({ changed: 2, skipped: [] });
    expect(db.qcs.map((q) => q.result)).toEqual(['PASSED', 'PASSED']);
    expect(db.stocks.map((s) => s.status)).toEqual(['DISPATCHED', 'DISPATCHED']);
    expect(db.dispatches.map((d) => d.jobNumber)).toEqual(['381', '407']);
    expect(db.dispatches[0]).toMatchObject({ finishedStockId: db.stocks[0].id, dispatchedById: 'u1' });
    expect(audit.log).toHaveBeenCalledTimes(1);
  });

  it('continues from where each piece already is', async () => {
    const { db, service } = setup({
      items: [item('a'), item('b'), item('c')],
      qcs: [{ workItemId: 'b', result: 'PASSED' }],
      stocks: [{ id: 'old', jobNumber: 'c', status: 'AVAILABLE' }],
    });
    await service.apply({ workItemIds: ['a', 'b', 'c'], target: PipelineTarget.DISPATCHED }, user);
    expect(db.qcs).toHaveLength(2); // only a gets a new check
    expect(db.stocks).toHaveLength(3); // a and b are added, c reuses its stock
    expect(db.dispatches.find((d) => d.jobNumber === 'c').finishedStockId).toBe('old');
    expect(db.stocks.every((s) => s.status === 'DISPATCHED')).toBe(true);
  });

  it('skips pieces already past the status, without touching them', async () => {
    const { db, service } = setup({ items: [item('a')], dispatches: [{ jobNumber: 'a' }] });
    const res = await service.apply({ workItemIds: ['a'], target: PipelineTarget.IN_STOCK }, user);
    expect(res.changed).toBe(0);
    expect(res.skipped[0]).toMatchObject({ id: 'a', reason: 'Already at or past this status' });
    expect(db.stocks).toHaveLength(0);
  });

  it('is safe to run the same request twice (double click, stale screen)', async () => {
    const { db, service } = setup({ items: [item('a')] });
    const body = { workItemIds: ['a', 'a'], target: PipelineTarget.DISPATCHED };
    await service.apply(body, user);
    const again = await service.apply(body, user);
    expect(again.changed).toBe(0);
    expect(db.stocks).toHaveLength(1);
    expect(db.dispatches).toHaveLength(1);
  });

  it('adds stock only once for two pieces sharing a Model No', async () => {
    const { db, service } = setup({ items: [item('a', '500'), item('b', '500')] });
    const res = await service.apply({ workItemIds: ['a', 'b'], target: PipelineTarget.IN_STOCK }, user);
    expect(db.stocks).toHaveLength(1);
    expect(res.changed).toBe(1);
    expect(res.skipped.map((s) => s.id)).toEqual(['b']);
  });

  it('sends a piece to rework with the remark, and adds no stock', async () => {
    const { db, service } = setup({ items: [item('a')] });
    await service.apply({ workItemIds: ['a'], target: PipelineTarget.REWORK, remarks: ' fix polish ' }, user);
    expect(db.qcs[0]).toMatchObject({ result: 'REWORK_REQUIRED', remarks: 'fix polish' });
    expect(db.items[0]).toMatchObject({ status: 'REWORK', qcNote: 'fix polish' });
    expect(db.stocks).toHaveLength(0);
  });

  it('records FAILED for QC Failed', async () => {
    const { db, service } = setup({ items: [item('a')] });
    await service.apply({ workItemIds: ['a'], target: PipelineTarget.FAILED }, user);
    expect(db.qcs[0].result).toBe('FAILED');
    expect(db.items[0].status).toBe('REWORK');
  });

  it('skips anything not in this list: batch pieces, unfinished pieces, unknown ids', async () => {
    const { db, service } = setup({ items: [item('batch', 'x', { batchId: 'b1' }), item('open', 'y', { status: 'IN_PROGRESS' })] });
    const res = await service.apply({ workItemIds: ['batch', 'open', 'ghost'], target: PipelineTarget.DISPATCHED }, user);
    expect(res.changed).toBe(0);
    expect(res.skipped.map((s) => s.reason)).toEqual(Array(3).fill('No longer in this list'));
    expect(db.qcs).toHaveLength(0);
  });

  it('uses the item id as the job number when there is no Model No', async () => {
    const { db, service } = setup({ items: [item('a', null)] });
    await service.apply({ workItemIds: ['a'], target: PipelineTarget.IN_STOCK }, user);
    expect(db.stocks[0].jobNumber).toBe('a');
  });

  it('passes a database failure up, so the transaction rolls everything back', async () => {
    const { service, audit } = setup({ items: [item('a'), item('b')], failOn: 'b' });
    await expect(service.apply({ workItemIds: ['a', 'b'], target: PipelineTarget.IN_STOCK }, user)).rejects.toThrow('db error');
    expect(audit.log).not.toHaveBeenCalled();
  });
});
