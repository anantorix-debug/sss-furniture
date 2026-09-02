import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { PurchaseOrdersService } from './purchase-orders.service';
import { CreatePurchaseOrderDto } from './dto/create-purchase-order.dto';
import { UpdatePurchaseOrderDto } from './dto/update-purchase-order.dto';
import { RejectPurchaseOrderDto } from './dto/reject-purchase-order.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('purchase-orders')
export class PurchaseOrdersController {
  constructor(private service: PurchaseOrdersService) {}

  @Get()
  findAll(@Query('status') status?: string, @Query('supplierId') supplierId?: string) {
    return this.service.findAll({ status, supplierId });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreatePurchaseOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePurchaseOrderDto) {
    return this.service.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  @Post(':id/submit')
  submit(@Param('id') id: string) {
    return this.service.submit(id);
  }

  @Roles(Role.SUPERADMIN)
  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user.userId);
  }

  @Roles(Role.SUPERADMIN)
  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectPurchaseOrderDto, @CurrentUser() user: AuthUser) {
    return this.service.reject(id, dto, user.userId);
  }

  @Post(':id/send-to-shop')
  sendToShop(@Param('id') id: string) {
    return this.service.sendToShop(id);
  }

  @Post(':id/receive')
  receive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.receive(id, user.userId);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string) {
    return this.service.cancel(id);
  }

  @Get(':id/pdf')
  async downloadPdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.service.generatePdf(id);
    const po = await this.service.findOne(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${po.poNumber}.pdf"`);
    res.send(buffer);
  }

  @Post(':id/send-whatsapp')
  sendWhatsapp(@Param('id') id: string) {
    return this.service.sendPdfToSupplier(id);
  }
}
