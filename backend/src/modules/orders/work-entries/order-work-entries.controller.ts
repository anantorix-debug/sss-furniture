import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Controller, Get, UseGuards } from '@nestjs/common';
import { OrderWorkEntriesService } from './order-work-entries.service';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../../auth/guards/roles.guard';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Role } from '../../../common/enums/role.enum';

// Cross-order listing only - per-order add/remove stays on
// CustomerOrdersController/PartyOrdersController (':id/work-entries'),
// right next to the rest of that order's own routes. This route exists
// purely for the Production Control screen's "Work Entries" tab.
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.ADMIN)
@ApiTags('Order Work Entries')
@ApiBearerAuth()
@Controller('order-work-entries')
export class OrderWorkEntriesController {
  constructor(private service: OrderWorkEntriesService) {}

  @Get()
  findAll() {
    return this.service.listAll();
  }
}
