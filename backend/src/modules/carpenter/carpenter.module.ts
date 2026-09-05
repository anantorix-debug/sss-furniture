import { Module } from '@nestjs/common';
import { CarpenterService } from './carpenter.service';
import { CarpenterController } from './carpenter.controller';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [CarpenterController],
  providers: [CarpenterService],
  exports: [CarpenterService],
})
export class CarpenterModule {}
