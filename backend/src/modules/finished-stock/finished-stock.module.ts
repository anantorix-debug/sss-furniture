import { Module } from '@nestjs/common';
import { FinishedStockController } from './finished-stock.controller';
import { FinishedStockService } from './finished-stock.service';

@Module({
  controllers: [FinishedStockController],
  providers: [FinishedStockService],
})
export class FinishedStockModule {}
