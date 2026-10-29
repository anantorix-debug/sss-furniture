import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Query,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { AuthUser, CurrentUser } from '../../common/decorators/current-user.decorator';
import { InvestorsService } from './investors.service';
import { CreateInvestorDto } from './dto/create-investor.dto';
import { UpdateInvestorDto } from './dto/update-investor.dto';
import { CreateInvestorTransactionDto } from './dto/create-investor-transaction.dto';
import { UpdateInvestorTransactionDto } from './dto/update-investor-transaction.dto';
import { DistributeProfitDto } from './dto/distribute-profit.dto';

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
@ApiTags('Investors')
@ApiBearerAuth()
@Controller('investors')
export class InvestorsController {
  constructor(private readonly service: InvestorsService) {}

  @Post()
  create(@Body() dto: CreateInvestorDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.userId, user.email);
  }

  @Get()
  findAll(@Query('search') search?: string, @Query('status') status?: string) {
    return this.service.findAll({ search, status });
  }

  @Get('stats')
  getStats() {
    return this.service.getStats();
  }

  @Get('pnl-calculation')
  calculatePnl(@Query('from') from?: string, @Query('to') to?: string) {
    return this.service.calculatePnl({ from, to });
  }

  @Post('distribute-profit')
  distributeProfit(@Body() dto: DistributeProfitDto, @CurrentUser() user: AuthUser) {
    return this.service.distributeProfit(dto, user.userId, user.email);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateInvestorDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.userId, user.email);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.userId, user.email);
  }

  @Post(':id/transactions')
  createTransaction(
    @Param('id') id: string,
    @Body() dto: CreateInvestorTransactionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.createTransaction(id, dto, user.userId, user.email);
  }

  @Patch('transactions/:txId')
  updateTransaction(
    @Param('txId') txId: string,
    @Body() dto: UpdateInvestorTransactionDto,
    @CurrentUser() user: AuthUser,
  ) {
    return this.service.updateTransaction(txId, dto, user.userId, user.email);
  }

  @Delete('transactions/:txId')
  removeTransaction(@Param('txId') txId: string, @CurrentUser() user: AuthUser) {
    return this.service.removeTransaction(txId, user.userId, user.email);
  }

  @Get(':id/statement-pdf')
  @Header('Content-Type', 'application/pdf')
  async downloadStatementPdf(@Param('id') id: string, @Res() res: Response) {
    const pdf = await this.service.generateStatementPdf(id);
    res.setHeader('Content-Disposition', `attachment; filename="investor-statement-${id.slice(0, 8)}.pdf"`);
    res.end(pdf);
  }
}
