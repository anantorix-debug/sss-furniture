import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ExpensesService } from './expenses.service';
import { CreateExpenseDto } from './dto/create-expense.dto';
import { UpdateExpenseDto } from './dto/update-expense.dto';
import { AuditService } from '../audit/audit.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

// Entire module is Super Admin only - this is a private financial control
// center, not a shared operational screen. RolesGuard's SUPERADMIN bypass
// means this single class-level decorator is the complete access boundary;
// every route below inherits it. A non-Super-Admin token gets 403 on every
// endpoint here, including list/summary reads - there is no partial access.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
@Controller('expenses')
export class ExpensesController {
  constructor(private service: ExpensesService, private audit: AuditService) {}

  @Get()
  findAll(
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('categoryId') categoryId?: string,
    @Query('referenceTypeId') referenceTypeId?: string,
    @Query('paymentModeId') paymentModeId?: string,
    @Query('scope') scope?: 'COMPANY' | 'PERSONAL',
    @Query('paidBy') paidBy?: string,
    @Query('employeeId') employeeId?: string,
    @Query('status') status?: 'ACTIVE' | 'ARCHIVED',
    @Query('minAmount') minAmount?: string,
    @Query('maxAmount') maxAmount?: string,
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll({
      dateFrom,
      dateTo,
      categoryId,
      referenceTypeId,
      paymentModeId,
      scope,
      paidBy,
      employeeId,
      status,
      minAmount: minAmount ? parseFloat(minAmount) : undefined,
      maxAmount: maxAmount ? parseFloat(maxAmount) : undefined,
      search,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('summary')
  summary() {
    return this.service.summary();
  }

  @Get('monthly')
  monthly(@Query('year', ParseIntPipe) year: number, @Query('month', ParseIntPipe) month: number) {
    return this.service.monthly(year, month);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Get(':id/history')
  history(@Param('id') id: string) {
    return this.service.history(id);
  }

  @Post()
  create(@Body() dto: CreateExpenseDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.userId);
  }

  @Post(':id/duplicate')
  duplicate(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.duplicate(id, user.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateExpenseDto, @CurrentUser() user: AuthUser) {
    return this.service.update(id, dto, user.userId);
  }

  @Patch(':id/archive')
  archive(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.archive(id, user.userId);
  }

  @Patch(':id/restore')
  restore(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.restore(id, user.userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.userId, this.audit);
  }
}
