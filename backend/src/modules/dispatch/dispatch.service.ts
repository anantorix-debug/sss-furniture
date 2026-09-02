import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateDispatchDto } from './dto/create-dispatch.dto';
import { UpdateDispatchDto } from './dto/update-dispatch.dto';
import { paginate, toSkipTake } from '../../common/utils/pagination.util';

@Injectable()
export class DispatchService {
  constructor(private prisma: PrismaService) {}

  // Opt-in pagination - see the identical note on CustomerOrdersService.findAll.
  async findAll(params: { jobNumber?: string; page?: number; limit?: number } = {}) {
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where = params.jobNumber ? { jobNumber: params.jobNumber } : {};
    const [records, total] = await Promise.all([
      this.prisma.dispatchRecord.findMany({
        where,
        include: { finishedStock: true, dispatchedBy: { select: { id: true, name: true } } },
        orderBy: { dispatchDate: 'desc' },
        ...(paginated ? toSkipTake(page, limit) : {}),
      }),
      paginated ? this.prisma.dispatchRecord.count({ where }) : Promise.resolve(0),
    ]);
    return paginated ? paginate(records, total, page, limit) : records;
  }

  async findOne(id: string) {
    const record = await this.prisma.dispatchRecord.findUnique({
      where: { id },
      include: { finishedStock: true, dispatchedBy: { select: { id: true, name: true } } },
    });
    if (!record) throw new NotFoundException('Dispatch record not found');
    return record;
  }

  // Step 8 of the workflow: dispatching a finished item moves its stock
  // status to DISPATCHED so it stops showing as available.
  async create(dto: CreateDispatchDto, dispatchedById: string) {
    const record = await this.prisma.dispatchRecord.create({
      data: {
        jobNumber: dto.jobNumber,
        finishedStockId: dto.finishedStockId,
        dispatchDate: new Date(dto.dispatchDate),
        vehicle: dto.vehicle,
        driverName: dto.driverName,
        driverContact: dto.driverContact,
        remarks: dto.remarks,
        documentUrl: dto.documentUrl,
        dispatchedById,
      },
    });

    if (dto.finishedStockId) {
      await this.prisma.finishedStockItem.update({
        where: { id: dto.finishedStockId },
        data: { status: 'DISPATCHED' },
      }).catch(() => null);
    }

    return this.findOne(record.id);
  }

  async update(id: string, dto: UpdateDispatchDto) {
    await this.findOne(id);
    await this.prisma.dispatchRecord.update({
      where: { id },
      data: {
        jobNumber: dto.jobNumber,
        finishedStockId: dto.finishedStockId,
        dispatchDate: dto.dispatchDate ? new Date(dto.dispatchDate) : undefined,
        vehicle: dto.vehicle,
        driverName: dto.driverName,
        driverContact: dto.driverContact,
        remarks: dto.remarks,
        documentUrl: dto.documentUrl,
      },
    });
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.dispatchRecord.delete({ where: { id } });
    return { success: true };
  }
}
