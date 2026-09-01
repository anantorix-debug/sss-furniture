import { Body, Controller, Delete, Get, Param, Post, Put, UseGuards, BadRequestException, Logger } from '@nestjs/common';
import { WorkerType } from '@prisma/client';
import { WhatsappService } from './whatsapp.service';
import { SetGroupSettingDto } from './dto/set-group-setting.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../common/decorators/roles.decorator';
import { Role } from '../common/enums/role.enum';
import { CurrentUser, AuthUser } from '../common/decorators/current-user.decorator';

function parseWorkerType(value: string): WorkerType {
  if (!(value in WorkerType)) throw new BadRequestException(`Invalid worker type "${value}"`);
  return value as WorkerType;
}

@UseGuards(JwtAuthGuard, RolesGuard)
@Roles(Role.SUPERADMIN)
@Controller('whatsapp')
export class WhatsappController {
  private readonly logger = new Logger(WhatsappController.name);

  constructor(private service: WhatsappService) {}

  @Get('status')
  getStatus() {
    this.logger.log('[ENDPOINT] GET /whatsapp/status called');
    const result = this.service.getStatus();
    this.logger.log(`[ENDPOINT] Returning status: ${JSON.stringify(result)}`);
    return result;
  }

  @Get('qr')
  getQr() {
    return this.service.getStatus();
  }

  // All WhatsApp chats (individuals, groups, business contacts)
  @Get('chats')
  listChats() {
    return this.service.listChats();
  }

  // Live group chats visible to the connected business number - lets the
  // Admin pick a group from a dropdown instead of hunting for its raw ID.
  @Get('groups')
  listLiveGroups() {
    return this.service.listLiveGroups();
  }

  @Get('group-settings')
  getGroupSettings() {
    return this.service.getGroupSettings();
  }

  @Put('group-settings/:workerType')
  setGroupSetting(@Param('workerType') workerType: string, @Body() dto: SetGroupSettingDto, @CurrentUser() user: AuthUser) {
    return this.service.setGroupSetting(parseWorkerType(workerType), dto.groupId, dto.groupName, user.userId);
  }

  @Delete('group-settings/:workerType')
  removeGroupSetting(@Param('workerType') workerType: string) {
    return this.service.removeGroupSetting(parseWorkerType(workerType));
  }

  @Post('logout')
  logout() {
    return this.service.logout();
  }

  @Post('send/:chatId')
  sendMessage(@Param('chatId') chatId: string, @Body() dto: { message: string }) {
    return this.service.sendMessage(chatId, dto.message);
  }
}
