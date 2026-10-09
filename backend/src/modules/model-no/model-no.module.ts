import { Global, Module } from '@nestjs/common';
import { ModelNoService } from './model-no.service';
import { ModelNoSyncService } from './model-no-sync.service';

// Global (like Prisma/Audit) because every module that writes or looks up a
// Model No - products, orders, production, stock, imports - uses the same
// service rather than carrying its own copy of the logic.
@Global()
@Module({
  providers: [ModelNoService, ModelNoSyncService],
  exports: [ModelNoService, ModelNoSyncService],
})
export class ModelNoModule {}
