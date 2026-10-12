import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { ReportsService } from './reports.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
@ApiTags('Reports')
@ApiBearerAuth()
@Controller('reports')
export class ReportsController {
  constructor(private service: ReportsService) {}

  // The Reports dashboard (plain-language KPIs, trend, who owes / who we
  // owe, best sellers, production) - see reports-overview.ts.
  @Get('overview')
  overview(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.overview({ from, to });
  }

  @Get('sales')
  sales(@Query('from') from?: string, @Query('to') to?: string, @Query('channel') channel?: 'CUSTOMER' | 'PARTY' | 'ALL') {
    return this.service.salesReport({ from, to, channel });
  }

  @Get('sales/export')
  async salesExport(
    @Res() res: Response,
    @Query('from') from?: string,
    @Query('to') to?: string,
    @Query('channel') channel?: 'CUSTOMER' | 'PARTY' | 'ALL',
  ) {
    const { rows } = await this.service.salesReport({ from, to, channel });
    const csv = this.service.toCsv(rows);
    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="sales-report.csv"`);
    res.send(csv);
  }

  @Get('profit-loss')
  profitAndLoss(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.profitAndLoss({ from, to });
  }
}
