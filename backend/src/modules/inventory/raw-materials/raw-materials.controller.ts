import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { RawMaterialsService } from './raw-materials.service';
import { CreateRawMaterialDto } from './dto/create-raw-material.dto';
import { UpdateRawMaterialDto } from './dto/update-raw-material.dto';
import { StockInDto } from './dto/stock-in.dto';
import { StockAdjustmentDto } from './dto/stock-adjustment.dto';
import { IssueMaterialDto } from './dto/issue-material.dto';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';
import { CurrentUser, AuthUser } from '../../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class RawMaterialsController {
  constructor(private service: RawMaterialsService) {}

  @Get('raw-materials')
  findAll(
    @Query('search') search?: string,
    @Query('lowStockOnly') lowStockOnly?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.service.findAll({
      search,
      lowStockOnly: lowStockOnly === 'true',
      viewerRole: user?.role as Role,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // Static route - must come before the dynamic :id route below, otherwise
  // Nest would try to treat "movements" as an :id.
  @Get('raw-materials/movements/pdf')
  async movementsPdf(
    @Res() res: Response,
    @Query('rawMaterialId') rawMaterialId?: string,
    @Query('type') type?: string,
    @Query('workerType') workerType?: string,
    @Query('carpenterId') carpenterId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('reference') reference?: 'PURCHASE' | 'PRODUCTION' | 'ADJUSTMENT',
    @CurrentUser() user?: AuthUser,
  ) {
    const buffer = await this.service.generateMovementsPdf({
      rawMaterialId,
      type,
      workerType,
      carpenterId,
      dateFrom,
      dateTo,
      reference,
      viewerRole: user?.role as Role,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="material-movement-history-${new Date().toISOString().slice(0, 10)}.pdf"`);
    res.send(buffer);
  }

  @Get('raw-materials/:id')
  findOne(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.findOne(id, user.role as Role);
  }

  @Get('raw-materials/:id/pdf')
  async materialDetailPdf(
    @Param('id') id: string,
    @Res() res: Response,
    @Query('type') type?: string,
    @Query('workerType') workerType?: string,
    @Query('carpenterId') carpenterId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('reference') reference?: 'PURCHASE' | 'PRODUCTION' | 'ADJUSTMENT',
    @CurrentUser() user?: AuthUser,
  ) {
    const material = await this.service.findOne(id, user?.role as Role);
    const buffer = await this.service.generateMaterialDetailPdf(id, {
      type,
      workerType,
      carpenterId,
      dateFrom,
      dateTo,
      reference,
      viewerRole: user?.role as Role,
    });
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${(material as any).name}.pdf"`);
    res.send(buffer);
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

  // Stock In (recording a new purchase/receipt) is Admin+ only - employee
  // logins record material usage via /raw-materials/issue instead (that's
  // the flow that attributes consumption to a specific work item/employee
  // for Super Admin to monitor).
  @Roles(Role.ADMIN)
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
    return this.service.issueToWorkItem(dto, user.userId, user.role as Role);
  }

  @Get('stock-movements')
  findAllMovements(
    @Query('rawMaterialId') rawMaterialId?: string,
    @Query('type') type?: string,
    @Query('workItemId') workItemId?: string,
    @Query('workerType') workerType?: string,
    @Query('carpenterId') carpenterId?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('reference') reference?: 'PURCHASE' | 'PRODUCTION' | 'ADJUSTMENT',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.service.findAllMovements({
      rawMaterialId,
      type,
      workItemId,
      workerType,
      carpenterId,
      dateFrom,
      dateTo,
      reference,
      viewerRole: user?.role as Role,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }
}
