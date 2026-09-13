import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../modules/prisma/prisma.service';

// PUR-00001, sequential - same approach as generateJobNumber (find the max
// existing sequence, retry on the rare race where two purchases are
// created in the same instant and collide on the unique constraint).
// Single-table scan since Purchase is the only source, unlike jobNumber's
// shared sequence across CustomerOrder/PartyOrder.
export async function generatePurchaseNumber(prisma: PrismaService): Promise<string> {
  const prefix = 'PUR-';

  for (let attempt = 0; attempt < 5; attempt++) {
    const last = await prisma.purchase.findFirst({
      where: { purchaseNumber: { startsWith: prefix } },
      orderBy: { purchaseNumber: 'desc' },
      select: { purchaseNumber: true },
    });
    const lastSeq = last ? parseInt(last.purchaseNumber.slice(prefix.length), 10) || 0 : 0;
    const candidate = `${prefix}${String(lastSeq + 1).padStart(5, '0')}`;

    const clash = await prisma.purchase.findUnique({ where: { purchaseNumber: candidate } });
    if (!clash) return candidate;
  }
  throw new ConflictException('Could not allocate a purchase number, please retry');
}
