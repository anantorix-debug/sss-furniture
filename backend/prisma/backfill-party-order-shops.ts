// One-time backfill for legacy PartyOrder rows created before the Shop
// directory existed - they have a shopName string but shopId: null, so
// they can't be grouped/routed to a Shop Dashboard. For each distinct
// shopName among those rows: reuse an existing Shop with that exact name
// if one already exists (never create a duplicate), otherwise create one
// new Shop from that name alone (no other fields - editable afterwards via
// Manage Shops). Every legacy order then gets its shopId linked to the
// resolved Shop. Nothing about the order's own data is touched or lost -
// this only ever fills in a previously-null shopId.
//
// Safe to run more than once (idempotent): rows already linked (shopId
// not null) are never touched, and shop matching is by exact unique name,
// so a second run finds the same shops and does nothing new.
//
// Usage: npx ts-node prisma/backfill-party-order-shops.ts

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const orphaned = await prisma.partyOrder.findMany({
    where: { shopId: null },
    select: { id: true, shopName: true },
  });

  if (orphaned.length === 0) {
    console.log('No legacy orders without a shopId - nothing to backfill.');
    return;
  }

  const distinctNames = Array.from(new Set(orphaned.map((o) => o.shopName)));
  console.log(`Found ${orphaned.length} legacy order(s) across ${distinctNames.length} distinct shop name(s).`);

  let reused = 0;
  let created = 0;
  let linkedOrders = 0;

  for (const name of distinctNames) {
    let shop = await prisma.shop.findUnique({ where: { name } });
    if (shop) {
      reused++;
    } else {
      shop = await prisma.shop.create({ data: { name } });
      created++;
      console.log(`  Created shop "${name}"`);
    }

    const result = await prisma.partyOrder.updateMany({
      where: { shopId: null, shopName: name },
      data: { shopId: shop.id },
    });
    linkedOrders += result.count;
  }

  console.log(`\nDone. Shops reused: ${reused} | Shops created: ${created} | Orders linked: ${linkedOrders}`);
}

main()
  .catch((err) => {
    console.error('Backfill failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
