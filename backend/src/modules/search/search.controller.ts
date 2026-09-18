import { BadRequestException, Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
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

  // Static route - must come before any dynamic segment, though this
  // controller has none today.
  @Get('track/pdf')
  async trackPdf(@Query('q') q: string, @Res() res: Response, @CurrentUser() user: AuthUser) {
    if (!q || !q.trim()) throw new BadRequestException('Provide a Job/Model Number, Order ID, or COT No to search');
    const buffer = await this.service.generateTrackPdf(q, user.role as Role);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="Track - ${q.trim()}.pdf"`);
    res.send(buffer);
  }
}
