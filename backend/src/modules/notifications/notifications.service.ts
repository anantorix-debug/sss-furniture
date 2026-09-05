import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Role } from '../../common/enums/role.enum';
import { paginate, toSkipTake } from '../../common/utils/pagination.util';

export interface NotifyInput {
  type: string;
  title: string;
  message: string;
  targetType?: string;
  targetId?: string;
}

// Persisted, per-user notifications - one row per recipient, so unread
// counts and read/unread state are real rather than the localStorage-only
// tracking NotificationBell used before this. No push/service-worker here
// (see the plan's explicit scope note) - polling the same way the bell
// already polls everything else.
@Injectable()
export class NotificationsService {
  constructor(private prisma: PrismaService) {}

  async notify(userIds: string[], input: NotifyInput) {
    const unique = Array.from(new Set(userIds));
    if (unique.length === 0) return;
    await this.prisma.notification.createMany({
      data: unique.map((userId) => ({ userId, ...input })),
    });
  }

  // Fans out to every active user holding any of the given roles -
  // SUPERADMIN/ADMIN for production and material events, matching every
  // "notify Super Admin/Admin" requirement in this feature.
  async notifyRoles(roles: Role[], input: NotifyInput) {
    const users = await this.prisma.user.findMany({
      where: { role: { in: roles }, isActive: true },
      select: { id: true },
    });
    await this.notify(
      users.map((u) => u.id),
      input,
    );
  }

  async findMine(userId: string, params: { page?: number; limit?: number; unreadOnly?: boolean }) {
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where = { userId, isRead: params.unreadOnly ? false : undefined };
    const [notifications, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: paginated ? limit : 50,
        ...(paginated ? toSkipTake(page, limit) : {}),
      }),
      paginated ? this.prisma.notification.count({ where }) : Promise.resolve(0),
    ]);
    return paginated ? paginate(notifications, total, page, limit) : notifications;
  }

  async unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, isRead: false } });
  }

  async markRead(id: string, userId: string) {
    await this.prisma.notification.updateMany({ where: { id, userId }, data: { isRead: true } });
    return { success: true };
  }

  async markAllRead(userId: string) {
    await this.prisma.notification.updateMany({ where: { userId, isRead: false }, data: { isRead: true } });
    return { success: true };
  }
}
