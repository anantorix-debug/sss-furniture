import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateWeeklyLabourDto } from './dto/create-weekly-labour.dto';
import { UpdateWeeklyLabourDto } from './dto/update-weekly-labour.dto';
import { RejectWeeklyLabourDto } from './dto/reject-weekly-labour.dto';
import { paginate, toSkipTake } from '../../common/utils/pagination.util';

@Injectable()
export class WeeklyLabourService {
  constructor(private prisma: PrismaService) {}

  // Opt-in pagination - see the identical note on CustomerOrdersService.findAll.
  async findAll(params: { carpenterId?: string; status?: string; page?: number; limit?: number } = {}) {
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where = { carpenterId: params.carpenterId, status: params.status as any };
    const [batches, total] = await Promise.all([
      this.prisma.weeklyLabour.findMany({
        where,
        include: { carpenter: true, submittedBy: { select: { id: true, name: true } }, reviewedBy: { select: { id: true, name: true } } },
        orderBy: { weekStart: 'desc' },
        ...(paginated ? toSkipTake(page, limit) : {}),
      }),
      paginated ? this.prisma.weeklyLabour.count({ where }) : Promise.resolve(0),
    ]);
    return paginated ? paginate(batches, total, page, limit) : batches;
  }

  // Powers the "pick which completed cots go in this week's batch" step -
  // only cots that are COMPLETED and not already paid out show up, matching
  // "Only Completed Cots Appear in Labour List" in the reference workflow.
  findEligibleWorkItems(carpenterId: string) {
    return this.prisma.carpenterWorkItem.findMany({
      where: { carpenterId, status: 'COMPLETED', labourClaimed: false },
      orderBy: { workDate: 'desc' },
    });
  }

  async findOne(id: string) {
    const labour = await this.prisma.weeklyLabour.findUnique({
      where: { id },
      include: { carpenter: true, submittedBy: { select: { id: true, name: true } }, reviewedBy: { select: { id: true, name: true } } },
    });
    if (!labour) throw new NotFoundException('Weekly labour batch not found');
    return labour;
  }

  private async loadAndValidateItems(carpenterId: string, workItemIds: string[]) {
    const items = await this.prisma.carpenterWorkItem.findMany({ where: { id: { in: workItemIds } } });
    if (items.length !== workItemIds.length) {
      throw new BadRequestException('One or more selected cots could not be found');
    }
    const invalid = items.find((i) => i.carpenterId !== carpenterId || i.status !== 'COMPLETED' || i.labourClaimed);
    if (invalid) {
      throw new BadRequestException(
        `Cot "${invalid.productName}" is not eligible - it must belong to this carpenter, be COMPLETED, and not already paid`,
      );
    }
    return items;
  }

  async create(dto: CreateWeeklyLabourDto, submittedById: string) {
    const items = await this.loadAndValidateItems(dto.carpenterId, dto.workItemIds);
    const totalLabourAmount = items.reduce((sum, i) => sum + Number(i.total), 0);
    const previousDeduction = dto.previousDeduction ?? 0;

    const labour = await this.prisma.weeklyLabour.create({
      data: {
        carpenterId: dto.carpenterId,
        weekStart: new Date(dto.weekStart),
        weekEnd: new Date(dto.weekEnd),
        totalCompletedCots: items.length,
        totalLabourAmount,
        previousDeduction,
        netPayable: totalLabourAmount - previousDeduction,
        status: 'DRAFT',
        workItemIds: dto.workItemIds,
        submittedById,
      },
    });
    return this.findOne(labour.id);
  }

  async update(id: string, dto: UpdateWeeklyLabourDto) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only draft batches can be edited - submit a new one instead');
    }

    const carpenterId = dto.carpenterId ?? existing.carpenterId;
    const workItemIds = dto.workItemIds ?? (existing.workItemIds as string[]);
    const items = await this.loadAndValidateItems(carpenterId, workItemIds);
    const totalLabourAmount = items.reduce((sum, i) => sum + Number(i.total), 0);
    const previousDeduction = dto.previousDeduction ?? Number(existing.previousDeduction);

    await this.prisma.weeklyLabour.update({
      where: { id },
      data: {
        carpenterId,
        weekStart: dto.weekStart ? new Date(dto.weekStart) : undefined,
        weekEnd: dto.weekEnd ? new Date(dto.weekEnd) : undefined,
        totalCompletedCots: items.length,
        totalLabourAmount,
        previousDeduction,
        netPayable: totalLabourAmount - previousDeduction,
        workItemIds,
      },
    });
    return this.findOne(id);
  }

  async submit(id: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') throw new BadRequestException('Only draft batches can be submitted');
    await this.prisma.weeklyLabour.update({ where: { id }, data: { status: 'SUBMITTED' } });
    return this.findOne(id);
  }

  // Approval locks the batch in and marks every included cot as paid
  // (labourClaimed) so it can never be picked into another batch.
  async approve(id: string, reviewedById: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'SUBMITTED') throw new BadRequestException('Only submitted batches can be approved');

    await this.prisma.$transaction([
      this.prisma.weeklyLabour.update({
        where: { id },
        data: { status: 'APPROVED', reviewedById, reviewNote: null },
      }),
      this.prisma.carpenterWorkItem.updateMany({
        where: { id: { in: existing.workItemIds as string[] } },
        data: { labourClaimed: true },
      }),
    ]);
    return this.findOne(id);
  }

  async reject(id: string, dto: RejectWeeklyLabourDto, reviewedById: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'SUBMITTED') throw new BadRequestException('Only submitted batches can be rejected');
    await this.prisma.weeklyLabour.update({
      where: { id },
      data: { status: 'REJECTED', reviewedById, reviewNote: dto.reviewNote },
    });
    return this.findOne(id);
  }

  async remove(id: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException('Only draft batches can be deleted - once submitted it stays for the record');
    }
    await this.prisma.weeklyLabour.delete({ where: { id } });
    return { success: true };
  }
}
