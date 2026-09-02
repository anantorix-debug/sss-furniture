import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { paginate, toSkipTake } from '../../common/utils/pagination.util';

export interface AuditEntry {
  userId?: string;
  userEmail?: string;
  action: string;
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(private prisma: PrismaService) {}

  async log(entry: AuditEntry) {
    try {
      await this.prisma.auditLog.create({
        data: {
          userId: entry.userId,
          userEmail: entry.userEmail,
          action: entry.action,
          targetType: entry.targetType,
          targetId: entry.targetId,
          metadata: entry.metadata as any,
        },
      });
    } catch (err) {
      // Audit logging must never break the primary action it's observing.
      this.logger.error(`Failed to write audit log entry (${entry.action}): ${(err as Error).message}`);
    }
  }

  // Opt-in pagination - see the identical note on CustomerOrdersService.findAll.
  // Without `page`, keeps the previous 200-row cap.
  async findAll(params: { action?: string; userId?: string; page?: number; limit?: number }) {
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where = { action: params.action, userId: params.userId };
    const [logs, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        ...(paginated ? toSkipTake(page, limit) : { skip: 0, take: 200 }),
      }),
      paginated ? this.prisma.auditLog.count({ where }) : Promise.resolve(0),
    ]);
    return paginated ? paginate(logs, total, page, limit) : logs;
  }

  /**
   * Recent business-record activity created by team-role users (Carpenter,
   * Polisher, Admin), for the Superadmin/Admin notification bell - a lighter,
   * role-scoped view distinct from the full security audit trail (SUPERADMIN-only).
   */
  async findRecentEmployeeActivity(hours = 24, limit = 20) {
    const since = new Date(Date.now() - hours * 60 * 60 * 1000);
    const entries = await this.prisma.auditLog.findMany({
      where: {
        createdAt: { gte: since },
        action: {
          in: ['CUSTOMER_ORDER_CREATED', 'PARTY_ORDER_CREATED', 'WORK_ITEM_CREATED', 'MATERIAL_ISSUED', 'MODEL_NO_UPDATED', 'WORK_ITEM_COMPLETED'],
        },
        user: { role: { not: 'SUPERADMIN' } },
      },
      include: { user: { select: { name: true, role: true } } },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
    return entries;
  }
}
