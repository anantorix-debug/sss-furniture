import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { Role } from '../../common/enums/role.enum';
import { paginate, toSkipTake } from '../../common/utils/pagination.util';

const SAFE_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} as const;

@Injectable()
export class UsersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  // Opt-in pagination - see the identical note on CustomerOrdersService.findAll.
  async findAll(params: { search?: string; page?: number; limit?: number } = {}) {
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where = params.search
      ? { OR: [{ name: { contains: params.search } }, { email: { contains: params.search } }] }
      : {};

    const [users, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select: SAFE_SELECT,
        orderBy: { createdAt: 'asc' },
        ...(paginated ? toSkipTake(page, limit) : {}),
      }),
      paginated ? this.prisma.user.count({ where }) : Promise.resolve(0),
    ]);
    return paginated ? paginate(users, total, page, limit) : users;
  }

  async findOne(id: string) {
    const user = await this.prisma.user.findUnique({ where: { id }, select: SAFE_SELECT });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  async create(dto: CreateUserDto) {
    const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
    if (existing) throw new ConflictException('A user with this email already exists');

    const hash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.user.create({
      data: {
        name: dto.name,
        email: dto.email,
        password: hash,
        role: dto.role ?? Role.CARPENTER,
      },
      select: SAFE_SELECT,
    });

    await this.audit.log({ action: 'USER_CREATED', targetType: 'User', targetId: user.id, metadata: { email: user.email, role: user.role } });
    return user;
  }

  async update(id: string, dto: UpdateUserDto, actingUserId: string) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');

    if (target.id === actingUserId && dto.role && dto.role !== Role.SUPERADMIN) {
      throw new BadRequestException('You cannot demote your own account');
    }

    if (target.id === actingUserId && dto.isActive === false) {
      throw new BadRequestException('You cannot deactivate your own account');
    }

    if ((dto.role && dto.role !== Role.SUPERADMIN) || dto.isActive === false) {
      await this.assertNotLastSuperadmin(target);
    }

    if (dto.email && dto.email !== target.email) {
      const existing = await this.prisma.user.findUnique({ where: { email: dto.email } });
      if (existing) throw new ConflictException('A user with this email already exists');
    }

    const data: Record<string, unknown> = {
      name: dto.name,
      email: dto.email,
      role: dto.role,
      isActive: dto.isActive,
    };

    if (dto.password) {
      data.password = await bcrypt.hash(dto.password, 12);
      data.refreshTokenHash = null;
    }

    const updated = await this.prisma.user.update({
      where: { id },
      data,
      select: SAFE_SELECT,
    });

    if (dto.role && dto.role !== target.role) {
      await this.audit.log({
        userId: actingUserId,
        action: 'ROLE_CHANGED',
        targetType: 'User',
        targetId: id,
        metadata: { from: target.role, to: dto.role, targetEmail: target.email },
      });
    }
    if (dto.isActive === false && target.isActive) {
      await this.audit.log({ userId: actingUserId, action: 'USER_DEACTIVATED', targetType: 'User', targetId: id, metadata: { targetEmail: target.email } });
    }
    if (dto.isActive === true && !target.isActive) {
      await this.audit.log({ userId: actingUserId, action: 'USER_ACTIVATED', targetType: 'User', targetId: id, metadata: { targetEmail: target.email } });
    }
    if (dto.password) {
      await this.audit.log({ userId: actingUserId, action: 'PASSWORD_RESET_BY_ADMIN', targetType: 'User', targetId: id, metadata: { targetEmail: target.email } });
    }

    return updated;
  }

  async remove(id: string, actingUserId: string) {
    const target = await this.prisma.user.findUnique({ where: { id } });
    if (!target) throw new NotFoundException('User not found');

    if (target.id === actingUserId) {
      throw new BadRequestException('You cannot delete your own account');
    }

    if (target.role === Role.SUPERADMIN) {
      await this.assertNotLastSuperadmin(target);
    }

    // Same defensive check as Carpenter/Supplier removal: don't rely on the
    // schema's onDelete behavior alone (MySQL FK constraints aren't
    // guaranteed to have actually been created by every `prisma db push` in
    // this project's history) - block deletion when this login has created
    // real history instead of risking an orphaned row that later crashes any
    // query joining that record's required `createdBy`/`uploadedBy`/etc.
    // relation. Deactivate (isActive: false via PATCH) is the alternative.
    const historyCounts = await Promise.all([
      this.prisma.customerOrder.count({ where: { createdById: id } }),
      this.prisma.customerOrderPayment.count({ where: { createdById: id } }),
      this.prisma.partyOrder.count({ where: { createdById: id } }),
      this.prisma.partyOrderPayment.count({ where: { createdById: id } }),
      this.prisma.supplierPurchase.count({ where: { createdById: id } }),
      this.prisma.supplierPayment.count({ where: { createdById: id } }),
      this.prisma.carpenterWorkItem.count({ where: { createdById: id } }),
      this.prisma.carpenterPayment.count({ where: { createdById: id } }),
      this.prisma.productStockMovement.count({ where: { createdById: id } }),
      this.prisma.galleryImage.count({ where: { uploadedById: id } }),
      this.prisma.stockMovement.count({ where: { createdById: id } }),
      this.prisma.purchase.count({ where: { createdById: id } }),
      this.prisma.qualityCheck.count({ where: { inspectedById: id } }),
      this.prisma.dispatchRecord.count({ where: { dispatchedById: id } }),
      this.prisma.expense.count({ where: { createdById: id } }),
    ]);
    if (historyCounts.some((count) => count > 0)) {
      throw new ConflictException(
        'This user has created orders, payments, stock movements, or other records and cannot be deleted. Deactivate the account instead.',
      );
    }

    await this.prisma.user.delete({ where: { id } });
    await this.audit.log({ userId: actingUserId, action: 'USER_DELETED', targetType: 'User', targetId: id, metadata: { targetEmail: target.email } });
    return { success: true };
  }

  private async assertNotLastSuperadmin(target: { id: string; role: string }) {
    if (target.role !== Role.SUPERADMIN) return;
    const superadminCount = await this.prisma.user.count({ where: { role: Role.SUPERADMIN } });
    if (superadminCount <= 1) {
      throw new BadRequestException('At least one Superadmin must remain');
    }
  }
}
