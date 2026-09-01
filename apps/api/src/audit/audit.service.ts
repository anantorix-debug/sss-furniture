import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

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

  async findAll(params: { action?: string; userId?: string; limit?: number }) {
    return this.prisma.auditLog.findMany({
      where: { action: params.action, userId: params.userId },
      orderBy: { createdAt: 'desc' },
      take: params.limit ?? 200,
    });
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
