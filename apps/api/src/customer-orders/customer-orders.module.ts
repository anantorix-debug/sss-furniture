import { Module } from '@nestjs/common';
import { CustomerOrdersService } from './customer-orders.service';
import { CustomerOrdersController } from './customer-orders.controller';
import { CarpenterModule } from '../carpenter/carpenter.module';

@Module({
  imports: [CarpenterModule],
  controllers: [CustomerOrdersController],
  providers: [CustomerOrdersService],
})
export class CustomerOrdersModule {}
