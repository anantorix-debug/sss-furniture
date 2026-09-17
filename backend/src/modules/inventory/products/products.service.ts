import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { promises as fs } from 'fs';
import { extname, join } from 'path';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { Role } from '../../../common/enums/role.enum';
import { paginate, toSkipTake } from '../../../common/utils/pagination.util';

const HIDE_FINANCIALS_FOR: Role[] = [Role.CARPENTER, Role.CARVER, Role.POLISHER];

// Decimal fields serialize to strings by default (e.g. "9200"), which
// silently turns numeric use on the client into string concatenation
// (0 + "9200" + "24000" -> "0920024000"). Convert them to real numbers here
// so every consumer of this API gets correctly-typed data. Also strips
// pricing entirely for Carpenter/Polisher viewers - they need the catalogue
// for product identification (name, image, size), never cost/margin.
function withNumericPrices<T extends { retailPrice: any; wholesalePrice: any; costPrice: any }>(
  product: T,
  viewerRole?: Role,
) {
  if (viewerRole && HIDE_FINANCIALS_FOR.includes(viewerRole)) {
    const { retailPrice, wholesalePrice, costPrice, ...rest } = product as any;
    return rest;
  }
  return {
    ...product,
    retailPrice: Number(product.retailPrice),
    wholesalePrice: product.wholesalePrice != null ? Number(product.wholesalePrice) : null,
    costPrice: product.costPrice != null ? Number(product.costPrice) : null,
  };
}

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'products');

