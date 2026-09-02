import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { CarpenterService } from '../../carpenter/carpenter.service';
import { CreatePartyOrderDto } from './dto/create-party-order.dto';
import { UpdatePartyOrderDto } from './dto/update-party-order.dto';
import { CreatePaymentDto } from '../customer/dto/create-payment.dto';
import { AssignProductionDto } from '../customer/dto/assign-production.dto';
import { AssignEmployeeDto } from '../customer/dto/assign-employee.dto';
import { UpdateModelNoDto } from '../customer/dto/update-model-no.dto';
import { computeBalance, suggestPaymentType } from '../../../common/utils/balance.util';
import { generateJobNumber } from '../../../common/utils/job-number.util';
import { Role } from '../../../common/enums/role.enum';
import { AuthUser } from '../../../common/decorators/current-user.decorator';

function withBalance<T extends { totalAmount: any; payments: { amount: any }[] }>(order: T) {
  const { totalReceived: receivedAmount, balanceAmount } = computeBalance(order.totalAmount, order.payments);
  return { ...order, receivedAmount, balanceAmount };
}

const HIDE_FINANCIALS_FOR: Role[] = [Role.CARPENTER, Role.POLISHER];

// Same rule as CustomerOrdersService: Carpenter/Polisher never see order
// financials, only a non-monetary SETTLED/DUE flag.
function stripOrderMoney<T extends { price: any; totalAmount: any; payments: any; receivedAmount: any; balanceAmount: any }>(
  order: T,
  hide: boolean,
) {
  if (!hide) return order;
  const { price, totalAmount, payments, receivedAmount, balanceAmount, ...rest } = order as any;
  return { ...rest, paymentStatus: balanceAmount <= 0 ? 'SETTLED' : 'DUE' };
}

