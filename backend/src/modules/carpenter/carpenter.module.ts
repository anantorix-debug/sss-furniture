import { Module } from '@nestjs/common';
import { CarpenterService } from './carpenter.service';
import { CarpenterController } from './carpenter.controller';

@Module({
  controllers: [CarpenterController],
  providers: [CarpenterService],
  exports: [CarpenterService],
})
export class CarpenterModule {}
