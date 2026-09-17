import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { PartyOrdersService } from './party-orders.service';
import { CreatePartyOrderDto } from './dto/create-party-order.dto';
import { UpdatePartyOrderDto } from './dto/update-party-order.dto';
import { CreatePaymentDto } from '../customer/dto/create-payment.dto';
import { AssignEmployeeDto } from '../customer/dto/assign-employee.dto';
import { AssignProductionDto } from '../customer/dto/assign-production.dto';
import { UpdateModelNoDto } from '../customer/dto/update-model-no.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('party-orders')
export class PartyOrdersController {
  constructor(private service: PartyOrdersService) {}

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('shopId') shopId?: string,
    @Query('paymentStatus') paymentStatus?: 'SETTLED' | 'DUE',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.service.findAll({
      status,
      search,
      dateFrom,
      dateTo,
      shopId,
      paymentStatus,
      viewerRole: user?.role as Role,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // Static route - must come before the dynamic :id route below.
  @Get('pdf')
  async listPdf(
    @Res() res: Response,
    @Query('status') status?: string,
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('shopId') shopId?: string,
    @Query('paymentStatus') paymentStatus?: 'SETTLED' | 'DUE',
  ) {
    const buffer = await this.service.generateListPdf({ status, search, dateFrom, dateTo, shopId, paymentStatus });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="party-orders-${new Date().toISOString().slice(0, 10)}.pdf"`);
    res.send(buffer);
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.service.findOne(id, user?.role as Role);
  }

  // Creating/editing an order (with its price) is not "work" CRUD -
  // Admin+ only. The one thing a Carpenter/Polisher can change on an order
  // is its Model No, via the dedicated endpoint below.
  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreatePartyOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.userId);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePartyOrderDto, @Query('force') force: string | undefined, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.userId, force === 'true', user.role as Role);
  }

  // force=true (SUPERADMIN only, re-checked in the service) bypasses the
  // "production already in progress/completed" block.
  @Roles(Role.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string, @Query('force') force: string | undefined, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.userId, force === 'true', user.role as Role);
  }

  @Roles(Role.ADMIN)
  @Post(':id/payments')
  addPayment(@Param('id') id: string, @Body() dto: CreatePaymentDto, @CurrentUser() user: AuthUser) {
    return this.service.addPayment(id, dto, user.userId);
  }

  @Roles(Role.ADMIN)
  @Delete(':id/payments/:paymentId')
  removePayment(@Param('id') id: string, @Param('paymentId') paymentId: string) {
    return this.service.removePayment(id, paymentId);
  }

  // Per-line Model No entry for the new multi-line flow (ADMIN - see the
  // note on PartyOrdersService.updateItemModelNo for why this differs from
  // the employee-self-service pattern below).
  @Roles(Role.ADMIN)
  @Post(':id/items/:itemId/model-no')
  updateItemModelNo(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: UpdateModelNoDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateItemModelNo(id, itemId, dto.modelNo, user.userId);
  }

  @Roles(Role.ADMIN, Role.SUPERADMIN)
  @Post(':id/items/:itemId/assign-production')
  assignItemProduction(
    @Param('id') id: string,
    @Param('itemId') itemId: string,
    @Body() dto: AssignProductionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.assignItemProduction(id, itemId, dto, user.userId, user.role as Role);
  }

  @Roles(Role.SUPERADMIN)
  @Post(':id/assign-employee')
  assignEmployee(@Param('id') id: string, @Body() dto: AssignEmployeeDto, @CurrentUser() user: AuthUser) {
    return this.service.assignEmployee(id, dto, user.userId);
  }

  @Roles(Role.CARPENTER, Role.CARVER, Role.POLISHER)
  @Post(':id/model-no')
  updateModelNo(@Param('id') id: string, @Body() dto: UpdateModelNoDto, @CurrentUser() user: AuthUser) {
    return this.service.updateModelNo(id, dto, user);
  }

  @Roles(Role.ADMIN)
  @Get(':id/pdf')
  async downloadPdf(@Param('id') id: string, @Res() res: Response, @Query('recipientType') recipientType?: string) {
    const buffer = await this.service.generatePdf(id, recipientType === 'employee' ? 'employee' : 'customer');
    const order = await this.service.findOne(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Order Confirmation - ${order.jobNumber ?? order.id}.pdf"`);
    res.send(buffer);
  }

  @Roles(Role.ADMIN)
  @Post(':id/send-whatsapp')
  sendWhatsapp(@Param('id') id: string) {
    return this.service.sendPdfToShop(id);
  }
}
