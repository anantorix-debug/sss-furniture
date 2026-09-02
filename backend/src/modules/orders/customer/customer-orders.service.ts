import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { CarpenterService } from '../../carpenter/carpenter.service';
import { PdfService } from '../../pdf/pdf.service';
import { WhatsappService } from '../../whatsapp/whatsapp.service';
import { CreateCustomerOrderDto, CustomerOrderItemDto } from './dto/create-customer-order.dto';
import { UpdateCustomerOrderDto } from './dto/update-customer-order.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { AssignProductionDto } from './dto/assign-production.dto';
import { AssignEmployeeDto } from './dto/assign-employee.dto';
import { UpdateModelNoDto } from './dto/update-model-no.dto';
import { computeBalance } from '../../../common/utils/balance.util';
import { generateJobNumber } from '../../../common/utils/job-number.util';
import { Role } from '../../../common/enums/role.enum';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

const HIDE_FINANCIALS_FOR: Role[] = [Role.CARPENTER, Role.POLISHER];

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string);
}

function withBalance<T extends { orderValue: any; payments: { amount: any }[] }>(order: T) {
  const { totalReceived, balanceAmount } = computeBalance(order.orderValue, order.payments);
  return { ...order, totalReceived, balanceAmount };
}

// Carpenter/Polisher never see order financials - only a non-monetary
// SETTLED/DUE flag survives, matching the pattern already used by
// SearchService and RawMaterialsService for these two roles.
function stripOrderMoney<
  T extends { orderValue: any; payments: any; totalReceived: any; balanceAmount: any; items?: { unitPrice: any }[] },
>(order: T, hide: boolean) {
  if (!hide) return order;
  const { orderValue, payments, totalReceived, balanceAmount, items, ...rest } = order as any;
  return {
    ...rest,
    paymentStatus: balanceAmount <= 0 ? 'SETTLED' : 'DUE',
    items: items?.map(({ unitPrice, ...i }: any) => i),
  };
}

