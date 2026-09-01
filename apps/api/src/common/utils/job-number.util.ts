import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

// JOB-<year>-00001, sequential per calendar year - one shared sequence
// across CustomerOrder and PartyOrder so a Job No unambiguously identifies
// a single order regardless of type. Retries on the rare race where two
// orders are created in the same instant and collide on the unique
// jobNumber constraint, rather than locking a table.
export async function generateJobNumber(prisma: PrismaService): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `JOB-${year}-`;

  for (let attempt = 0; attempt < 5; attempt++) {
    const [lastCustomer, lastParty] = await Promise.all([
      prisma.customerOrder.findFirst({
        where: { jobNumber: { startsWith: prefix } },
        orderBy: { jobNumber: 'desc' },
        select: { jobNumber: true },
      }),
      prisma.partyOrder.findFirst({
        where: { jobNumber: { startsWith: prefix } },
        orderBy: { jobNumber: 'desc' },
        select: { jobNumber: true },
      }),
    ]);
    const seqFrom = (jobNumber: string | null | undefined) => (jobNumber ? parseInt(jobNumber.slice(prefix.length), 10) || 0 : 0);
    const maxSeq = Math.max(seqFrom(lastCustomer?.jobNumber), seqFrom(lastParty?.jobNumber));
    const candidate = `${prefix}${String(maxSeq + 1).padStart(5, '0')}`;

    const [clashCustomer, clashParty] = await Promise.all([
      prisma.customerOrder.findUnique({ where: { jobNumber: candidate } }),
      prisma.partyOrder.findUnique({ where: { jobNumber: candidate } }),
    ]);
    if (!clashCustomer && !clashParty) return candidate;
  }
  throw new ConflictException('Could not allocate a job number, please retry');
}
