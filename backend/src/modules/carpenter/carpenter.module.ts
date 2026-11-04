import { Module } from '@nestjs/common';
import { CarpenterService } from './carpenter.service';
import { CarpenterController } from './carpenter.controller';
import { WorkerKycService } from './worker-kyc.service';
import { PipelineBulkService } from './pipeline-bulk.service';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [NotificationsModule],
  controllers: [CarpenterController],
  providers: [CarpenterService, WorkerKycService, PipelineBulkService],
  exports: [CarpenterService],
})
export class CarpenterModule {}