@Injectable()
export class ProductsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  private readonly imagesInclude = { images: { orderBy: { isPrimary: 'desc' as const } } };

  // Opt-in pagination - see the identical note on CustomerOrdersService.findAll.
  async findAll(params: {
    search?: string;
    category?: string;
    modelNo?: string;
    finish?: string;
    stockStatus?: 'IN_STOCK' | 'OUT_OF_STOCK';
    sourceBatchId?: string;
    viewerRole?: Role;
    page?: number;
    limit?: number;
  }) {
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where = {
      category: params.category || undefined,
      modelNo: params.modelNo || undefined,
      materialFinish: params.finish ? { contains: params.finish } : undefined,
      availableQuantity: params.stockStatus === 'IN_STOCK' ? { gt: 0 } : params.stockStatus === 'OUT_OF_STOCK' ? { lte: 0 } : undefined,
      sourceBatchId: params.sourceBatchId || undefined,
      OR: params.search
        ? [
            { name: { contains: params.search } },
            { sku: { contains: params.search } },
            { modelNo: { contains: params.search } },
            { category: { contains: params.search } },
          ]
        : undefined,
    };
    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        include: this.imagesInclude,
        orderBy: { name: 'asc' },
        ...(paginated ? toSkipTake(page, limit) : {}),
      }),
      paginated ? this.prisma.product.count({ where }) : Promise.resolve(0),
    ]);
    const mapped = products.map((p) => withNumericPrices(p, params.viewerRole));
    return paginated ? paginate(mapped, total, page, limit) : mapped;
  }

  async findOne(id: string, viewerRole?: Role) {
    const product = await this.prisma.product.findUnique({ where: { id }, include: this.imagesInclude });
    if (!product) throw new NotFoundException('Product not found');
    return withNumericPrices(product, viewerRole);
  }

  private async assertUnique(dto: { sku?: string; modelNo?: string }, excludeId?: string) {
    if (dto.sku) {
      const existing = await this.prisma.product.findUnique({ where: { sku: dto.sku } });
      if (existing && existing.id !== excludeId) throw new ConflictException('A product with this SKU already exists');
    }
    if (dto.modelNo) {
      const existing = await this.prisma.product.findUnique({ where: { modelNo: dto.modelNo } });
      if (existing && existing.id !== excludeId) throw new ConflictException('A product with this Model No already exists');
    }
  }

  // Every Model No is exactly one physical piece - quantity is always 1,
  // never accepted from the client. There is no "Add Stock"/top-up: once a
  // piece is sold it's sold, and a new physical piece is a new row (either
  // Add Product again, or via Production completing - see
  // CarpenterService.applyCompletionToStock).
  async create(dto: CreateProductDto, userId?: string) {
    await this.assertUnique(dto);
    const product = await this.prisma.product.create({
      data: { ...dto, quantity: 1, availableQuantity: 1 },
      include: this.imagesInclude,
    });
    if (userId) {
      await this.prisma.productStockMovement.create({
        data: {
          productId: product.id,
          type: 'IN',
          quantity: 1,
          previousAvailable: 0,
          newAvailable: 1,
          reason: 'Added to stock',
          createdById: userId,
        },
      });
    }
    return withNumericPrices(product);
  }

  async update(id: string, dto: UpdateProductDto, userId?: string) {
    await this.findOne(id);
    await this.assertUnique(dto, id);
    const product = await this.prisma.product.update({ where: { id }, data: dto, include: this.imagesInclude });
    await this.audit.log({ userId, action: 'PRODUCT_UPDATED', targetType: 'Product', targetId: id, metadata: { fields: Object.keys(dto) } });
    return withNumericPrices(product);
  }

  async findMovements(params: { productId?: string; type?: string; page?: number; limit?: number }) {
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where = { productId: params.productId || undefined, type: params.type as any };
    const [movements, total] = await Promise.all([
      this.prisma.productStockMovement.findMany({
        where,
        include: { product: { select: { id: true, name: true, modelNo: true } }, createdBy: { select: { id: true, name: true } } },
        orderBy: { createdAt: 'desc' },
        take: paginated ? limit : 200,
        ...(paginated ? toSkipTake(page, limit) : {}),
      }),
      paginated ? this.prisma.productStockMovement.count({ where }) : Promise.resolve(0),
    ]);
    return paginated ? paginate(movements, total, page, limit) : movements;
  }

  async remove(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');

    // Every Product row starts life at quantity/availableQuantity: 1 (see
    // create() - "one Model No = one physical piece", not a multi-unit
    // count), so checking quantity > 0 would block literally every product
    // ever created, including ones nobody has touched yet. reservedQuantity
    // is the real signal: it's only ever set once this piece is actually
    // allocated to a live order (StockAllocationService).
    if (product.reservedQuantity > 0) {
      throw new ConflictException(
        'This product is currently reserved for a live order and cannot be deleted. Cancel or edit that order first, or mark this product Inactive instead.',
      );
    }
    const [orderItemCount, partyOrderItemCount, workItemCount, finishedStockCount, movementCount] = await Promise.all([
      this.prisma.customerOrderItem.count({ where: { productId: id } }),
      this.prisma.partyOrderItem.count({ where: { productId: id } }),
      this.prisma.carpenterWorkItem.count({ where: { productId: id } }),
      this.prisma.finishedStockItem.count({ where: { productId: id } }),
      // > 1, not > 0 - every product gets exactly one "Added to stock" IN
      // movement at creation (see create()); that alone doesn't mean
      // anything has actually happened to this piece since. Deleting
      // cascades that history away (schema: onDelete Cascade), so any
      // movement beyond the creation one - a dispatch, adjustment, or
      // reservation/release - is what makes this unsafe to remove.
      this.prisma.productStockMovement.count({ where: { productId: id } }),
    ]);
    if (orderItemCount > 0 || partyOrderItemCount > 0 || workItemCount > 0 || finishedStockCount > 0 || movementCount > 1) {
      throw new ConflictException(
        'This product is referenced by existing orders, production, or stock history and cannot be deleted. Mark it Inactive instead to hide it from new orders.',
      );
    }

    await this.prisma.product.delete({ where: { id } });
    return { success: true };
  }

  // Narrow, non-Admin-gated Model No entry for a Stock Production piece -
  // mirrors CarpenterService.updateWorkItemModelNo's "the employee who
  // actually did the work can enter it" rule, but for a multi-unit STOCK
  // batch, where the resulting Product rows only exist *after* Admin
  // verification (see CarpenterService.verifyAndAddToStock), by which
  // point the worker has no Stock Management access to reach them any
  // other way. Anyone who worked any stage of the batch (Carpenter/
  // Carving/Polish) - not just whoever verified it - may set it, since a
  // Model No is typically decided during Carpenter/Carving, before Polish
  // even starts.
  async updateModelNo(id: string, modelNo: string, userId: string, viewerRole?: Role) {
    const trimmed = modelNo.trim();
    if (!trimmed) throw new BadRequestException('Model No cannot be empty');

    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');

    const isAdmin = viewerRole === Role.SUPERADMIN || viewerRole === Role.ADMIN;
    if (!isAdmin) {
      if (!product.sourceBatchId) {
        throw new ForbiddenException('This stock item was not created from a production batch - ask an Admin to set its Model No.');
      }
      const ownWorkItem = await this.prisma.carpenterWorkItem.findFirst({
        where: { batchId: product.sourceBatchId, carpenter: { userId } },
      });
      if (!ownWorkItem) {
        throw new ForbiddenException('This piece was not produced by you.');
      }
    }

    await this.assertUnique({ modelNo: trimmed }, id);
    await this.prisma.product.update({ where: { id }, data: { modelNo: trimmed } });
    await this.audit.log({
      userId,
      action: 'MODEL_NO_UPDATED',
      targetType: 'Product',
      targetId: id,
      metadata: { modelNo: trimmed, source: 'STOCK_BATCH' },
    });
    return this.findOne(id, viewerRole);
  }

  // --- Product images ---------------------------------------------------
  // Stored on local disk (no object storage in this project) and served
  // statically from /uploads/products - same "local uploads dir" approach
  // as the rest of the app's file handling.

  async addImage(productId: string, file: Express.Multer.File, userId: string) {
    await this.findOne(productId);

    await fs.mkdir(UPLOAD_DIR, { recursive: true });
    const filename = `${randomUUID()}${extname(file.originalname).toLowerCase() || '.jpg'}`;
    await fs.writeFile(join(UPLOAD_DIR, filename), file.buffer);

    const existingCount = await this.prisma.productImage.count({ where: { productId } });
    const image = await this.prisma.productImage.create({
      data: {
        productId,
        url: `/uploads/products/${filename}`,
        fileName: file.originalname,
        fileSize: file.size,
        isPrimary: existingCount === 0,
      },
    });

    await this.audit.log({
      userId,
      action: 'PRODUCT_IMAGE_ADDED',
      targetType: 'Product',
      targetId: productId,
      metadata: { fileName: file.originalname, fileSize: file.size },
    });

    return image;
  }

  async removeImage(productId: string, imageId: string, userId: string) {
    const image = await this.prisma.productImage.findUnique({ where: { id: imageId } });
    if (!image || image.productId !== productId) throw new NotFoundException('Image not found');

    await this.prisma.productImage.delete({ where: { id: imageId } });
    await fs
      .unlink(join(process.cwd(), 'uploads', 'products', image.url.split('/').pop()!))
      .catch(() => undefined); // file already gone is fine - DB record is the source of truth

    if (image.isPrimary) {
      const next = await this.prisma.productImage.findFirst({ where: { productId }, orderBy: { createdAt: 'asc' } });
      if (next) await this.prisma.productImage.update({ where: { id: next.id }, data: { isPrimary: true } });
    }

    await this.audit.log({
      userId,
      action: 'PRODUCT_IMAGE_REMOVED',
      targetType: 'Product',
      targetId: productId,
      metadata: { fileName: image.fileName },
    });

    return { success: true };
  }

  async setPrimaryImage(productId: string, imageId: string) {
    const image = await this.prisma.productImage.findUnique({ where: { id: imageId } });
    if (!image || image.productId !== productId) throw new NotFoundException('Image not found');

    await this.prisma.$transaction([
      this.prisma.productImage.updateMany({ where: { productId }, data: { isPrimary: false } }),
      this.prisma.productImage.update({ where: { id: imageId }, data: { isPrimary: true } }),
    ]);
    return { success: true };
  }
}
