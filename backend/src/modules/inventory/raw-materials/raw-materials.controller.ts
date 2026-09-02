import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { RawMaterialsService } from './raw-materials.service';
import { CreateRawMaterialDto } from './dto/create-raw-material.dto';
import { UpdateRawMaterialDto } from './dto/update-raw-material.dto';
import { StockInDto } from './dto/stock-in.dto';
import { StockAdjustmentDto } from './dto/stock-adjustment.dto';
import { IssueMaterialDto } from './dto/issue-material.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class RawMaterialsController {
  constructor(private service: RawMaterialsService) {}

  @Get('raw-materials')
  findAll(@Query('search') search?: string, @Query('lowStockOnly') lowStockOnly?: string, @CurrentUser() user?: AuthUser) {
    return this.service.findAll({ search, lowStockOnly: lowStockOnly === 'true', viewerRole: user?.role as Role });
  }

  @Get('raw-materials/:id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user.role as Role);
  }

  @Roles(Role.ADMIN)
  @Post('raw-materials')
  create(@Body() dto: CreateRawMaterialDto) {
    return this.service.create(dto);
  }

  @Roles(Role.ADMIN)
  @Patch('raw-materials/:id')
  update(@Param('id') id: string, @Body() dto: UpdateRawMaterialDto) {
    return this.service.update(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete('raw-materials/:id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }

  // Physical stock receipt is recorded by the team that handles that
  // material group (Carpenter -> wood, Polisher -> polish supplies) per the
  // "Carpenter verifies quantity, stock entry saved" workflow - not just
  // Admin+. Financial fields (unit cost) are stripped from what they see,
  // and any cost they submit is ignored server-side.
  @Roles(Role.ADMIN, Role.CARPENTER, Role.POLISHER)
  @Post('raw-materials/stock-in')
  stockIn(@Body() dto: StockInDto, @CurrentUser() user: AuthUser) {
    return this.service.stockIn(dto, user.userId, user.role as Role);
  }

  @Roles(Role.ADMIN)
  @Post('raw-materials/stock-adjustment')
  adjust(@Body() dto: StockAdjustmentDto, @CurrentUser() user: AuthUser) {
    return this.service.adjust(dto, user.userId);
  }

  // Issuing material against a work item is an operational action tied to
  // doing the job, so any authenticated role can record it (like creating
  // the work item itself) - not just Admin+.
  @Post('raw-materials/issue')
  issue(@Body() dto: IssueMaterialDto, @CurrentUser() user: AuthUser) {
    return this.service.issueToWorkItem(dto, user.userId);
  }

  @Get('stock-movements')
  findAllMovements(
    @Query('rawMaterialId') rawMaterialId?: string,
    @Query('type') type?: string,
    @Query('workItemId') workItemId?: string,
    @Query('workerType') workerType?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.service.findAllMovements({ rawMaterialId, type, workItemId, workerType, viewerRole: user?.role as Role });
  }
}
