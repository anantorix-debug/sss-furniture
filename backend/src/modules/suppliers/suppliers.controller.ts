import { Body, Controller, Delete, Get, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

// Suppliers is purely purchase-pricing/payment data with no work-related
// use case for Carpenter/Polisher - Admin+ only, including the reads
// (previously ungated).
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('suppliers')
export class SuppliersController {
  constructor(private service: SuppliersService) {}

  @Get()
  findAll() {
    return this.service.findAll();
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateSupplierDto) {
    return this.service.create(dto);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateSupplierDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post(':id/purchases')
  addPurchase(@Param('id') id: string, @Body() dto: CreatePurchaseDto, @CurrentUser() user: AuthUser) {
    return this.service.addPurchase(id, dto, user.userId);
  }

  @Roles(Role.ADMIN)
  @Delete(':id/purchases/:purchaseId')
  removePurchase(@Param('id') id: string, @Param('purchaseId') purchaseId: string) {
    return this.service.removePurchase(id, purchaseId);
  }

  @Roles(Role.ADMIN)
  @Post(':id/payments')
  addPayment(@Param('id') id: string, @Body() dto: CreateSupplierPaymentDto, @CurrentUser() user: AuthUser) {
    return this.service.addPayment(id, dto, user.userId);
  }

  @Roles(Role.ADMIN)
  @Delete(':id/payments/:paymentId')
  removePayment(@Param('id') id: string, @Param('paymentId') paymentId: string) {
    return this.service.removePayment(id, paymentId);
  }
}
