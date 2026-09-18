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

  // Super Admin only - overrides the class-level @Roles(ADMIN) above (an
  // ADMIN gets ForbiddenException here, SUPERADMIN always passes any
  // @Roles() check per RolesGuard). Approval is the one action that must
  // never be reachable by a plain Admin, since it's what actually commits
  // the supplier-payable change.
  @Roles(Role.SUPERADMIN)
  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user.userId);
  }

  // Goods receipt - ADMIN+ (inherits the class-level role, no override
  // needed), since confirming physical delivery is an operational action,
  // not a financial-approval one. This is the one place stock actually
  // updates.
  @Post(':id/receive')
  receive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.receive(id, user.userId);
  }

  @Get(':id/pdf')
  async downloadPdf(@Param('id') id: string, @Res() res: Response) {
    const buffer = await this.service.generatePdf(id);
    const purchase = await this.service.findOne(id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${purchase.purchaseNumber}.pdf"`);
    res.send(buffer);
  }

  // Manual "Send PO PDF via WhatsApp" / "Retry WhatsApp" - same underlying
  // method the automatic post-approval send uses, so whatsappStatus tracks
  // consistently either way. Safe to call repeatedly: it only (re)generates
  // the latest PDF and sends it - never creates a purchase, touches stock,
  // or touches the supplier ledger.
  @Post(':id/send-whatsapp')
  sendWhatsapp(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.sendPurchaseWhatsapp(id, user.userId);
  }
}
