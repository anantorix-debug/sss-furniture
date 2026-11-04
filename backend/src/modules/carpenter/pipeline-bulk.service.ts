import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { PipelineBulkDto, PipelineTarget } from './dto/pipeline-bulk.dto';

// Production Control > Dispatch: change many pieces at once. One request, one
// transaction - the same writes as the row buttons (Record QC, Add to Finished
// Stock, Dispatch), but it can't stop halfway or trip the API rate limit.
// Stages are worked out from the database here, never trusted from the browser,
// so a stale screen can't add a piece to stock or dispatch it twice.
export type PipelineStage = 'awaiting_qc' | 'rework' | 'awaiting_stock' | 'in_stock' | 'dispatched';
export type PipelineStep = 'qc_pass' | 'qc_reject' | 'stock' | 'dispatch';

// Same rule as the screen (production-control/page.tsx, DispatchTab).
export function pipelineStage(p: { dispatched: boolean; stockStatus?: string | null; latestQc?: string | null }): PipelineStage {
  if (p.dispatched || p.stockStatus === 'DISPATCHED') return 'dispatched';
  if (p.stockStatus) return 'in_stock';
  if (p.latestQc === 'PASSED') return 'awaiting_stock';
  if (p.latestQc) return 'rework';
  return 'awaiting_qc';
}

// What it takes to get from a stage to the chosen status. Empty = already
// there or past it, so the piece is skipped. Nothing ever moves backwards.
export function pipelineSteps(stage: PipelineStage, target: PipelineTarget): PipelineStep[] {
  const needsQc = stage === 'awaiting_qc' || stage === 'rework';
  switch (target) {
    case PipelineTarget.QC_PASSED:
      return needsQc ? ['qc_pass'] : [];
    case PipelineTarget.REWORK:
    case PipelineTarget.FAILED:
      return needsQc ? ['qc_reject'] : [];
    case PipelineTarget.IN_STOCK:
      if (needsQc) return ['qc_pass', 'stock'];
      return stage === 'awaiting_stock' ? ['stock'] : [];
    case PipelineTarget.DISPATCHED:
      if (needsQc) return ['qc_pass', 'stock', 'dispatch'];
      if (stage === 'awaiting_stock') return ['stock', 'dispatch'];
      return stage === 'in_stock' ? ['dispatch'] : [];
  }
}

@Injectable()
export class PipelineBulkService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly audit: AuditService,
  ) {}

  async apply(dto: PipelineBulkDto, user: { userId: string; email?: string }) {
    const ids = [...new Set(dto.workItemIds)];
    const remarks = dto.remarks?.trim() || undefined;
    const today = new Date(new Date().toISOString().slice(0, 10));
    const changed: string[] = [];
    const skipped: { id: string; modelNo: string | null; reason: string }[] = [];

    await this.prisma.$transaction(
      async (tx) => {
        // Only what this list shows: finished pieces outside the batch engine.
        const items = await tx.carpenterWorkItem.findMany({ where: { id: { in: ids }, status: 'COMPLETED', batchId: null } });
        const found = new Set(items.map((i) => i.id));
        for (const id of ids) if (!found.has(id)) skipped.push({ id, modelNo: null, reason: 'No longer in this list' });

        const jobOf = (i: { id: string; modelNo: string | null }) => i.modelNo || i.id;
        const jobs = items.map(jobOf);
        const [qcs, stocks, dispatches] = await Promise.all([
          tx.qualityCheck.findMany({ where: { workItemId: { in: items.map((i) => i.id) } }, orderBy: { createdAt: 'asc' } }),
          tx.finishedStockItem.findMany({ where: { jobNumber: { in: jobs } }, orderBy: { completionDate: 'asc' } }),
          tx.dispatchRecord.findMany({ where: { jobNumber: { in: jobs } }, select: { jobNumber: true } }),
        ]);
        // Sorted oldest first, so the newest row wins each key.
        const latestQc = new Map(qcs.map((q) => [q.workItemId, q.result as string]));
        const stockByJob = new Map(stocks.map((s) => [s.jobNumber, { id: s.id, status: s.status as string }]));
        const dispatched = new Set(dispatches.map((d) => d.jobNumber));

        for (const item of items) {
          const job = jobOf(item);
          // Read per piece, so two pieces sharing a Model No can't both add stock.
          const stage = pipelineStage({
            dispatched: dispatched.has(job),
            stockStatus: stockByJob.get(job)?.status,
            latestQc: latestQc.get(item.id),
          });
          const steps = pipelineSteps(stage, dto.target);
          if (steps.length === 0) {
            skipped.push({ id: item.id, modelNo: item.modelNo, reason: 'Already at or past this status' });
            continue;
          }

          for (const step of steps) {
            if (step === 'qc_pass' || step === 'qc_reject') {
              const result = step === 'qc_pass' ? 'PASSED' : dto.target === PipelineTarget.FAILED ? 'FAILED' : 'REWORK_REQUIRED';
              await tx.qualityCheck.create({
                data: { jobNumber: job, workItemId: item.id, result, remarks, inspectedById: user.userId },
              });
              await tx.carpenterWorkItem.update({
                where: { id: item.id },
                data: { status: step === 'qc_pass' ? 'COMPLETED' : 'REWORK', qcNote: remarks },
              });
            } else if (step === 'stock') {
              const stock = await tx.finishedStockItem.create({
                data: { jobNumber: job, productName: item.productName, quantity: item.quantity, completionDate: today, status: 'AVAILABLE' },
              });
              stockByJob.set(job, { id: stock.id, status: stock.status });
            } else {
              const stock = stockByJob.get(job)!;
              await tx.dispatchRecord.create({
                data: { jobNumber: job, finishedStockId: stock.id, dispatchDate: today, dispatchedById: user.userId },
              });
              await tx.finishedStockItem.update({ where: { id: stock.id }, data: { status: 'DISPATCHED' } });
              stockByJob.set(job, { id: stock.id, status: 'DISPATCHED' });
              dispatched.add(job);
            }
          }
          changed.push(item.id);
        }
      },
      { maxWait: 10_000, timeout: 60_000 },
    );

    await this.audit.log({
      userId: user.userId,
      userEmail: user.email,
      action: 'PRODUCTION_PIPELINE_BULK_CHANGE',
      targetType: 'CarpenterWorkItem',
      metadata: { target: dto.target, remarks, changed, skipped: skipped.map((s) => s.id) },
    });

    return { changed: changed.length, skipped };
  }
}
