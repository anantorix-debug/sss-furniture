import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { SearchService } from './search.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { CurrentUser, AuthUser } from '../../common/decorators/current-user.decorator';
import { Role } from '../../common/enums/role.enum';

@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('search')
export class SearchController {
  constructor(private service: SearchService) {}

  @Get('track')
  track(@Query('q') q: string, @CurrentUser() user: AuthUser) {
    if (!q || !q.trim()) throw new BadRequestException('Provide a Job/Model Number, Order ID, or COT No to search');
    return this.service.track(q, user.role as Role);
  }
}
