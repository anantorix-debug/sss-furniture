import { Injectable, NotFoundException } from '@nestjs/common';
import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

type AllocateSource = 'CUSTOMER_ORDER' | 'PARTY_ORDER';

export interface AllocateParams {
  productId?: string;
  productName: string;
  quantity: number;
  size?: string;
  // Pre-set at order creation - carried onto the placeholder work item so
  // the sequential handoff can auto-forward it all the way to Polish. See
  // CustomerOrderItem.color / PartyOrderItem.color.
  color?: string;
  source: AllocateSource;
  sourceCustomerOrderId?: string;
  sourcePartyOrderItemId?: string;
  // Job/reference number the resulting FinishedStockItem is filed under -
  // this is what the existing Dispatch Pipeline already searches/displays
  // by, unchanged.
  jobNumberForStock: string;
  userId: string;
}

export interface AllocateResult {
  stockReservedQty: number;
  productionQty: number;
  workItemId?: string;
}

export interface ReleaseParams {
  sourceCustomerOrderId?: string;
  sourcePartyOrderItemId?: string;
  userId: string;
}

// The one place the stock-first split lives (spec: check Godown Stock
// before creating production, split when partially available, full
// production when none). Used identically by Customer Orders and Party
// Order lines - see CustomerOrdersService/PartyOrdersService.
@Injectable()
export class StockAllocationService {
  constructor(private prisma: PrismaService) {}

  async allocate(params: AllocateParams): Promise<AllocateResult> {
    return this.prisma.$transaction(async (tx) => {
      let stockReservedQty = 0;

      if (params.productId) {
        const product = await tx.product.findUnique({ where: { id: params.productId } });
        if (!product) throw new NotFoundException('Stock product not found');

        const attempt = Math.min(params.quantity, product.availableQuantity);
        if (attempt > 0) {
          // Concurrency-safe: only decrements if availableQuantity still
          // covers `attempt` at the moment the UPDATE runs, so two
          // simultaneous orders can never both succeed against the same
          // last unit. Column names are camelCase in MySQL here (no @map
          // per-field in this schema).
          const affected: number = await tx.$executeRaw`
            UPDATE products
            SET availableQuantity = availableQuantity - ${attempt}
            WHERE id = ${params.productId} AND availableQuantity >= ${attempt}
          `;
          if (affected > 0) {
            stockReservedQty = attempt;
            await tx.productStockMovement.create({
              data: {
                productId: params.productId,
                type: 'RESERVED',
                quantity: attempt,
                previousAvailable: product.availableQuantity,
                newAvailable: product.availableQuantity - attempt,
                orderType: params.source === 'CUSTOMER_ORDER' ? 'CUSTOMER' : 'PARTY',
                orderId: params.sourceCustomerOrderId ?? params.sourcePartyOrderItemId,
                reason: 'Reserved for order',
                createdById: params.userId,
              },
            });
            await tx.finishedStockItem.create({
              data: {
                jobNumber: params.jobNumberForStock,
                productName: params.productName,
                quantity: attempt,
                completionDate: new Date(),
                status: 'AVAILABLE',
                productId: params.productId,
                sourceCustomerOrderId: params.sourceCustomerOrderId,
                sourcePartyOrderItemId: params.sourcePartyOrderItemId,
              },
            });
          }
          // affected === 0 means a concurrent reservation won the race
          // between the read above and the conditional update - the
          // remainder below simply falls through to production instead of
          // ever oversubscribing the shelf.
        }
      }

      const productionQty = params.quantity - stockReservedQty;
      let workItemId: string | undefined;
      if (productionQty > 0) {
        // Unassigned (carpenterId omitted) - Admin assigns a worker later
        // via the existing updateWorkItem, same as any other work item.
        // price/extra/total start at 0, matching createWorkItem's
        // "worker self-entry" convention: labour price is entered by
        // Admin/Co-Admin separately, never implied by the order's sale
        // price.
        const workItem = await tx.carpenterWorkItem.create({
          data: {
            workDate: new Date(),
            productName: params.productName,
            size: params.size,
            color: params.color,
            price: 0,
            extra: 0,
            quantity: productionQty,
            total: 0,
            source: params.source,
            sourceCustomerOrderId: params.sourceCustomerOrderId,
            sourcePartyOrderItemId: params.sourcePartyOrderItemId,
            productId: params.productId,
            createdById: params.userId,
          },
        });
        workItemId = workItem.id;
      }

      return { stockReservedQty, productionQty, workItemId };
    });
  }

  // Reverses a previous allocate() for one order/line - restores any
  // undispatched reserved stock, deletes any not-yet-started work item.
  // Refuses (rather than guesses) once fulfillment has actually moved:
  // dispatched stock can't be un-shipped, and work past ASSIGNED means
  // someone may already be partway through it.
  async release(params: ReleaseParams): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const finishedItems = await tx.finishedStockItem.findMany({
        where: {
          sourceCustomerOrderId: params.sourceCustomerOrderId,
          sourcePartyOrderItemId: params.sourcePartyOrderItemId,
        },
      });
      for (const item of finishedItems) {
        if (item.status === 'DISPATCHED') {
          throw new ConflictException(
            `Cannot change this line - ${item.quantity} unit(s) of "${item.productName}" have already been dispatched`,
          );
        }
      }

      const workItems = await tx.carpenterWorkItem.findMany({
        where: {
          sourceCustomerOrderId: params.sourceCustomerOrderId,
          sourcePartyOrderItemId: params.sourcePartyOrderItemId,
        },
      });
      for (const item of workItems) {
        if (item.status !== 'ASSIGNED') {
          throw new ConflictException(
            `Cannot change this line - production for "${item.productName}" is already ${item.status.toLowerCase().replace('_', ' ')}`,
          );
        }
      }

      for (const item of finishedItems) {
        if (item.productId) {
          const product = await tx.product.findUnique({ where: { id: item.productId } });
          if (product) {
            await tx.product.update({
              where: { id: item.productId },
              data: { availableQuantity: { increment: item.quantity } },
            });
            await tx.productStockMovement.create({
              data: {
                productId: item.productId,
                type: 'RELEASED',
                quantity: item.quantity,
                previousAvailable: product.availableQuantity,
                newAvailable: product.availableQuantity + item.quantity,
                reason: 'Order cancelled/edited - reservation released',
                createdById: params.userId,
              },
            });
          }
        }
        await tx.finishedStockItem.delete({ where: { id: item.id } });
      }

      for (const item of workItems) {
        await tx.carpenterWorkItem.delete({ where: { id: item.id } });
      }
    });
  }
}
