import { Body, Controller, Delete, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { QualityCheckService } from './quality-check.service';
import { CreateQualityCheckDto } from './dto/create-quality-check.dto';
import { UpdateQualityCheckDto } from './dto/update-quality-check.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../../common/decorators/roles.decorator';
import { Role } from '../../common/enums/role.enum';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';

// Inspection is an approval action distinct from production work, so
// recording/editing a check is Admin+; reads stay open to Carpenter/Polisher
// so a worker can see why their cot was sent back for rework.
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('quality-checks')
export class QualityCheckController {
  constructor(private service: QualityCheckService) {}

  @Get()
  findAll(@Query('jobNumber') jobNumber?: string) {
    return this.service.findAll(jobNumber);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.service.findOne(id);
  }

  @Roles(Role.ADMIN)
  @Post()
  create(@Body() dto: CreateQualityCheckDto, @CurrentUser() user: AuthUser) {
    return this.service.create(dto, user.userId);
  }

  @Roles(Role.ADMIN)
  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateQualityCheckDto) {
    return this.service.update(id, dto);
  }

  @Roles(Role.ADMIN)
  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.service.remove(id);
  }
}
