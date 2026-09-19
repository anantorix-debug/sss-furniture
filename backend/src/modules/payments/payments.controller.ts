import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { PaymentsService, PaymentSource } from './payments.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

// Unified ledger across customer/party/supplier/carpenter payments -
// Admin+ only. Previously missing RolesGuard entirely (open to any
// authenticated role, including every carpenter's own wage payments).
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
@Controller('payments')
export class PaymentsController {
  constructor(private service: PaymentsService) {}

  @Get()
  findAll(
    @Query('source') source?: PaymentSource,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
  ) {
    return this.service.findAll({ source, from, to, search });
  }

  @Get('pdf')
  async downloadPdf(
    @Res() res: Response,
    @Query('source') source?: PaymentSource,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('search') search?: string,
  ) {
    const buffer = await this.service.generatePdf({ source, from, to, search });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="payments-statement-${new Date().toISOString().slice(0, 10)}.pdf"`);
    res.send(buffer);
  }
}
