import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { PurchasesService } from './purchases.service';
import { CreatePurchaseDto } from './dto/create-purchase.dto';
import { UpdatePurchaseDto } from './dto/update-purchase.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';

// Route stays "purchase-orders" (not renamed to "purchases") so the
// Material detail page's ?materialId= deep-link, Sidebar's alsoActiveOn,
// and Topbar's route-title map all keep working unchanged - only the
// internal identifiers and user-visible copy changed to "Purchase".
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('purchase-orders')
export class PurchasesController {
  constructor(private service: PurchasesService) {}

  @Get()
  findAll(
    @Query('status') status?: string,
    @Query('supplierId') supplierId?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll({
      status,
      supplierId,
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // Static route - must come before the dynamic :id route below.
  @Get('pdf')
  async listPdf(@Res() res: Response, @Query('status') status?: string, @Query('supplierId') supplierId?: string, @Query('search') search?: string) {
    const buffer = await this.service.generateListPdf({ status, supplierId, search });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="purchases-${new Date().toISOString().slice(0, 10)}.pdf"`);
    res.send(buffer);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreatePurchaseDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdatePurchaseDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.userId);
  }

  @Post(':id/cancel')
  cancel(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.cancel(id, user.userId);
  }

  @Get(':id/pdf')
  async downloadPdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.service.generatePdf(id);
    const purchase = await this.service.findOne(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${purchase.purchaseNumber}.pdf"`);
    res.send(buffer);
  }

  @Post(':id/send-whatsapp')
  sendWhatsapp(@Param('id') id: string) {
    return this.service.sendPdfToSupplier(id);
  }
}
