import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateFinishedStockDto } from './dto/create-finished-stock.dto';
import { UpdateFinishedStockDto } from './dto/update-finished-stock.dto';

@Injectable()
export class FinishedStockService {
  constructor(private prisma: PrismaService) {}

  findAll(status?: string) {
    return this.prisma.finishedStockItem.findMany({
      where: status ? { status: status as any } : undefined,
      include: { dispatchRecords: true },
      orderBy: { completionDate: 'desc' },
    });
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
    const existing = await this.prisma.finishedStockItem.findUnique({ where: { jobNumber: dto.jobNumber } });
    if (existing) throw new ConflictException('A finished stock entry already exists for this Job Number');
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