@Injectable()
export class PartyOrdersService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
    private carpenter: CarpenterService,
  ) {}

  async findAll(params: { status?: string; search?: string; viewerRole?: Role }) {
    const hide = params.viewerRole ? HIDE_FINANCIALS_FOR.includes(params.viewerRole) : false;
    const orders = await this.prisma.partyOrder.findMany({
      where: {
        deliveryStatus: params.status ? (params.status as any) : undefined,
        OR: params.search
          ? [
              { shopName: { contains: params.search } },
              { model: { contains: params.search } },
              { phone: { contains: params.search } },
              { cotNo: { contains: params.search } },
            ]
          : undefined,
      },
      include: {
        payments: true,
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
    const order = await this.prisma.partyOrder.findUnique({
      where: { id },
      include: {
        payments: { orderBy: { date: 'asc' } },
        createdBy: { select: { id: true, name: true } },
        assignedEmployee: { select: { id: true, name: true } },
        assignedBy: { select: { id: true, name: true } },
        modelNoUpdatedBy: { select: { id: true, name: true } },
      },
    });
    if (!order) throw new NotFoundException('Party order not found');
    return stripOrderMoney(withBalance(order), hide);
  }

  async create(dto: CreatePartyOrderDto, userId: string) {
    const jobNumber = await generateJobNumber(this.prisma);
    const order = await this.prisma.partyOrder.create({
      data: {
        jobNumber,
        orderDate: new Date(dto.orderDate),
        shopName: dto.shopName,
        phone: dto.phone,
        model: dto.model,
        finish: dto.finish,
        details: dto.details,
        qty: dto.qty ?? 1,
        price: dto.price,
        totalAmount: (dto.qty ?? 1) * dto.price,
        cashTrack: dto.cashTrack,
        courierTrack: dto.courierTrack,
        actualDeliveryDate: dto.actualDeliveryDate ? new Date(dto.actualDeliveryDate) : undefined,
        deliveryStatus: dto.deliveryStatus,
        createdById: userId,
      },
      include: { payments: true },
    });

    await this.audit.log({
      userId,
      action: 'PARTY_ORDER_CREATED',
      targetType: 'PartyOrder',
      targetId: order.id,
      metadata: { shopName: order.shopName, model: order.model },
    });

    return withBalance(order);
  }

  async update(id: string, dto: UpdatePartyOrderDto) {
    const existing = await this.findOne(id);
    const qty = dto.qty ?? existing.qty;
    const price = dto.price ?? Number(existing.price);
    const order = await this.prisma.partyOrder.update({
      where: { id },
      data: {
        orderDate: dto.orderDate ? new Date(dto.orderDate) : undefined,
        shopName: dto.shopName,
        phone: dto.phone,
        model: dto.model,
        finish: dto.finish,
        details: dto.details,
        qty: dto.qty,
        price: dto.price,
        // Always recomputed from the effective qty/price, whichever
        // changed - see the note on CreatePartyOrderDto.totalAmount.
        totalAmount: dto.qty !== undefined || dto.price !== undefined ? qty * price : undefined,
        cashTrack: dto.cashTrack,
        courierTrack: dto.courierTrack,
        actualDeliveryDate: dto.actualDeliveryDate ? new Date(dto.actualDeliveryDate) : undefined,
        deliveryStatus: dto.deliveryStatus,
      },
      include: { payments: true },
    });
    return withBalance(order);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.prisma.partyOrder.delete({ where: { id } });
    return { success: true };
  }

  async addPayment(orderId: string, dto: CreatePaymentDto, userId: string) {
    const existing = await this.findOne(orderId);
    const type = dto.type ?? suggestPaymentType(Number(existing.totalAmount), existing.payments, dto.amount);
    await this.prisma.partyOrderPayment.create({
      data: {
        orderId,
        date: new Date(dto.date),
        amount: dto.amount,
        type,
        mode: dto.mode,
        note: dto.note,
        createdById: userId,
      },
    });
    return this.findOne(orderId);
  }

  async removePayment(orderId: string, paymentId: string) {
    const payment = await this.prisma.partyOrderPayment.findUnique({ where: { id: paymentId } });
    if (!payment || payment.orderId !== orderId) throw new NotFoundException('Payment not found');
    await this.prisma.partyOrderPayment.delete({ where: { id: paymentId } });
    return this.findOne(orderId);
  }

  // Same as CustomerOrdersService.assignProduction, but keyed off this
  // order's COT No (party/retailer orders don't carry a Job Number) so it's
  // still traceable via /search/track.
  async assignProduction(orderId: string, dto: AssignProductionDto, userId: string) {
    const order = await this.findOne(orderId);
    const quantity = dto.quantity ?? 1;
    const extra = dto.extra ?? 0;
    const total = dto.price * quantity + extra;

    return this.carpenter.createWorkItem(
      {
        carpenterId: dto.carpenterId,
        workDate: dto.workDate,
        modelNo: order.cotNo ?? order.model,
        productName: order.model,
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

  // Same Model No workflow as CustomerOrdersService: Super Admin assigns a
  // production employee (Carpenter/Polisher role user); only that employee
  // (or Superadmin) may later enter the Model No via updateModelNo().
  async assignEmployee(id: string, dto: AssignEmployeeDto, assignedById: string) {
    await this.findOne(id);
    const employee = await this.prisma.user.findUnique({ where: { id: dto.employeeId } });
    if (!employee || (employee.role !== Role.CARPENTER && employee.role !== Role.POLISHER)) {
      throw new BadRequestException('Employee must be an active Carpenter or Polisher team user');
    }

    await this.prisma.partyOrder.update({
      where: { id },
      data: { assignedEmployeeId: employee.id, assignedAt: new Date(), assignedById },
    });
    return this.findOne(id);
  }

  async updateModelNo(id: string, dto: UpdateModelNoDto, user: AuthUser) {
    const order = await this.findOne(id);
    if (user.role !== Role.SUPERADMIN && order.assignedEmployeeId !== user.userId) {
      throw new ForbiddenException('This order is not assigned to you');
    }

    const modelNo = dto.modelNo.trim();
    if (!modelNo) throw new BadRequestException('Model No cannot be empty');

    const previousModelNo = order.cotNo;
    const updated = await this.prisma.partyOrder.update({
      where: { id },
      data: { cotNo: modelNo, modelNoUpdatedById: user.userId, modelNoUpdatedAt: new Date() },
    });

    const employee = await this.prisma.user.findUnique({ where: { id: user.userId }, select: { name: true } });
    await this.audit.log({
      userId: user.userId,
      action: 'MODEL_NO_UPDATED',
      targetType: 'PartyOrder',
      targetId: id,
      metadata: {
        orderType: 'PARTY_ORDER',
        orderId: order.id,
        shopName: order.shopName,
        previousModelNo,
        modelNo,
        employeeName: employee?.name,
      },
    });

    return this.findOne(updated.id, user.role as Role);
  }
}
