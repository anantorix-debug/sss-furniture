import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { SuppliersService } from './suppliers.service';
import { CreateSupplierDto } from './dto/create-supplier.dto';
import { UpdateSupplierDto } from './dto/update-supplier.dto';
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
  findAll(
    @Query('search') search?: string,
    @Query('status') status?: 'DUE' | 'SETTLED',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll({
      search,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // Static route - must come before the dynamic :id route below.
  @Get('pdf')
  async listPdf(@Res() res: Response, @Query('search') search?: string, @Query('status') status?: 'DUE' | 'SETTLED') {
    const buffer = await this.service.generateListPdf({ search, status });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="suppliers-${new Date().toISOString().slice(0, 10)}.pdf"`);
    res.send(buffer);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/pdf')
  async detailPdf(@Param('id') id: string, @Res() res: Response) {
    const supplier = await this.service.findOne(id);
    const buffer = await this.service.generateDetailPdf(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${(supplier as any).name}.pdf"`);
    res.send(buffer);
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

  // No purchase-mutation routes here by design - every supplier purchase
  // must go through Purchasing (recording one immediately books stock +
  // the ledger), which is what creates SupplierPurchase rows now. See
  // PurchasesController for the actual purchasing flow.

  @Roles(Role.ADMIN)
  @Post(':id/payments')
  addPayment(@Param('id') id: string, @Body() dto: CreateSupplierPaymentDto, @CurrentUser() user: AuthUser) {
    return this.service.addPayment(id, dto, user.userId);
  }

  @Roles(Role.ADMIN)
  @Patch(':id/payments/:paymentId')
  updatePayment(@Param('id') id: string, @Param('paymentId') paymentId: string, @Body() dto: CreateSupplierPaymentDto) {
    return this.service.updatePayment(id, paymentId, dto);
  }

  @Roles(Role.ADMIN)
  @Delete(':id/payments/:paymentId')
  removePayment(@Param('id') id: string, @Param('paymentId') paymentId: string) {
    return this.service.removePayment(id, paymentId);
  }
}
