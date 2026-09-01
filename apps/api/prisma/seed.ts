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
