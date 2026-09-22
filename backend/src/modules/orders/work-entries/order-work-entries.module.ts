import { Global, Module } from '@nestjs/common';
import { OrderWorkEntriesService } from './order-work-entries.service';
import { OrderWorkEntriesController } from './order-work-entries.controller';

// Global (same pattern as AuditModule/PdfModule/WhatsappModule) so
// CustomerOrdersController and PartyOrdersController can each inject
// OrderWorkEntriesService directly for their own ':id/work-entries' routes
// without needing an explicit module import. This module's own controller
// only hosts the cross-order GET /order-work-entries listing (Production
// Control's "Work Entries" tab) - everything per-order stays on those two.
@Global()
@Module({
  controllers: [OrderWorkEntriesController],
  providers: [OrderWorkEntriesService],
  exports: [OrderWorkEntriesService],
})
export class OrderWorkEntriesModule {}
