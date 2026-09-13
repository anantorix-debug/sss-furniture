import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { PdfService } from '../../pdf/pdf.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { paginate, toSkipTake } from '../../../common/utils/pagination.util';
import { computeBoardFeet } from '../../../common/utils/board-feet.util';
import { generatePurchaseNumber } from '../../../common/utils/purchase-number.util';
import { REPORT_PDF_STYLES, renderReportHeader, renderFilterSummary, renderGeneratedFooter } from '../../../common/utils/pdf-report.util';

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

@Injectable()
export class PurchasesService {
  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
    private pdf: PdfService,
  ) {}

  private withTotal<T extends { items: { quantity: any; unitPrice: any }[] }>(purchase: T) {
    const totalValue = purchase.items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitPrice), 0);
    return { ...purchase, totalValue };
  }

  // Resolves each line's RawMaterial (one batch query, not N) and, for a
  // BOARD_FEET material, overrides the client-sent quantity with the
  // server-computed Total Board Feet from the four dimension fields - the
  // client's quantity is never trusted for those lines. Shared by
  // create/update so a purchase's items always mean the same thing
  // regardless of which call built them.
  private async resolveItemsInput(items: CreatePurchaseDto['items']) {
    const materials = await this.prisma.rawMaterial.findMany({
      where: { id: { in: items.map((i) => i.rawMaterialId) } },
      select: { id: true, measurementKind: true },
    });
    const byId = new Map(materials.map((m) => [m.id, m]));

    return items.map((item) => {
      const material = byId.get(item.rawMaterialId);
      if (!material) throw new NotFoundException(`Raw material ${item.rawMaterialId} not found`);

      const isBoardFeet = material.measurementKind === 'BOARD_FEET';
      const quantity = isBoardFeet
        ? computeBoardFeet({ thicknessIn: item.thicknessIn, widthIn: item.widthIn, lengthFt: item.lengthFt, pieces: item.pieces })
        : item.quantity;

      return {
        rawMaterialId: item.rawMaterialId,
        quantity,
        unitPrice: item.unitPrice,
        thicknessIn: isBoardFeet ? item.thicknessIn : undefined,
        widthIn: isBoardFeet ? item.widthIn : undefined,
        lengthFt: isBoardFeet ? item.lengthFt : undefined,
        pieces: isBoardFeet ? item.pieces : undefined,
      };
    });
  }

  // Opt-in pagination - see the identical note on CustomerOrdersService.findAll.
  async findAll(params: { status?: string; supplierId?: string; search?: string; page?: number; limit?: number }) {
    const paginated = params.page != null;
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const where = {
      status: params.status as any,
      supplierId: params.supplierId,
      OR: params.search
        ? [{ purchaseNumber: { contains: params.search } }, { supplier: { name: { contains: params.search } } }]
        : undefined,
    };
    const [purchases, total] = await Promise.all([
      this.prisma.purchase.findMany({
        where,
        include: {
          items: { include: { rawMaterial: { select: { id: true, name: true, unit: true } } } },
          supplier: { select: { id: true, name: true } },
          createdBy: { select: { name: true } },
        },
        orderBy: { purchaseDate: 'desc' },
        ...(paginated ? toSkipTake(page, limit) : {}),
      }),
      paginated ? this.prisma.purchase.count({ where }) : Promise.resolve(0),
    ]);
    const mapped = purchases.map((p) => this.withTotal(p));
    return paginated ? paginate(mapped, total, page, limit) : mapped;
  }

  async findOne(id: string) {
    const purchase = await this.prisma.purchase.findUnique({
      where: { id },
      include: {
        items: { include: { rawMaterial: { select: { id: true, name: true, unit: true } } } },
        supplier: true,
        createdBy: { select: { name: true } },
      },
    });
    if (!purchase) throw new NotFoundException('Purchase not found');
    return this.withTotal(purchase);
  }

  async create(dto: CreatePurchaseDto, userId: string) {
    const items = await this.resolveItemsInput(dto.items);
    const purchaseNumber = await generatePurchaseNumber(this.prisma);
    const purchaseDate = new Date(dto.purchaseDate);

    const purchase = await this.prisma.$transaction(async (tx) => {
      const created = await tx.purchase.create({
        data: {
          purchaseNumber,
          supplierId: dto.supplierId,
          purchaseDate,
          notes: dto.notes,
          createdById: userId,
          items: { create: items },
        },
        include: { items: { include: { rawMaterial: { select: { id: true, name: true, unit: true } } } } },
      });

      await tx.stockMovement.createMany({
        data: created.items.map((item) => ({
          rawMaterialId: item.rawMaterialId,
          type: 'IN' as const,
          quantity: item.quantity,
          unitCost: item.unitPrice,
          reason: 'Purchase',
          purchaseId: created.id,
          date: purchaseDate,
          createdById: userId,
        })),
      });

      const totalValue = created.items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitPrice), 0);
      const particulars = created.items.map((i) => `${i.rawMaterial.name} (${Number(i.quantity)} ${i.rawMaterial.unit})`).join(', ');
      await tx.supplierPurchase.create({
        data: {
          supplierId: dto.supplierId,
          date: purchaseDate,
          particulars,
          value: totalValue,
          purchaseId: created.id,
          createdById: userId,
        },
      });

      return created;
    });

    return this.withTotal(purchase);
  }

  // "Safely reverse the old transaction and apply the new values" - never
  // delete/mutate the original StockMovement rows (they're the material's
  // permanent ledger, shown row-by-row in Movement History), so an edit is
  // expressed as a reversing ADJUSTMENT for each old line plus a fresh IN
  // for each new line. Net stock impact = the new quantity only, exactly
  // matching the rule that editing 20->30 must land on +30, not +50.
  async update(id: string, dto: UpdatePurchaseDto, userId: string) {
    const existing = await this.prisma.purchase.findUnique({
      where: { id },
      include: { items: { include: { rawMaterial: { select: { id: true, name: true, unit: true } } } } },
    });
    if (!existing) throw new NotFoundException('Purchase not found');
    if (existing.status === 'CANCELLED') {
      throw new BadRequestException('A cancelled purchase cannot be edited');
    }

    const newItems = dto.items ? await this.resolveItemsInput(dto.items) : undefined;
    const purchaseDate = dto.purchaseDate ? new Date(dto.purchaseDate) : existing.purchaseDate;
    const supplierId = dto.supplierId ?? existing.supplierId;

    const purchase = await this.prisma.$transaction(async (tx) => {
      if (newItems) {
        // Reverse every old line via an offsetting ADJUSTMENT (never delete
        // the original IN movement) before replacing the item rows.
        if (existing.items.length > 0) {
          await tx.stockMovement.createMany({
            data: existing.items.map((item) => ({
              rawMaterialId: item.rawMaterialId,
              type: 'ADJUSTMENT' as const,
              quantity: -Number(item.quantity),
              reason: `Purchase ${existing.purchaseNumber} edited - reversing previous entry`,
              purchaseId: id,
              date: new Date(),
              createdById: userId,
            })),
          });
        }

        await tx.purchaseItem.deleteMany({ where: { purchaseId: id } });
        await tx.purchase.update({ where: { id }, data: { items: { create: newItems } } });

        const created = await tx.purchase.findUniqueOrThrow({
          where: { id },
          include: { items: { include: { rawMaterial: { select: { id: true, name: true, unit: true } } } } },
        });

        await tx.stockMovement.createMany({
          data: created.items.map((item) => ({
            rawMaterialId: item.rawMaterialId,
            type: 'IN' as const,
            quantity: item.quantity,
            unitCost: item.unitPrice,
            reason: 'Purchase',
            purchaseId: id,
            date: purchaseDate,
            createdById: userId,
          })),
        });

        const totalValue = created.items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitPrice), 0);
        const particulars = created.items.map((i) => `${i.rawMaterial.name} (${Number(i.quantity)} ${i.rawMaterial.unit})`).join(', ');
        // The ledger only ever needs to reflect this purchase's *current*
        // total (unlike StockMovement, no row-by-row ledger UI renders
        // SupplierPurchase directly) - update the existing row in place.
        await tx.supplierPurchase.updateMany({
          where: { purchaseId: id },
          data: { supplierId, date: purchaseDate, particulars, value: totalValue },
        });
      } else if (dto.supplierId || dto.purchaseDate) {
        await tx.supplierPurchase.updateMany({ where: { purchaseId: id }, data: { supplierId, date: purchaseDate } });
      }

      return tx.purchase.update({
        where: { id },
        data: { supplierId, purchaseDate, notes: dto.notes },
        include: { items: { include: { rawMaterial: { select: { id: true, name: true, unit: true } } } } },
      });
    });

    return this.withTotal(purchase);
  }

  // "Reverse stock impact... create an audit/movement record... do not
  // physically delete historical financial/stock transactions" - a
  // cancellation is an offsetting ADJUSTMENT per line plus an offsetting
  // negative SupplierPurchase entry, never a delete of the originals.
  async cancel(id: string, userId: string) {
    const existing = await this.prisma.purchase.findUnique({
      where: { id },
      include: { items: { include: { rawMaterial: { select: { id: true, name: true, unit: true } } } } },
    });
    if (!existing) throw new NotFoundException('Purchase not found');
    if (existing.status === 'CANCELLED') {
      throw new BadRequestException('This purchase is already cancelled');
    }

    await this.prisma.$transaction(async (tx) => {
      if (existing.items.length > 0) {
        await tx.stockMovement.createMany({
          data: existing.items.map((item) => ({
            rawMaterialId: item.rawMaterialId,
            type: 'ADJUSTMENT' as const,
            quantity: -Number(item.quantity),
            reason: `Purchase ${existing.purchaseNumber} cancelled`,
            purchaseId: id,
            date: new Date(),
            createdById: userId,
          })),
        });
      }

      const totalValue = existing.items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitPrice), 0);
      await tx.supplierPurchase.create({
        data: {
          supplierId: existing.supplierId,
          date: new Date(),
          particulars: `Purchase ${existing.purchaseNumber} cancelled`,
          value: -totalValue,
          purchaseId: id,
          createdById: userId,
        },
      });

      await tx.purchase.update({ where: { id }, data: { status: 'CANCELLED' } });
    });

    return this.findOne(id);
  }

  private buildPdfHtml(purchase: Awaited<ReturnType<PurchasesService['findOne']>>): string {
    const rows = purchase.items
      .map(
        (i) => `<tr>
          <td>${escapeHtml(i.rawMaterial.name)}</td>
          <td style="text-align:right">${Number(i.quantity)}</td>
          <td>${escapeHtml(i.rawMaterial.unit)}</td>
          <td style="text-align:right">₹${Number(i.unitPrice).toLocaleString('en-IN')}</td>
          <td style="text-align:right">₹${(Number(i.quantity) * Number(i.unitPrice)).toLocaleString('en-IN')}</td>
        </tr>`,
      )
      .join('');

    return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>
  body { font-family: Arial, Helvetica, sans-serif; color: #1f2933; margin: 0; }
  .header { background: #80011f; color: #fff; padding: 24px 28px; }
  .header h1 { margin: 0; font-size: 20px; }
  .header p { margin: 4px 0 0; font-size: 12px; color: #f5c2c9; }
  .body { padding: 24px 28px; }
  .meta { display: flex; justify-content: space-between; margin-bottom: 20px; font-size: 13px; }
  .meta div { line-height: 1.6; }
  table { width: 100%; border-collapse: collapse; font-size: 12.5px; }
  th { background: #f4f2ec; text-align: left; padding: 8px 10px; border-bottom: 1px solid #e3e1d9; }
  td { padding: 8px 10px; border-bottom: 1px solid #efede6; }
  .total-row td { font-weight: bold; border-top: 2px solid #1f2933; }
  .notes { margin-top: 20px; font-size: 12px; color: #6b7280; }
</style></head>
<body>
  <div class="header">
    <h1>Purchase - ${escapeHtml(purchase.purchaseNumber)}</h1>
    <p>SSS Company</p>
  </div>
  <div class="body">
    <div class="meta">
      <div>
        <strong>Supplier</strong><br/>
        ${escapeHtml(purchase.supplier.name)}<br/>
        ${purchase.supplier.phone ? escapeHtml(purchase.supplier.phone) : ''}
      </div>
      <div style="text-align:right">
        <strong>Purchase Date</strong>: ${purchase.purchaseDate.toLocaleDateString('en-IN')}<br/>
        <strong>Status</strong>: ${purchase.status}
      </div>
    </div>
    <table>
      <thead><tr><th>Material</th><th style="text-align:right">Qty</th><th>Unit</th><th style="text-align:right">Rate</th><th style="text-align:right">Line Total</th></tr></thead>
      <tbody>
        ${rows}
        <tr class="total-row"><td colspan="4" style="text-align:right">Total</td><td style="text-align:right">₹${purchase.totalValue.toLocaleString('en-IN')}</td></tr>
      </tbody>
    </table>
    ${purchase.notes ? `<div class="notes"><strong>Notes:</strong> ${escapeHtml(purchase.notes)}</div>` : ''}
  </div>
</body></html>`;
  }

  async generatePdf(id: string): Promise<Buffer> {
    const purchase = await this.findOne(id);
    const html = this.buildPdfHtml(purchase);
    return this.pdf.renderHtmlToPdf(html);
  }

  async sendPdfToSupplier(id: string) {
    const purchase = await this.findOne(id);
    if (!purchase.supplier.phone) {
      return { sent: false, reason: 'no_supplier_phone' as const };
    }
    const buffer = await this.generatePdf(id);
    return this.whatsapp.sendDocument(purchase.supplier.phone, {
      buffer,
      filename: `${purchase.purchaseNumber}.pdf`,
      mimetype: 'application/pdf',
      caption: `Purchase ${purchase.purchaseNumber} - SSS Company`,
    });
  }

  // Purchase list PDF - exactly the filtered rows the list page is
  // showing, never the whole table.
  async generateListPdf(params: { status?: string; supplierId?: string; search?: string }): Promise<Buffer> {
    const purchases = (await this.findAll(params)) as any[];
    const rows = purchases
      .map(
        (p) => `<tr>
          <td>${escapeHtml(p.purchaseNumber)}</td>
          <td>${p.purchaseDate.toLocaleDateString('en-IN')}</td>
          <td>${escapeHtml(p.supplier?.name ?? '-')}</td>
          <td>${p.items.length}</td>
          <td style="text-align:right">₹${p.totalValue.toLocaleString('en-IN')}</td>
          <td>${escapeHtml(String(p.status))}</td>
        </tr>`,
      )
      .join('');

    const filterSummary = renderFilterSummary({
      Search: params.search,
      Status: params.status,
    });

    const html = `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<style>${REPORT_PDF_STYLES}</style></head>
<body>
  ${renderReportHeader('Purchases')}
  <div class="body">
    ${filterSummary}
    <table>
      <thead><tr><th>Purchase No</th><th>Date</th><th>Supplier</th><th>Items</th><th style="text-align:right">Total</th><th>Status</th></tr></thead>
      <tbody>${rows || '<tr><td colspan="6" style="text-align:center;color:#9ca3af;padding:16px">No purchases found</td></tr>'}</tbody>
    </table>
    ${renderGeneratedFooter(purchases.length, 'purchase')}
  </div>
</body></html>`;
    return this.pdf.renderHtmlToPdf(html);
  }
}
