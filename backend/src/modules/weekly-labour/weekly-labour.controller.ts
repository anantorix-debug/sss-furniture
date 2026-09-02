import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { WeeklyLabourService } from './weekly-labour.service';
import { CreateWeeklyLabourDto } from './dto/create-weekly-labour.dto';
import { UpdateWeeklyLabourDto } from './dto/update-weekly-labour.dto';
import { RejectWeeklyLabourDto } from './dto/reject-weekly-labour.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

// Co-Admin (ADMIN) builds and submits weekly batches; only Admin
// (SUPERADMIN) approves/rejects them, matching the reference workflow's
// "Admin Can Review Full History" + approval-gated payment record.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@Controller('weekly-labours')
export class WeeklyLabourController {
  constructor(private service: WeeklyLabourService) {}

  @Get()
  findAll(
    @Query('carpenterId') carpenterId?: string,
    @Query('status') status?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.service.findAll({
      carpenterId,
      status,
      page: page ? parseInt(page, 10) : undefined,
      limit: limit ? parseInt(limit, 10) : undefined,
    });
  }

  @Get('eligible-work-items')
  findEligibleWorkItems(@Query('carpenterId') carpenterId: string) {
    return this.service.findEligibleWorkItems(carpenterId);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Post()
  create(@Body() dto: CreateWeeklyLabourDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.userId);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateWeeklyLabourDto) {
    return this.service.update(id, dto);
  }

  @Post(':id/submit')
  submit(@Param('id') id: string) {
    return this.service.submit(id);
  }

  @Roles(Role.SUPERADMIN)
  @Post(':id/approve')
  approve(@Param('id') id: string, @CurrentUser() user: AuthUser) {
    return this.service.approve(id, user.userId);
  }

  @Roles(Role.SUPERADMIN)
  @Post(':id/reject')
  reject(@Param('id') id: string, @Body() dto: RejectWeeklyLabourDto, @CurrentUser() user: AuthUser) {
    return this.service.reject(id, dto, user.userId);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
