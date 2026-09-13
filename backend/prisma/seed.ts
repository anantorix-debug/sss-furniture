import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';

const prisma = new PrismaClient();

async function main() {
  console.log('🌱 Seeding database...');

  // Create users
  const adminPassword = await bcrypt.hash('admin123', 10);
  const carpenterPassword = await bcrypt.hash('carpenter123', 10);

  const admin = await prisma.user.create({
    data: {
      name: 'Super Admin',
      email: 'admin@sss.com',
      password: adminPassword,
      role: 'SUPERADMIN',
      isActive: true,
    },
  }).catch(() => null);

  const carpenter1 = await prisma.user.create({
    data: {
      name: 'Raj Carpenter',
      email: 'raj@sss.com',
      password: carpenterPassword,
      role: 'CARPENTER',
      isActive: true,
    },
  }).catch(() => null);

  console.log('✓ Created users');

  // Create suppliers
  const supplier1 = await prisma.supplier.create({
    data: {
      name: 'Devi Ply Wood',
      phone: '9876543210',
      address: 'Bangalore, Karnataka',
    },
  }).catch(() => null);

  console.log('✓ Created suppliers');

  // Create raw materials
  const plywood = await prisma.rawMaterial.create({
    data: {
      name: '18mm Plywood 8x4',
      type: 'Plywood',
      materialGroup: 'WOOD',
      unit: 'sheet',
      reorderLevel: 10,
    },
  }).catch(() => null);

  console.log('✓ Created raw materials');

  // Create products
  const product1 = await prisma.product.create({
    data: {
      name: 'Heartiness Cot',
      sku: 'HEARTENSS-001',
      modelNo: 'MOD-001',
      category: 'Beds',
      modelSize: '6x5 ft',
      materialFinish: 'Teak - Teak finish',
      unit: 'Nos',
      retailPrice: 45000,
      wholesalePrice: 35000,
      costPrice: 20000,
      isActive: true,
    },
  }).catch(() => null);

  console.log('✓ Created products');

  // Create carpenters
  const carpenterWorker1 = await prisma.carpenter.create({
    data: {
      name: 'Anand Kumar',
      phone: '9876543210',
      workerType: 'CARPENTER',
    },
  }).catch(() => null);

  console.log('✓ Created carpenters');

  // Create customer orders if we have admin
  if (admin && product1) {
    const today = new Date();
    const customerOrders = [
      {
        orderId: 'CO-1001',
        customerName: 'Rajesh Kumar',
        phone: '9876543210',
        address: '123 Main Street, Bangalore',
        product: 'Custom Teak Dining Table',
        orderValue: 85000,
        deliveryStatus: 'PENDING',
        orderDate: new Date(today.getTime() - 15 * 24 * 60 * 60 * 1000),
      },
      {
        orderId: 'CO-1002',
        customerName: 'Priya Singh',
        phone: '9876543211',
        address: '456 Park Avenue, Bangalore',
        product: 'Rosewood Bed Frame',
        orderValue: 65000,
        deliveryStatus: 'DELIVERED',
        orderDate: new Date(today.getTime() - 30 * 24 * 60 * 60 * 1000),
      },
      {
        orderId: 'CO-1003',
        customerName: 'Amitabh Verma',
        phone: '9876543212',
        address: '789 Oak Road, Bangalore',
        product: 'Walnut Wardrobe',
        orderValue: 95000,
        deliveryStatus: 'PENDING',
        orderDate: new Date(today.getTime() - 7 * 24 * 60 * 60 * 1000),
      },
      {
        orderId: 'CO-1004',
        customerName: 'Divya Nair',
        phone: '9876543213',
        address: '321 Elm Street, Bangalore',
        product: 'Sheesham Coffee Table',
        orderValue: 35000,
        deliveryStatus: 'PENDING',
        orderDate: new Date(today.getTime() - 5 * 24 * 60 * 60 * 1000),
      },
      {
        orderId: 'CO-1005',
        customerName: 'Vikram Patel',
        phone: '9876543214',
        address: '654 Pine Lane, Bangalore',
        product: 'Teak Bookshelf',
        orderValue: 45000,
        deliveryStatus: 'DELIVERED',
        orderDate: new Date(today.getTime() - 45 * 24 * 60 * 60 * 1000),
      },
      {
        orderId: 'CO-1006',
        customerName: 'Ananya Das',
        phone: '9876543215',
        address: '987 Maple Drive, Bangalore',
        product: 'Custom Sofa Set',
        orderValue: 125000,
        deliveryStatus: 'PENDING',
        orderDate: new Date(today.getTime() - 3 * 24 * 60 * 60 * 1000),
      },
      {
        orderId: 'CO-1007',
        customerName: 'Rohit Gupta',
        phone: '9876543216',
        address: '111 Cedar Road, Bangalore',
        product: 'TV Console Unit',
        orderValue: 55000,
        deliveryStatus: 'DELIVERED',
        orderDate: new Date(today.getTime() - 60 * 24 * 60 * 60 * 1000),
      },
      {
        orderId: 'CO-1008',
        customerName: 'Neha Sharma',
        phone: '9876543217',
        address: '222 Birch Street, Bangalore',
        product: 'Dining Chairs (Set of 6)',
        orderValue: 42000,
        deliveryStatus: 'PENDING',
        orderDate: new Date(today.getTime() - 2 * 24 * 60 * 60 * 1000),
      },
      {
        orderId: 'CO-1009',
        customerName: 'Suresh Reddy',
        phone: '9876543218',
        address: '333 Spruce Lane, Bangalore',
        product: 'Wooden Bed Headboard',
        orderValue: 38000,
        deliveryStatus: 'DELIVERED',
        orderDate: new Date(today.getTime() - 75 * 24 * 60 * 60 * 1000),
      },
      {
        orderId: 'CO-1010',
        customerName: 'Meera Iyer',
        phone: '9876543219',
        address: '444 Willow Court, Bangalore',
        product: 'Storage Cabinet',
        orderValue: 52000,
        deliveryStatus: 'PENDING',
        orderDate: new Date(today.getTime() - 1 * 24 * 60 * 60 * 1000),
      },
    ];

    for (const order of customerOrders) {
      await prisma.customerOrder.create({
        data: {
          orderId: order.orderId,
          orderDate: order.orderDate,
          customerName: order.customerName,
          phone: order.phone,
          address: order.address,
          product: order.product,
          colour: 'Mixed',
          orderValue: order.orderValue,
          deliveryStatus: order.deliveryStatus as any,
          createdById: admin.id,
        },
      }).catch(() => null);
    }
  }

  console.log('✓ Created customer orders');
  console.log('🔧 Starting party orders...');

  // Create party orders if we have admin
  if (admin) {
    console.log('✓ Admin exists, creating party orders');
    const today = new Date();
    const shopNames = [
      'Furniture Hub', 'Modern Interiors', 'Wood Paradise', 'Elite Furnishings', 'Home Depot',
      'Comfort Zone', 'Design House', 'Luxury Living', 'Vintage & Modern', 'Space Solutions'
    ];

    for (let i = 0; i < shopNames.length; i++) {
      await prisma.partyOrder.create({
        data: {
          shopName: shopNames[i],
          phone: `988654330${i}`,
          model: `Model ${i + 1}`,
          qty: 2 + i,
          price: 20000 + (i * 5000),
          totalAmount: (20000 + (i * 5000)) * (2 + i),
          deliveryStatus: i % 2 === 0 ? 'PENDING' : 'DELIVERED',
          orderDate: new Date(today.getTime() - (i * 10) * 24 * 60 * 60 * 1000),
          createdById: admin.id,
        },
      }).catch((e) => console.log(`Failed to create party order ${i}:`, e.message));
    }
  }

  console.log('✓ Created party orders');

  // --- Suppliers <-> Inventory sample data ---------------------------------
  // One connected purchase per MaterialMeasurementKind, so the whole
  // Supplier -> RawMaterial -> StockMovement flow (including the board-feet
  // wood math) is visible in the running app immediately, not just
  // testable via curl. Idempotent - safe to run this seed script again.
  console.log('🪵 Seeding Suppliers <-> Inventory sample data...');

  const adminUser = admin ?? (await prisma.user.findUnique({ where: { email: 'admin@sss.com' } }));

  if (adminUser) {
    // Backfill the 3 materials already sitting in the dev DB - they were
    // added by hand through the running app before measurementKind
    // existed, not by this seed script, so they still default to OTHER.
    await prisma.rawMaterial.updateMany({ where: { name: 'French Polish' }, data: { measurementKind: 'LIQUID' } });
    await prisma.rawMaterial.updateMany({ where: { name: 'Plywood 19mm' }, data: { measurementKind: 'SHEET' } });
    await prisma.rawMaterial.updateMany({ where: { name: 'Wood Carving Blade Set' }, data: { measurementKind: 'COUNT' } });

    let demoSupplier = await prisma.supplier.findUnique({ where: { name: 'Sathya Timber Traders' } });
    if (!demoSupplier) {
      demoSupplier = await prisma.supplier.create({
        data: { name: 'Sathya Timber Traders', phone: '9876500001', address: 'Chennai, Tamil Nadu' },
      });
    }

    const seedConnectedPurchase = async (opts: {
      materialName: string;
      materialType: string;
      materialGroup: 'WOOD' | 'CARVING' | 'POLISH' | 'OTHER';
      measurementKind: 'BOARD_FEET' | 'SHEET' | 'LIQUID' | 'COUNT';
      unit?: string; // only used for LIQUID - the others lock their own unit
      particulars: string;
      qty: number;
      price: number;
      dims?: { thicknessIn: number; widthIn: number; lengthFt: number; pieces: number };
    }) => {
      let material = await prisma.rawMaterial.findUnique({ where: { name: opts.materialName } });
      if (!material) {
        const unit =
          opts.measurementKind === 'BOARD_FEET' ? 'Board Feet' : opts.measurementKind === 'SHEET' ? 'Sheet' : opts.measurementKind === 'COUNT' ? 'Nos' : (opts.unit ?? 'Litre');
        material = await prisma.rawMaterial.create({
          data: { name: opts.materialName, type: opts.materialType, materialGroup: opts.materialGroup, measurementKind: opts.measurementKind, unit, reorderLevel: 5 },
        });
      }

      const already = await prisma.supplierPurchase.findFirst({ where: { rawMaterialId: material.id, particulars: opts.particulars } });
      if (already) return;

      const purchase = await prisma.supplierPurchase.create({
        data: {
          supplierId: demoSupplier!.id,
          date: new Date(),
          particulars: opts.particulars,
          qty: opts.qty,
          unit: material.unit,
          price: opts.price,
          value: opts.qty * opts.price,
          rawMaterialId: material.id,
          thicknessIn: opts.dims?.thicknessIn,
          widthIn: opts.dims?.widthIn,
          lengthFt: opts.dims?.lengthFt,
          pieces: opts.dims?.pieces,
          createdById: adminUser!.id,
        },
      });

      await prisma.stockMovement.create({
        data: {
          rawMaterialId: material.id,
          type: 'IN',
          quantity: opts.qty,
          unitCost: opts.price,
          reason: `Purchase from ${demoSupplier!.name}`,
          supplierPurchaseId: purchase.id,
          date: new Date(),
          createdById: adminUser!.id,
        },
      });
    };

    // The spec's own worked example: 2" x 6" x 10', 5 pieces, Rs.500/BF -> 50 Board Feet, Rs.25,000
    await seedConnectedPurchase({
      materialName: 'Teak Wood (Raw)',
      materialType: 'Timber',
      materialGroup: 'WOOD',
      measurementKind: 'BOARD_FEET',
      particulars: 'Teak Wood (Raw) - 2x6x10ft boards',
      qty: 50,
      price: 500,
      dims: { thicknessIn: 2, widthIn: 6, lengthFt: 10, pieces: 5 },
    });

    await seedConnectedPurchase({
      materialName: 'Teak Plywood 12mm',
      materialType: 'Plywood',
      materialGroup: 'WOOD',
      measurementKind: 'SHEET',
      particulars: 'Teak Plywood 12mm - 10 sheets',
      qty: 10,
      price: 800,
    });

    await seedConnectedPurchase({
      materialName: 'PU Polish Coat',
      materialType: 'Polish',
      materialGroup: 'POLISH',
      measurementKind: 'LIQUID',
      unit: 'Litre',
      particulars: 'PU Polish Coat - 5 Litre',
      qty: 5,
      price: 300,
    });

    await seedConnectedPurchase({
      materialName: 'Carving Chisel Set',
      materialType: 'Tool',
      materialGroup: 'CARVING',
      measurementKind: 'COUNT',
      particulars: 'Carving Chisel Set - 10 Nos',
      qty: 10,
      price: 150,
    });

    console.log('✓ Seeded Suppliers <-> Inventory sample data (Board Feet, Sheet, Liquid, Count)');
  }

  console.log('\n✅ Database seeded successfully!');
  console.log('\n📋 Test Credentials:');
  console.log('  Super Admin:  admin@sss.com / admin123');
  console.log('  Carpenter:    raj@sss.com / carpenter123');
}

main()
  .catch((e) => {
    console.error('❌ Seeding failed:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
