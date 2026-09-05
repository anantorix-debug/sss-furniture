import { Module } from '@nestjs/common';
import { ProductsService } from './products.service';
import { ProductsController } from './products.controller';
import { StockAllocationService } from './stock-allocation.service';

@Module({
  controllers: [ProductsController],
  providers: [ProductsService, StockAllocationService],
  exports: [StockAllocationService],
})
export class ProductsModule {}
