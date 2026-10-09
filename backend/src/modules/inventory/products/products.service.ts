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
import { withNumericPrices } from '../../../common/utils/product-prices.util';
import { ModelNoService } from '../../model-no/model-no.service';
import { Prisma } from '@prisma/client';
import { PdfService } from '../../pdf/pdf.service';
import { escapeHtml, REPORT_PDF_STYLES, renderFilterSummary, renderGeneratedFooter, renderReportHeader } from '../../../common/utils/pdf-report.util';

const UPLOAD_DIR = join(process.cwd(), 'uploads', 'products');

@Injectable()
export class ProductsService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private modelNos: ModelNoService,
    private pdf: PdfService,
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
    // Listed by Model No as a number (1, 2, ... 10, 11 - not 1, 10, 100, 2);
    // products without a Model No come last, by name. Model No is text in
    // the database, so the order is worked out on the id list first and only
    // the requested page is then loaded in full.
    const keys = await this.prisma.product.findMany({ where, select: { id: true, modelNo: true, name: true } });
    keys.sort(compareByModelNo);
    const total = keys.length;
    const pageIds = (paginated ? keys.slice((page - 1) * limit, page * limit) : keys).map((k) => k.id);
    const rows = await this.prisma.product.findMany({ where: { id: { in: pageIds } }, include: this.imagesInclude });
    const byId = new Map(rows.map((r) => [r.id, r]));
    const products = pageIds.map((id) => byId.get(id)).filter((p): p is (typeof rows)[number] => !!p);
    const mapped = products.map((p) => withNumericPrices(p, params.viewerRole));
    return paginated ? paginate(mapped, total, page, limit) : mapped;
  }

  // Stock list PDF - every product matching the page's filters (not just the
  // page on screen), in the same Model No order as the list.
  async generateListPdf(params: Omit<Parameters<ProductsService['findAll']>[0], 'page' | 'limit'>): Promise<Buffer> {
    const products = (await this.findAll({ ...params, page: undefined })) as Array<Record<string, any>>;
    const money = (v: unknown) => (v == null ? '-' : `&#8377;${Number(v).toLocaleString('en-IN')}`);
    const rows = products
      .map(
        (p, i) => `<tr>
          <td>${i + 1}</td>
          <td>${escapeHtml(p.modelNo ?? '-')}</td>
          <td>${escapeHtml(p.name)}</td>
          <td>${escapeHtml(p.category ?? '-')}</td>
          <td>${escapeHtml([p.materialFinish, p.modelSize].filter(Boolean).join(' / ') || '-')}</td>
          <td style="text-align:right">${money(p.retailPrice)}</td>
          <td style="text-align:right">${(p.availableQuantity ?? 0) > 0 ? p.availableQuantity : 'Sold'}</td>
        </tr>`,
      )
      .join('');
    const filters = renderFilterSummary({
      Search: params.search,
      Finish: params.finish,
      'Stock Status': params.stockStatus === 'IN_STOCK' ? 'In Stock' : params.stockStatus === 'OUT_OF_STOCK' ? 'Sold / Out of Stock' : undefined,
    });
    const available = products.reduce((sum, p) => sum + Math.max(0, Number(p.availableQuantity ?? 0)), 0);
    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>${REPORT_PDF_STYLES}</style></head>
<body>
  ${renderReportHeader('Inventory - Stock List')}
  <div class="body">
    ${filters}
    <div class="summary">
      <div><div class="label">Products</div><div class="value">${products.length}</div></div>
      <div><div class="label">Available Units</div><div class="value">${available}</div></div>
      <div><div class="label">Out of Stock</div><div class="value">${products.filter((p) => (p.availableQuantity ?? 0) <= 0).length}</div></div>
    </div>
    <table>
      <thead><tr><th>#</th><th>Model No</th><th>Product</th><th>Category</th><th>Finish / Size</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Available</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="7" style="text-align:center">No products</td></tr>'}</tbody>
    </table>
    ${renderGeneratedFooter(products.length, 'product')}
  </div>
</body></html>`;
    return this.pdf.renderHtmlToPdf(html);
  }

  async findOne(id: string, viewerRole?: Role) {
    const product = await this.prisma.product.findUnique({ where: { id }, include: this.imagesInclude });
    if (!product) throw new NotFoundException('Product not found');
    return withNumericPrices(product, viewerRole);
  }

  // Model No lookup - one implementation (ModelNoService) behind every
  // page, form, import and production path.
  lookupModelNo(modelNo: string, viewerRole?: Role) {
    return this.modelNos.lookup(modelNo, viewerRole);
  }

  private async assertUnique(dto: { sku?: string; modelNo?: string }, excludeId?: string) {
    if (dto.sku) {
      const existing = await this.prisma.product.findUnique({ where: { sku: dto.sku } });
      if (existing && existing.id !== excludeId) throw new ConflictException('A product with this SKU already exists');
    }
    if (dto.modelNo) await this.modelNos.assertFree(dto.modelNo, excludeId);
  }

  // Every Model No is exactly one physical piece - quantity is always 1,
  // never accepted from the client. There is no "Add Stock"/top-up: once a
  // piece is sold it's sold, and a new physical piece is a new row (either
  // Add Product again, or via Production completing - see
  // CarpenterService.applyCompletionToStock).
  //
  // One product per Model No: when the Model No already exists as a
  // catalogue-only master (quantity 0 - registered from a Customer/Party
  // Order, never physically in stock) this adds the physical piece TO that
  // same master instead of failing or duplicating it: blank fields are
  // filled from the form (nothing already there is overwritten), and stock
  // goes 0 -> 1 with the usual "Added to stock" movement. A Model No that
  // already has a real piece (in stock or sold) is refused with the
  // owner's name.
  async create(dto: CreateProductDto, userId?: string) {
    const modelNo = this.modelNos.optionalClean(dto.modelNo);
    if (modelNo) {
      const existing = await this.modelNos.findProduct(modelNo);
      if (existing && existing.quantity === 0) return this.adoptCatalogueProduct(existing.id, { ...dto, modelNo }, userId);
    }
    await this.assertUnique({ ...dto, modelNo });
    let product;
    try {
      product = await this.prisma.product.create({
        data: { ...dto, modelNo, quantity: 1, availableQuantity: 1 },
        include: this.imagesInclude,
      });
    } catch (e) {
      // Two simultaneous Add Product calls for the same new Model No: the
      // unique index lets one win; the other gets a clear conflict.
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        await this.assertUnique({ ...dto, modelNo });
        throw new ConflictException('A product with this Model No or SKU already exists');
      }
      throw e;
    }
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

  // See create(): turns a quantity-0 catalogue master into the one physical
  // piece, in one transaction, and only if it is still quantity 0 when the
  // update runs (so a double submit adds the piece once, not twice).
  private async adoptCatalogueProduct(id: string, dto: CreateProductDto & { modelNo: string }, userId?: string) {
    const fill = <T>(current: T | null | undefined, incoming: T | null | undefined) => (current == null || current === ('' as unknown as T) ? (incoming ?? undefined) : undefined);
    const product = await this.prisma.$transaction(async (tx) => {
      const master = await tx.product.findUniqueOrThrow({ where: { id } });
      const claimed = await tx.product.updateMany({ where: { id, quantity: 0 }, data: { quantity: 1, availableQuantity: 1 } });
      if (claimed.count === 0) throw new ConflictException(`Model No ${dto.modelNo} already belongs to "${master.name}" in inventory.`);
      const updated = await tx.product.update({
        where: { id },
        data: {
          category: fill(master.category, dto.category),
          modelSize: fill(master.modelSize, dto.modelSize),
          materialFinish: fill(master.materialFinish, dto.materialFinish),
          sizeUnit: fill(master.sizeUnit, dto.sizeUnit),
          pattern: fill(master.pattern, dto.pattern),
          details: fill(master.details, dto.details),
          unit: fill(master.unit, dto.unit),
          sku: fill(master.sku, dto.sku),
          wholesalePrice: master.wholesalePrice == null ? dto.wholesalePrice : undefined,
          costPrice: master.costPrice == null ? dto.costPrice : undefined,
          retailPrice: Number(master.retailPrice) === 0 ? dto.retailPrice : undefined,
        },
        include: this.imagesInclude,
      });
      if (userId) {
        await tx.productStockMovement.create({
          data: {
            productId: id,
            type: 'IN',
            quantity: 1,
            previousAvailable: 0,
            newAvailable: 1,
            reason: 'Added to stock (existing catalogue Model No)',
            createdById: userId,
          },
        });
      }
      return updated;
    });
    return withNumericPrices(product);
  }

  async update(id: string, dto: UpdateProductDto, userId?: string) {
    await this.findOne(id);
    if (dto.modelNo !== undefined) dto = { ...dto, modelNo: this.modelNos.optionalClean(dto.modelNo) };
    await this.assertUnique(dto, id);
    let product;
    try {
      product = await this.prisma.product.update({ where: { id }, data: dto, include: this.imagesInclude });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        await this.assertUnique(dto, id);
        throw new ConflictException('A product with this Model No or SKU already exists');
      }
      throw e;
    }
    await this.audit.log({ userId, action: 'PRODUCT_UPDATED', targetType: 'Product', targetId: id, metadata: { fields: Object.keys(dto) } });
    return withNumericPrices(product);
  }

  async findMovements(params: { productId?: string; type?: string; page?: number; limit?: number }) {
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    // product: { is: {} } skips any leftover movement whose product was deleted -
    // its FK cascade isn't guaranteed on every database, and one orphan row
    // makes the whole include fail with a 500.
    const where = { productId: params.productId || undefined, type: params.type as any, product: { is: {} } };
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

  async remove(id: string, userId?: string, force = false, viewerRole?: Role) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');

    // Every Product row starts life at quantity/availableQuantity: 1 (see
    // create() - "one Model No = one physical piece", not a multi-unit
    // count), so checking quantity > 0 would block literally every product
    // ever created, including ones nobody has touched yet. reservedQuantity
    // is the real signal: it's only ever set once this piece is actually
    // allocated to a live order (StockAllocationService) - never
    // force-bypassable, even for Super Admin: the order still thinks it has
    // this exact piece reserved, and deleting the row out from under it
    // would break that order's fulfillment, not just lose history. Edit or
    // cancel that order first.
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
    const hasHistory = orderItemCount > 0 || partyOrderItemCount > 0 || workItemCount > 0 || finishedStockCount > 0 || movementCount > 1;

    if (hasHistory && !(force && viewerRole === Role.SUPERADMIN)) {
      if (force) throw new ForbiddenException('Only Super Admin can force this delete through');
      throw new ConflictException(
        'This product is referenced by existing orders, production, or stock history and cannot be deleted. Mark it Inactive instead to hide it from new orders.',
      );
    }

    if (hasHistory && userId) {
      // Force path (SUPERADMIN only) - order/work-item/finished-stock
      // references just lose the "which catalogue product" link
      // (productId is nullable + SetNull everywhere it's referenced from);
      // this product's own ProductStockMovement ledger cascade-deletes,
      // same bounded category as RawMaterial's own stock ledger under force.
      await this.audit.log({
        userId,
        action: 'FORCE_DELETE_PRODUCT',
        targetType: 'Product',
        targetId: id,
        metadata: { name: product.name, modelNo: product.modelNo, orderItemCount, partyOrderItemCount, workItemCount, finishedStockCount, movementCount },
      });
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
    const trimmed = this.modelNos.requireClean(modelNo);

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
    try {
      await this.prisma.product.update({ where: { id }, data: { modelNo: trimmed } });
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        await this.assertUnique({ modelNo: trimmed }, id);
      }
      throw e;
    }
    // Whoever actually set this Model No - Admin via the order form, or a
    // Carpenter here via their own piece - is who every order line linking
    // to this product should credit, not whoever created the line
    // originally. Every CustomerOrderItem across every order sharing this
    // catalog product gets re-attributed to this call's user.
    await this.prisma.customerOrderItem.updateMany({
      where: { productId: id },
      data: { modelNoSetById: userId, modelNoSetAt: new Date() },
    });
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

// Model No order: numbers ascending, then any non-number Model No (e.g. a Job
// No) alphabetically, then products with no Model No, each tie broken by name.
function compareByModelNo(a: { modelNo: string | null; name: string }, b: { modelNo: string | null; name: string }) {
  const rank = (m: string | null) => (m == null || m.trim() === '' ? 2 : /^\d+$/.test(m.trim()) ? 0 : 1);
  const ra = rank(a.modelNo);
  const rb = rank(b.modelNo);
  if (ra !== rb) return ra - rb;
  if (ra === 0) {
    const d = Number(a.modelNo) - Number(b.modelNo);
    if (d !== 0) return d;
  } else if (ra === 1) {
    const d = a.modelNo!.localeCompare(b.modelNo!, undefined, { numeric: true });
    if (d !== 0) return d;
  }
  return a.name.localeCompare(b.name);
}
