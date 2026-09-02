import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { WhatsappService } from '../whatsapp/whatsapp.service';
import { PdfService } from '../pdf/pdf.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { RejectPurchaseOrderDto } from './dto/reject-purchase-order.dto';

function generatePoNumber(): string {
  return `PO-${Date.now().toString(36).toUpperCase()}`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private prisma: PrismaService,
    private whatsapp: WhatsappService,
    private pdf: PdfService,
  ) {}

  private withTotal<T extends { items: { quantity: any; unitPrice: any }[] }>(po: T) {
    const totalValue = po.items.reduce((sum, i) => sum + Number(i.quantity) * Number(i.unitPrice), 0);
    return { ...po, totalValue };
  }

  async findAll(params: { status?: string; supplierId?: string }) {
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { status: params.status as any, supplierId: params.supplierId },
      include: { items: true, supplier: { select: { id: true, name: true } }, createdBy: { select: { name: true } } },
      orderBy: { orderDate: 'desc' },
    });
    return orders.map((o) => this.withTotal(o));
  }

  async findOne(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id },
      include: {
        items: { include: { rawMaterial: { select: { id: true, name: true, unit: true } } } },
        supplier: true,
        createdBy: { select: { name: true } },
        approvedBy: { select: { name: true } },
      },
    });
    if (!po) throw new NotFoundException('Purchase order not found');
    return this.withTotal(po);
  }

  async create(dto: CreatePurchaseOrderDto, userId: string) {
    const po = await this.prisma.purchaseOrder.create({
      data: {
        poNumber: generatePoNumber(),
        supplierId: dto.supplierId,
        orderDate: new Date(dto.orderDate),
        expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
        notes: dto.notes,
        createdById: userId,
        items: { create: dto.items.map((i) => ({ rawMaterialId: i.rawMaterialId, quantity: i.quantity, unitPrice: i.unitPrice })) },
      },
      include: { items: true },
    });
    return this.withTotal(po);
  }

  async update(id: string, dto: UpdatePurchaseOrderDto) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT' && existing.status !== 'REJECTED') {
      throw new BadRequestException('Only draft or rejected purchase orders can be edited');
    }

    if (dto.items) {
      await this.prisma.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
    }

    const po = await this.prisma.purchaseOrder.update({
      where: { id },
      data: {
        supplierId: dto.supplierId,
        orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined,
        expectedDate: dto.expectedDate ? new Date(dto.expectedDate) : undefined,
        notes: dto.notes,
        // Editing a rejected PO puts it back to draft so it goes through
        // the approval gate again rather than silently staying REJECTED.
        status: existing.status === 'REJECTED' ? 'DRAFT' : undefined,
        rejectionReason: existing.status === 'REJECTED' ? null : undefined,
        items: dto.items
          ? { create: dto.items.map((i) => ({ rawMaterialId: i.rawMaterialId, quantity: i.quantity, unitPrice: i.unitPrice })) }
          : undefined,
      },
      include: { items: true },
    });
    return this.withTotal(po);
  }

  async remove(id: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT' && existing.status !== 'REJECTED') {
      throw new BadRequestException('Only draft or rejected purchase orders can be deleted');
    }
    await this.prisma.purchaseOrder.delete({ where: { id } });
    return { success: true };
  }

  // Admin raises a PO as DRAFT, then explicitly submits it for Superadmin
  // approval - separated from create() so a draft can be revised freely
  // before it enters the approval queue.
  async submit(id: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'DRAFT') {
      throw new BadRequestException(`Cannot submit a purchase order with status ${existing.status}`);
    }
    await this.prisma.purchaseOrder.update({ where: { id }, data: { status: 'PENDING_APPROVAL' } });
    return this.findOne(id);
  }

  async approve(id: string, userId: string) {
    const existing = await this.findOne(id);
    if (!['DRAFT', 'PENDING_APPROVAL'].includes(existing.status)) {
      throw new BadRequestException(`Cannot approve a purchase order with status ${existing.status}`);
    }
    await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date(), rejectionReason: null },
    });
    return this.findOne(id);
  }

  async reject(id: string, dto: RejectPurchaseOrderDto, userId: string) {
    const existing = await this.findOne(id);
    if (!['DRAFT', 'PENDING_APPROVAL'].includes(existing.status)) {
      throw new BadRequestException(`Cannot reject a purchase order with status ${existing.status}`);
    }
    await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'REJECTED', approvedById: userId, approvedAt: new Date(), rejectionReason: dto.rejectionReason },
    });
    return this.findOne(id);
  }

  // Only a Superadmin-approved PO can be shared with the supplier - this
  // action is only reachable once status is APPROVED, so an Admin can
  // never route a purchase request to the shop without that approval gate.
  async sendToShop(id: string) {
    const existing = await this.findOne(id);
    if (existing.status !== 'APPROVED') {
      throw new BadRequestException('Only an approved purchase order can be sent to the shop');
    }

    await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'SENT_TO_SHOP', sentToShopAt: new Date() },
    });

    const po = await this.findOne(id);
    let whatsapp: { sent: boolean; reason?: string } | undefined;
    if (po.supplier.phone) {
      whatsapp = await this.whatsapp.sendPurchaseOrder({
        supplierName: po.supplier.name,
        phone: po.supplier.phone,
        poNumber: po.poNumber,
        orderDate: po.orderDate,
        expectedDate: po.expectedDate,
        items: po.items.map((i) => ({
          materialName: i.rawMaterial.name,
          quantity: Number(i.quantity),
          unit: i.rawMaterial.unit,
          unitPrice: Number(i.unitPrice),
        })),
        totalValue: po.totalValue,
        notes: po.notes,
      });
    } else {
      whatsapp = { sent: false, reason: 'no_supplier_phone' };
    }

    return { ...po, whatsapp };
  }

  async cancel(id: string) {
    const existing = await this.findOne(id);
    if (existing.status === 'RECEIVED') {
      throw new BadRequestException('A received purchase order cannot be cancelled');
    }
    await this.prisma.purchaseOrder.update({ where: { id }, data: { status: 'CANCELLED' } });
    return this.findOne(id);
  }

  /**
   * Receiving books it against inventory and finance in one step: a stock
   * IN movement per line item, plus a single SupplierPurchase ledger entry
   * for the total value (keeping the existing supplier payment ledger as
   * the one financial source of truth). Allowed from SENT_TO_SHOP (the
   * normal path) or APPROVED (grandfathers orders approved before the
   * send-to-shop step existed / lets stock be received without a supplier
   * phone number to notify).
   */
  async receive(id: string, userId: string) {
    const po = await this.findOne(id);
    if (po.status !== 'SENT_TO_SHOP' && po.status !== 'APPROVED') {
      throw new BadRequestException('Only an approved or sent-to-shop purchase order can be received');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.stockMovement.createMany({
        data: po.items.map((item) => ({
          rawMaterialId: item.rawMaterialId,
          type: 'IN' as const,
          quantity: item.quantity,
          unitCost: item.unitPrice,
          reason: `Received from PO ${po.poNumber}`,
          purchaseOrderId: po.id,
          date: new Date(),
          createdById: userId,
        })),
      });

      const particulars = po.items.map((i) => i.rawMaterial.name).join(', ');
      await tx.supplierPurchase.create({
        data: {
          supplierId: po.supplierId,
          date: new Date(),
          particulars: `PO ${po.poNumber}: ${particulars}`,
          value: po.totalValue,
          createdById: userId,
        },
      });

      await tx.purchaseOrder.update({ where: { id }, data: { status: 'RECEIVED' } });
    });

    return this.findOne(id);
  }

  private buildPdfHtml(po: Awaited<ReturnType<PurchaseOrdersService['findOne']>>): string {
    const rows = po.items
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
    <h1>Purchase Order - ${escapeHtml(po.poNumber)}</h1>
    <p>SSS Company</p>
  </div>
  <div class="body">
    <div class="meta">
      <div>
        <strong>Supplier</strong><br/>
        ${escapeHtml(po.supplier.name)}<br/>
        ${po.supplier.phone ? escapeHtml(po.supplier.phone) : ''}
      </div>
      <div style="text-align:right">
        <strong>Order Date</strong>: ${po.orderDate.toLocaleDateString('en-IN')}<br/>
        ${po.expectedDate ? `<strong>Expected By</strong>: ${po.expectedDate.toLocaleDateString('en-IN')}<br/>` : ''}
        <strong>Status</strong>: ${po.status.replace('_', ' ')}
      </div>
    </div>
    <table>
      <thead><tr><th>Material</th><th style="text-align:right">Qty</th><th>Unit</th><th style="text-align:right">Unit Price</th><th style="text-align:right">Line Total</th></tr></thead>
      <tbody>
        ${rows}
        <tr class="total-row"><td colspan="4" style="text-align:right">Total</td><td style="text-align:right">₹${po.totalValue.toLocaleString('en-IN')}</td></tr>
      </tbody>
    </table>
    ${po.notes ? `<div class="notes"><strong>Notes:</strong> ${escapeHtml(po.notes)}</div>` : ''}
  </div>
</body></html>`;
  }

  async generatePdf(id: string): Promise<Buffer> {
    const po = await this.findOne(id);
    const html = this.buildPdfHtml(po);
    return this.pdf.renderHtmlToPdf(html);
  }

  async sendPdfToSupplier(id: string) {
    const po = await this.findOne(id);
    if (!po.supplier.phone) {
      return { sent: false, reason: 'no_supplier_phone' as const };
    }
    const buffer = await this.generatePdf(id);
    return this.whatsapp.sendDocument(po.supplier.phone, {
      buffer,
      filename: `${po.poNumber}.pdf`,
      mimetype: 'application/pdf',
      caption: `Purchase Order ${po.poNumber} - SSS Company`,
    });
  }
}
