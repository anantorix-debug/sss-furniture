import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateShopDto } from './dto/create-shop.dto';
import { UpdateShopDto } from './dto/update-shop.dto';

@Injectable()
export class ShopsService {
  constructor(private prisma: PrismaService) {}

  findAll(params: { includeInactive?: boolean } = {}) {
    return this.prisma.shop.findMany({
      where: params.includeInactive ? undefined : { isActive: true },
      orderBy: { name: 'asc' },
    });
  }

  async findOne(id: string) {
    const shop = await this.prisma.shop.findUnique({ where: { id } });
    if (!shop) throw new NotFoundException('Shop not found');
    return shop;
  }

  async create(dto: CreateShopDto) {
    const existing = await this.prisma.shop.findUnique({ where: { name: dto.name } });
    if (existing) throw new ConflictException('A shop with this name already exists');
    return this.prisma.shop.create({ data: dto });
  }

  async update(id: string, dto: UpdateShopDto) {
    await this.findOne(id);
    if (dto.name) {
      const existing = await this.prisma.shop.findUnique({ where: { name: dto.name } });
      if (existing && existing.id !== id) throw new ConflictException('A shop with this name already exists');
    }
    return this.prisma.shop.update({ where: { id }, data: dto });
  }

  // Deletes when unreferenced; a shop with order history is disabled
  // instead (isActive: false via update) so past Party Orders keep a valid
  // shop reference - same pattern as ExpenseCategoryService.removeCategory.
  async remove(id: string) {
    await this.findOne(id);
    const orderCount = await this.prisma.partyOrder.count({ where: { shopId: id } });
    if (orderCount > 0) {
      throw new ConflictException(
        'This shop has Party Order history and cannot be deleted. Disable it instead (edit -> Inactive) to hide it from new orders.',
      );
    }
    await this.prisma.shop.delete({ where: { id } });
    return { success: true };
  }
}
