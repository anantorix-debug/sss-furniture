import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { ExpenseConfigService } from './expense-config.service';
import { CreateExpenseCategoryDto } from './dto/create-expense-category.dto';
import { CreateReferenceTypeDto } from './dto/create-reference-type.dto';
import { CreatePaymentModeDto } from './dto/create-payment-mode.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';

// Same Super-Admin-only boundary as ExpensesController - category/reference/
// payment-mode management is explicitly called out in the spec as
// restricted configuration, not something any Admin can touch.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
@Controller('expense-config')
export class ExpenseConfigController {
  constructor(private service: ExpenseConfigService) {}

  // Categories

  @Get('categories')
  findAllCategories(@Query('includeInactive') includeInactive?: string) {
    return this.service.findAllCategories(includeInactive === 'true');
  }

  @Post('categories')
  createCategory(@Body() dto: CreateExpenseCategoryDto) {
    return this.service.createCategory(dto);
  }

  @Patch('categories/:id')
  updateCategory(@Param('id') id: string, @Body() dto: Partial<CreateExpenseCategoryDto>) {
    return this.service.updateCategory(id, dto);
  }

  @Delete('categories/:id')
  removeCategory(@Param('id') id: string) {
    return this.service.removeCategory(id);
  }

  // Reference types

  @Get('reference-types')
  findAllReferenceTypes(@Query('includeInactive') includeInactive?: string) {
    return this.service.findAllReferenceTypes(includeInactive === 'true');
  }

  @Post('reference-types')
  createReferenceType(@Body() dto: CreateReferenceTypeDto) {
    return this.service.createReferenceType(dto);
  }

  @Patch('reference-types/:id')
  updateReferenceType(@Param('id') id: string, @Body() dto: Partial<CreateReferenceTypeDto>) {
    return this.service.updateReferenceType(id, dto);
  }

  @Delete('reference-types/:id')
  removeReferenceType(@Param('id') id: string) {
    return this.service.removeReferenceType(id);
  }

  // Payment modes

  @Get('payment-modes')
  findAllPaymentModes(@Query('includeInactive') includeInactive?: string) {
    return this.service.findAllPaymentModes(includeInactive === 'true');
  }

  @Post('payment-modes')
  createPaymentMode(@Body() dto: CreatePaymentModeDto) {
    return this.service.createPaymentMode(dto);
  }

  @Patch('payment-modes/:id')
  updatePaymentMode(@Param('id') id: string, @Body() dto: Partial<CreatePaymentModeDto>) {
    return this.service.updatePaymentMode(id, dto);
  }

  @Delete('payment-modes/:id')
  removePaymentMode(@Param('id') id: string) {
    return this.service.removePaymentMode(id);
  }
}
