import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { CarpenterService } from './carpenter.service';
import { CreateCarpenterDto } from './dto/create-carpenter.dto';
import { UpdateCarpenterDto } from './dto/update-carpenter.dto';
import { CreateWorkItemDto } from './dto/create-work-item.dto';
import { UpdateWorkItemDto } from './dto/update-work-item.dto';
import { CreateHistoricalWorkItemDto } from './dto/create-historical-work-item.dto';
import { UpdateWorkStatusDto } from './dto/update-work-status.dto';
import { CreateCarpenterPaymentDto } from './dto/create-carpenter-payment.dto';
import { CreateProductionTeamDto } from './dto/create-production-team.dto';
import { UpdateProductionTeamDto } from './dto/update-production-team.dto';
import { UpdateModelNoDto } from '../orders/customer/dto/update-model-no.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller()
export class CarpenterController {
  constructor(private service: CarpenterService) {}

  // Carpenters

  @Get('carpenters')
  findAllCarpenters(
    @Query('workerType') workerType?: string,
    @Query('includeInactive') includeInactive?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.service.findAllCarpenters({
      workerType,
      includeInactive: includeInactive === 'true',
      viewerRole: user?.role as Role,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // Static route - must come before the dynamic :id route below.
  @Get('carpenters/me')
  findMyCarpenter(@CurrentUser() user: AuthUser) {
    return this.service.findMyCarpenter(user.userId);
  }

  @Get('carpenters/:id')
  findOneCarpenter(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.service.findOneCarpenter(id, user?.role as Role);
  }

  @Roles(Role.ADMIN)
  @Post('carpenters')
  createCarpenter(@Body() dto: CreateCarpenterDto) {
    return this.service.createCarpenter(dto);
  }

  @Roles(Role.ADMIN)
  @Patch('carpenters/:id')
  updateCarpenter(@Param('id') id: string, @Body() dto: UpdateCarpenterDto) {
    return this.service.updateCarpenter(id, dto);
  }

  // force=true (SUPERADMIN only, re-checked in the service) permanently
  // deletes this worker's payment history too - see removeCarpenter.
  @Roles(Role.ADMIN)
  @Delete('carpenters/:id')
  removeCarpenter(@Param('id') id: string, @Query('force') force: string | undefined, @CurrentUser() user: AuthUser) {
    return this.service.removeCarpenter(id, user.userId, force === 'true', user.role as Role);
  }

  @Roles(Role.ADMIN)
  @Post('carpenters/:id/payments')
  addPayment(@Param('id') id: string, @Body() dto: CreateCarpenterPaymentDto, @CurrentUser() user: AuthUser) {
    return this.service.addPayment(id, dto, user.userId);
  }

  @Roles(Role.ADMIN)
  @Delete('carpenters/:id/payments/:paymentId')
  removePayment(@Param('id') id: string, @Param('paymentId') paymentId: string) {
    return this.service.removePayment(id, paymentId);
  }

  // Production Teams

  @Get('production-teams')
  findAllTeams(@Query('workerType') workerType?: string) {
    return this.service.findAllTeams({ workerType });
  }

  @Get('production-teams/:id')
  findOneTeam(@Param('id') id: string) {
    return this.service.findOneTeam(id);
  }

  @Roles(Role.ADMIN)
  @Post('production-teams')
  createTeam(@Body() dto: CreateProductionTeamDto) {
    return this.service.createTeam(dto);
  }

  @Roles(Role.ADMIN)
  @Patch('production-teams/:id')
  updateTeam(@Param('id') id: string, @Body() dto: UpdateProductionTeamDto) {
    return this.service.updateTeam(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete('production-teams/:id')
  removeTeam(@Param('id') id: string) {
    return this.service.removeTeam(id);
  }

  // Work items (job list & assignment)

  @Get('carpenter-work-items')
  findAllWorkItems(
    @Query('carpenterId') carpenterId?: string,
    @Query('workerType') workerType?: string,
    @Query('status') status?: string,
    @Query('stage') stage?: string,
    @Query('source') source?: string,
    @Query('batchId') batchId?: string,
    @Query('sourceCustomerOrderId') sourceCustomerOrderId?: string,
    @Query('sourcePartyOrderItemId') sourcePartyOrderItemId?: string,
    @Query('entryType') entryType?: 'LIVE' | 'HISTORICAL',
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @CurrentUser() user?: AuthUser,
  ) {
    return this.service.findAllWorkItems({
      carpenterId,
      workerType,
      status,
      stage,
      source,
      batchId,
      sourceCustomerOrderId,
      sourcePartyOrderItemId,
      entryType,
      viewerRole: user?.role as Role,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  // Production Control Center - static route, must come before the
  // dynamic :id route below or NestJS would match "dashboard" as an id.
  @Roles(Role.SUPERADMIN, Role.ADMIN)
  @Get('carpenter-work-items/dashboard')
  getDashboard() {
    return this.service.getDashboard();
  }

  // Historical / Offline Entry - manually recording old paper production
  // records. Deliberately separate from the live create/assign/status
  // endpoints above (see CarpenterService's "Historical / Offline Entry"
  // section) - Admin-only data entry, not something a worker's login
  // creates or progresses through. Static routes, so they must come before
  // the dynamic :id routes below.
  @Roles(Role.ADMIN)
  @Get('carpenter-work-items/historical')
  findAllHistoricalBatches(
    @Query('search') search?: string,
    @Query('dateFrom') dateFrom?: string,
    @Query('dateTo') dateTo?: string,
    @Query('carpenterId') carpenterId?: string,
    @Query('source') source?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAllHistoricalBatches({
      search,
      dateFrom,
      dateTo,
      carpenterId,
      source,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Roles(Role.ADMIN)
  @Post('carpenter-work-items/historical')
  createHistoricalEntry(@Body() dto: CreateHistoricalWorkItemDto, @CurrentUser() user: AuthUser) {
    return this.service.createHistoricalEntry(dto, user.userId);
  }

  @Roles(Role.ADMIN)
  @Get('carpenter-work-items/historical/:batchId')
  findOneHistoricalBatch(@Param('batchId') batchId: string) {
    return this.service.findOneHistoricalBatch(batchId);
  }

  @Roles(Role.ADMIN)
  @Patch('carpenter-work-items/historical/:batchId')
  updateHistoricalBatch(@Param('batchId') batchId: string, @Body() dto: CreateHistoricalWorkItemDto, @CurrentUser() user: AuthUser) {
    return this.service.updateHistoricalBatch(batchId, dto, user.userId);
  }

  @Roles(Role.ADMIN)
  @Delete('carpenter-work-items/historical/:batchId')
  removeHistoricalBatch(@Param('batchId') batchId: string, @CurrentUser() user: AuthUser) {
    return this.service.removeHistoricalBatch(batchId, user.userId);
  }

  @Get('carpenter-work-items/:id')
  findOneWorkItem(@Param('id') id: string, @CurrentUser() user?: AuthUser) {
    return this.service.findOneWorkItem(id, user?.role as Role);
  }

  @Patch('carpenter-work-items/:id/status')
  updateWorkStatus(@Param('id') id: string, @Body() dto: UpdateWorkStatusDto, @CurrentUser() user: AuthUser) {
    return this.service.updateWorkStatus(id, dto, user.role as Role, user.userId);
  }

  // "Verify & Add to Stock" - the only action that creates real Product /
  // FinishedStockItem rows from a finished production run. Admin-only, and
  // idempotent (see CarpenterService.verifyAndAddToStock).
  @Roles(Role.SUPERADMIN, Role.ADMIN)
  @Post('carpenter-work-items/:id/verify')
  verifyAndAddToStock(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.verifyAndAddToStock(id, user.userId);
  }

  // Carpenter/Polisher may add their own cot entry ("Direct Cot Entry" in
  // the reference workflow); the service forces price/total to 0 for them
  // regardless of what's submitted - only Admin sets a price at creation,
  // and normally that happens later via Weekly Labour, not here.
  @Roles(Role.ADMIN, Role.SUPERADMIN, Role.CARPENTER, Role.CARVER, Role.POLISHER)
  @Post('carpenter-work-items')
  createWorkItem(@Body() dto: CreateWorkItemDto, @CurrentUser() user: AuthUser) {
    return this.service.createWorkItem(dto, user.userId, user.role as Role);
  }

  @Roles(Role.ADMIN)
  @Patch('carpenter-work-items/:id')
  updateWorkItem(@Param('id') id: string, @Body() dto: UpdateWorkItemDto) {
    return this.service.updateWorkItem(id, dto);
  }

  // force=true (SUPERADMIN only, re-checked in the service) - see
  // CarpenterService.removeWorkItem.
  @Roles(Role.ADMIN)
  @Delete('carpenter-work-items/:id')
  removeWorkItem(@Param('id') id: string, @Query('force') force: string | undefined, @CurrentUser() user: AuthUser) {
    return this.service.removeWorkItem(id, user.userId, force === 'true', user.role as Role);
  }

  @Post('carpenter-work-items/:id/notify')
  notifyWorkItem(@Param('id') id: string) {
    return this.service.notifyWorkItem(id);
  }

  // Model No is only ever known/entered while the piece is being made -
  // Carpenter or Carving stage - never Polish (see the service-level stage
  // guard too, which blocks it regardless of role once past Carving).
  @Roles(Role.SUPERADMIN, Role.ADMIN, Role.CARPENTER, Role.CARVER)
  @Patch('carpenter-work-items/:id/model-no')
  updateWorkItemModelNo(@Param('id') id: string, @Body() dto: UpdateModelNoDto, @CurrentUser() user: AuthUser) {
    return this.service.updateWorkItemModelNo(id, dto.modelNo, user.userId);
  }
}
