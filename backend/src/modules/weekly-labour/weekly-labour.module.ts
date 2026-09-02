import { Module } from '@nestjs/common';
import { WeeklyLabourController } from './weekly-labour.controller';
import { WeeklyLabourService } from './weekly-labour.service';

@Module({
  controllers: [WeeklyLabourController],
  providers: [WeeklyLabourService],
})
export class WeeklyLabourModule {}
