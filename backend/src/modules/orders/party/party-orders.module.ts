import { Module } from '@nestjs/common';
import { PartyOrdersService } from './party-orders.service';
import { PartyOrdersController } from './party-orders.controller';
import { CarpenterModule } from '../../carpenter/carpenter.module';
import { ProductsModule } from '../../inventory/products/products.module';

@Module({
  imports: [CarpenterModule, ProductsModule],
  controllers: [PartyOrdersController],
  providers: [PartyOrdersService],
})
export class PartyOrdersModule {}
