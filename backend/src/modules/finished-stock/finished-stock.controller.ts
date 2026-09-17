import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { FinishedStockService } from './finished-stock.service';
import { CreateFinishedStockDto } from './dto/create-finished-stock.dto';
import { UpdateFinishedStockDto } from './dto/update-finished-stock.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('finished-stock')
export class FinishedStockController {
  constructor(private service: FinishedStockService) {}

  @Get()
  findAll(@Query('status') status?: string, @Query('page') page?: string, @Query('limit') limit?: string) {
    return this.service.findAll({
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreateFinishedStockDto) {
    return this.service.create(dto);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateFinishedStockDto) {
    return this.service.update(id, dto);
  }

  // force=true (SUPERADMIN only, re-checked in the service) - see
  // FinishedStockService.remove.
  @Roles(Role.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string, @Query('force') force: string | undefined, @CurrentUser() user: AuthUser) {
    return this.service.remove(id, user.userId, force === 'true', user.role as Role);
  }
}
