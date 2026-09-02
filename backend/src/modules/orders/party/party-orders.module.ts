import { Module } from '@nestjs/common';
import { PartyOrdersService } from './party-orders.service';
import { PartyOrdersController } from './party-orders.controller';
import { CarpenterModule } from '../../carpenter/carpenter.module';

@Module({
  imports: [CarpenterModule],
  controllers: [PartyOrdersController],
  providers: [PartyOrdersService],
})
export class PartyOrdersModule {}
