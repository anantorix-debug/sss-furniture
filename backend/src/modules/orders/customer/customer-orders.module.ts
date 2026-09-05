import { Module } from '@nestjs/common';
import { CustomerOrdersService } from './customer-orders.service';
import { CustomerOrdersController } from './customer-orders.controller';
import { CarpenterModule } from '../../carpenter/carpenter.module';
import { ProductsModule } from '../../inventory/products/products.module';

@Module({
  imports: [CarpenterModule, ProductsModule],
  controllers: [CustomerOrdersController],
  providers: [CustomerOrdersService],
})
export class CustomerOrdersModule {}
