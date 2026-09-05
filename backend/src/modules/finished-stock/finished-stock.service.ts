import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFinishedStockDto } from './dto/create-finished-stock.dto';
import { UpdateFinishedStockDto } from './dto/update-finished-stock.dto';
import { paginate, toSkipTake } from '../../common/utils/pagination.util';

@Injectable()
export class FinishedStockService {
  constructor(private prisma: PrismaService) {}

  // Opt-in pagination - see the identical note on CustomerOrdersService.findAll.
  async findAll(params: { status?: string; page?: number; limit?: number } = {}) {
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where = params.status ? { status: params.status as any } : {};
    const [items, total] = await Promise.all([
      this.prisma.finishedStockItem.findMany({
        where,
        include: { dispatchRecords: true },
        orderBy: { completionDate: 'desc' },
        ...(paginated ? toSkipTake(page, limit) : {}),
      }),
      paginated ? this.prisma.finishedStockItem.count({ where }) : Promise.resolve(0),
    ]);
    return paginated ? paginate(items, total, page, limit) : items;
  }

  async findOne(id: string) {
    const item = await this.prisma.finishedStockItem.findUnique({
      where: { id },
      include: { dispatchRecords: true },
    });
    if (!item) throw new NotFoundException('Finished stock item not found');
    return item;
  }

  async create(dto: CreateFinishedStockDto) {
    // jobNumber is no longer unique - a multi-line Party Order (or a
    // Customer Order split across stock + production) can have more than
    // one finished-stock entry sharing the same job number, one per line.
    return this.prisma.finishedStockItem.create({
      data: {
        jobNumber: dto.jobNumber,
        productName: dto.productName,
        quantity: dto.quantity ?? 1,
        completionDate: new Date(dto.completionDate),
        location: dto.location,
        status: dto.status ?? 'AVAILABLE',
      },
    });
  }

  async update(id: string, dto: UpdateFinishedStockDto) {
    await this.findOne(id);
    return this.prisma.finishedStockItem.update({
      where: { id },
      data: {
        productName: dto.productName,
        quantity: dto.quantity,
        completionDate: dto.completionDate ? new Date(dto.completionDate) : undefined,
        location: dto.location,
        status: dto.status,
      },
    });
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.finishedStockItem.delete({ where: { id } });
    return { success: true };
  }
}
