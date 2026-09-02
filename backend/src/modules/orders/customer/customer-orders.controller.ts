import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { CustomerOrdersService } from './customer-orders.service';
import { CreateCustomerOrderDto } from './dto/create-customer-order.dto';
import { UpdateCustomerOrderDto } from './dto/update-customer-order.dto';
import { CreatePaymentDto } from './dto/create-payment.dto';
import { AssignProductionDto } from './dto/assign-production.dto';
import { AssignEmployeeDto } from './dto/assign-employee.dto';
import { UpdateModelNoDto } from './dto/update-model-no.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('customer-orders')
export class CustomerOrdersController {
  constructor(private service: CustomerOrdersService) {}

  @Get()
  findAll(@Query('status') status?: string, @Query('search') search?: string, @CurrentUser() user?: AuthUser) {
    return this.service.findAll({ status, search, viewerRole: user?.role as Role });
  }

  @Get(':id')
  findOne(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.service.findOne(id, user?.role as Role);
  }

  // Creating/editing a sales order (with its price) is not "work" CRUD -
  // Admin+ only. The one thing a Carpenter/Polisher can change on an order
  // is its Model No, via the dedicated endpoint below.
  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreateCustomerOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.userId);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateCustomerOrderDto) {
    return this.service.update(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
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

  @Roles(Role.ADMIN)
  @Post(':id/assign-production')
  assignProduction(@Param('id') id: string, @Body() dto: AssignProductionDto, @CurrentUser() user: AuthUser) {
    return this.service.assignProduction(id, dto, user.userId);
  }

  @Roles(Role.SUPERADMIN)
  @Post(':id/assign-employee')
  assignEmployee(@Param('id') id: string, @Body() dto: AssignEmployeeDto, @CurrentUser() user: AuthUser) {
    return this.service.assignEmployee(id, dto, user.userId);
  }

  @Roles(Role.CARPENTER, Role.POLISHER)
  @Post(':id/model-no')
  updateModelNo(@Param('id') id: string, @Body() dto: UpdateModelNoDto, @CurrentUser() user: AuthUser) {
    return this.service.updateModelNo(id, dto, user);
  }

  @Roles(Role.ADMIN)
  @Get(':id/pdf')
  async downloadPdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.service.generatePdf(id);
    const order = await this.service.findOne(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${order.orderId}.pdf"`);
    res.send(buffer);
  }

  @Roles(Role.ADMIN)
  @Post(':id/send-whatsapp')
  sendWhatsapp(@Param('id') id: string) {
    return this.service.sendPdfToCustomer(id);
  }
}