@Injectable()
export class CustomerOrdersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private carpenter: CarpenterService,
    private pdf: PdfService,
    private whatsapp: WhatsappService,
  ) {}

  // When line items are given, they're the source of truth for `product`
  // (a joined summary) and `orderValue` (their sum) - the plain fields stay
  // the single-product path for orders that don't need a line-item list.
  private deriveFromItems(dto: { product?: string; orderValue?: number; items?: CustomerOrderItemDto[] }) {
    if (dto.items && dto.items.length > 0) {
      const product = dto.items.map((i) => i.productName).join(', ');
      const orderValue = dto.items.reduce((sum, i) => sum + i.unitPrice * (i.quantity ?? 1), 0);
      return { product, orderValue };
    }
    if (dto.product === undefined || dto.orderValue === undefined) {
      throw new BadRequestException('Provide either line items or both product and orderValue');
    }
    return { product: dto.product, orderValue: dto.orderValue };
  }

  async findAll(params: { status?: string; search?: string; viewerRole?: Role }) {
    const hide = params.viewerRole ? HIDE_FINANCIALS_FOR.includes(params.viewerRole) : false;
    const orders = await this.prisma.customerOrder.findMany({
      where: {
        deliveryStatus: params.status ? (params.status as any) : undefined,
        OR: params.search
          ? [
              { orderId: { contains: params.search } },
              { customerName: { contains: params.search } },
              { phone: { contains: params.search } },
              { product: { contains: params.search } },
              { cotTrack: { contains: params.search } },
            ]
          : undefined,
      },
      include: {
        payments: true,
        items: true,
        createdBy: { select: { id: true, name: true } },
        assignedEmployee: { select: { id: true, name: true } },
        assignedBy: { select: { id: true, name: true } },
        modelNoUpdatedBy: { select: { id: true, name: true } },
      },
      orderBy: { orderDate: 'desc' },
    });
    return orders.map((o) => stripOrderMoney(withBalance(o), hide));
  }

  async findOne(id: string, viewerRole?: Role) {
    const hide = viewerRole ? HIDE_FINANCIALS_FOR.includes(viewerRole) : false;
    const order = await this.prisma.customerOrder.findUnique({
      where: { id },
      include: {
        payments: { orderBy: { date: 'asc' } },
        items: true,
        createdBy: { select: { id: true, name: true } },
        assignedEmployee: { select: { id: true, name: true } },
        assignedBy: { select: { id: true, name: true } },
        modelNoUpdatedBy: { select: { id: true, name: true } },
      },
    });
    if (!order) throw new NotFoundException('Customer order not found');
    return stripOrderMoney(withBalance(order), hide);
  }

  async create(dto: CreateCustomerOrderDto, userId: string) {
    const existing = await this.prisma.customerOrder.findUnique({ where: { orderId: dto.orderId } });
    if (existing) throw new ConflictException('An order with this Order ID already exists');

    const jobNumber = await generateJobNumber(this.prisma);
    const { product, orderValue } = this.deriveFromItems(dto);

    const order = await this.prisma.customerOrder.create({
      data: {
        orderId: dto.orderId,
        jobNumber,
        orderDate: new Date(dto.orderDate),
        customerName: dto.customerName,
        phone: dto.phone,
        address: dto.address,
        product,
        orderValue,
        actualDeliveryDate: dto.actualDeliveryDate ? new Date(dto.actualDeliveryDate) : undefined,
        deliveryStatus: dto.deliveryStatus,
        createdById: userId,
        items: dto.items?.length
          ? { create: dto.items.map((i) => ({ productName: i.productName, quantity: i.quantity ?? 1, unitPrice: i.unitPrice })) }
          : undefined,
      },
      include: { payments: true, items: true },
    });

    await this.audit.log({
      userId,
      action: 'CUSTOMER_ORDER_CREATED',
      targetType: 'CustomerOrder',
      targetId: order.id,
      metadata: { orderId: order.orderId, jobNumber: order.jobNumber, customerName: order.customerName },
    });

    return withBalance(order);
  }

  async update(id: string, dto: UpdateCustomerOrderDto) {
    await this.findOne(id);

    if (dto.orderId) {
      const existing = await this.prisma.customerOrder.findUnique({ where: { orderId: dto.orderId } });
      if (existing && existing.id !== id) throw new ConflictException('An order with this Order ID already exists');
    }

    const usingItems = Boolean(dto.items?.length);
    if (usingItems) {
      await this.prisma.customerOrderItem.deleteMany({ where: { orderId: id } });
    }
    const derived = this.deriveFromItemsOrPassthrough(dto);

    const order = await this.prisma.customerOrder.update({
      where: { id },
      data: {
        orderId: dto.orderId,
        orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined,
        customerName: dto.customerName,
        phone: dto.phone,
        address: dto.address,
        product: derived.product,
        orderValue: derived.orderValue,
        actualDeliveryDate: dto.actualDeliveryDate ? new Date(dto.actualDeliveryDate) : undefined,
        deliveryStatus: dto.deliveryStatus,
        items: usingItems
          ? { create: dto.items!.map((i) => ({ productName: i.productName, quantity: i.quantity ?? 1, unitPrice: i.unitPrice })) }
          : undefined,
      },
      include: { payments: true, items: true },
    });
    return withBalance(order);
  }

  // Same derivation as create(), but a plain-field edit (no items involved)
  // is allowed to touch just one of product/orderValue without requiring
  // both, unlike creation.
  private deriveFromItemsOrPassthrough(dto: { product?: string; orderValue?: number; items?: CustomerOrderItemDto[] }) {
    if (dto.items && dto.items.length > 0) {
      const product = dto.items.map((i) => i.productName).join(', ');
      const orderValue = dto.items.reduce((sum, i) => sum + i.unitPrice * (i.quantity ?? 1), 0);
      return { product, orderValue };
    }
    return { product: dto.product, orderValue: dto.orderValue };
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.customerOrder.delete({ where: { id } });
    return { success: true };
  }

  async addPayment(orderId: string, dto: CreatePaymentDto, userId: string) {
    await this.findOne(orderId);
    await this.prisma.customerOrderPayment.create({
      data: {
        orderId,
        date: new Date(dto.date),
        amount: dto.amount,
        mode: dto.mode,
        note: dto.note,
        createdById: userId,
      },
    });
    return this.findOne(orderId);
  }

  async removePayment(orderId: string, paymentId: string) {
    const payment = await this.prisma.customerOrderPayment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.orderId !== orderId) throw new NotFoundException('Payment not found');
    await this.prisma.customerOrderPayment.delete({ where: { id: paymentId } });
    return this.findOne(orderId);
  }

  // Puts this order into production in one step: creates the carpenter
  // work item tagged with the order's Job Number (so it's traceable via
  // /search/track) and fires the WhatsApp work-assignment notification.
  async assignProduction(orderId: string, dto: AssignProductionDto, userId: string) {
    const order = await this.findOne(orderId);
    const quantity = dto.quantity ?? 1;
    const extra = dto.extra ?? 0;
    const total = dto.price * quantity + extra;

    return this.carpenter.createWorkItem(
      {
        carpenterId: dto.carpenterId,
        workDate: dto.workDate,
        modelNo: order.jobNumber ?? order.orderId,
        productName: order.product,
        category: dto.category,
        size: dto.size,
        price: dto.price,
        extra,
        quantity,
        total,
        notifyWhatsapp: dto.notifyWhatsapp,
      },
      userId,
    );
  }

  // Super Admin assigns the order to a production employee (Carpenter or
  // Polisher role user), who is then solely responsible for entering the
  // Model No. This is deliberately a User assignment (Users & Roles), not
  // the separate Carpenter-payee work-item assignment used by
  // assignProduction() above.
  async assignEmployee(id: string, dto: AssignEmployeeDto, assignedById: string) {
    await this.findOne(id);
    const employee = await this.prisma.user.findUnique({ where: { id: dto.employeeId } });
    if (!employee || (employee.role !== Role.CARPENTER && employee.role !== Role.POLISHER)) {
      throw new BadRequestException('Employee must be an active Carpenter or Polisher team user');
    }

    await this.prisma.customerOrder.update({
      where: { id },
      data: { assignedEmployeeId: employee.id, assignedAt: new Date(), assignedById },
    });
    return this.findOne(id);
  }

  // Only the assigned production employee (or Superadmin) may set the
  // Model No - Super Admin never enters it directly on order create/edit.
  async updateModelNo(id: string, dto: UpdateModelNoDto, user: AuthUser) {
    const order = await this.findOne(id);
    if (user.role !== Role.SUPERADMIN && order.assignedEmployeeId !== user.userId) {
      throw new ForbiddenException('This order is not assigned to you');
    }

    const modelNo = dto.modelNo.trim();
    if (!modelNo) throw new BadRequestException('Model No cannot be empty');

    const previousModelNo = order.cotTrack;
    const updated = await this.prisma.customerOrder.update({
      where: { id },
      data: { cotTrack: modelNo, modelNoUpdatedById: user.userId, modelNoUpdatedAt: new Date() },
    });

    const employee = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { name: true } });
    await this.audit.log({
      userId: user.userId,
      action: 'MODEL_NO_UPDATED',
      targetType: 'CustomerOrder',
      targetId: id,
      metadata: {
        orderType: 'CUSTOMER_ORDER',
        orderId: order.orderId,
        customerName: order.customerName,
        previousModelNo,
        modelNo,
        employeeName: employee?.name,
      },
    });

    return this.findOne(updated.id, user.role as Role);
  }

  private buildPdfHtml(order: Awaited<ReturnType<CustomerOrdersService['findOne']>>): string {
    const rows = order.items.length
      ? order.items
          .map(
            (i) => `<tr>
              <td>${escapeHtml(i.productName)}</td>
              <td style="text-align:right">${i.quantity}</td>
              <td style="text-align:right">₹${Number(i.unitPrice).toLocaleString('en-IN')}</td>
              <td style="text-align:right">₹${(i.quantity * Number(i.unitPrice)).toLocaleString('en-IN')}</td>
            </tr>`,
          )
          .join('')
      : `<tr><td>${escapeHtml(order.product)}</td><td style="text-align:right">1</td><td style="text-align:right">₹${Number(order.orderValue).toLocaleString('en-IN')}</td><td style="text-align:right">₹${Number(order.orderValue).toLocaleString('en-IN')}</td></tr>`;

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
</style></head>
<body>
  <div class="header">
    <h1>Order Confirmation - ${escapeHtml(order.orderId)}</h1>
    <p>SSS Company</p>
  </div>
  <div class="body">
    <div class="meta">
      <div>
        <strong>Customer</strong><br/>
        ${escapeHtml(order.customerName)}<br/>
        ${order.phone ? escapeHtml(order.phone) : ''}<br/>
        ${order.address ? escapeHtml(order.address) : ''}
      </div>
      <div style="text-align:right">
        <strong>Order Date</strong>: ${order.orderDate.toLocaleDateString('en-IN')}<br/>
        ${order.jobNumber ? `<strong>Job No</strong>: ${escapeHtml(order.jobNumber)}<br/>` : ''}
        ${order.cotTrack ? `<strong>Model No</strong>: ${escapeHtml(order.cotTrack)}<br/>` : ''}
        <strong>Status</strong>: ${order.deliveryStatus.replace('_', ' ')}
      </div>
    </div>
    <table>
      <thead><tr><th>Product</th><th style="text-align:right">Qty</th><th style="text-align:right">Price</th><th style="text-align:right">Line Total</th></tr></thead>
      <tbody>
        ${rows}
        <tr class="total-row"><td colspan="3" style="text-align:right">Total</td><td style="text-align:right">₹${Number(order.orderValue).toLocaleString('en-IN')}</td></tr>
      </tbody>
    </table>
  </div>
</body></html>`;
  }

  async generatePdf(id: string): Promise<Buffer> {
    const order = await this.findOne(id);
    return this.pdf.renderHtmlToPdf(this.buildPdfHtml(order));
  }

  async sendPdfToCustomer(id: string) {
    const order = await this.findOne(id);
    if (!order.phone) {
      return { sent: false, reason: 'no_customer_phone' as const };
    }
    const buffer = await this.generatePdf(id);
    return this.whatsapp.sendDocument(order.phone, {
      buffer,
      filename: `${order.orderId}.pdf`,
      mimetype: 'application/pdf',
      caption: `Order confirmation ${order.orderId} - ${order.product} - SSS Company`,
    });
  }
}
