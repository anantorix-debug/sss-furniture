import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './modules/prisma/prisma.module';
import { AuthModule } from './modules/auth/auth.module';
import { UsersModule } from './modules/users/users.module';
import { WhatsappModule } from './modules/whatsapp/whatsapp.module';
import { AuditModule } from './modules/audit/audit.module';
import { CarpenterModule } from './modules/carpenter/carpenter.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { ReportsModule } from './modules/reports/reports.module';
import { SearchModule } from './modules/search/search.module';
import { PdfModule } from './modules/pdf/pdf.module';
import { SuppliersModule } from './modules/suppliers/suppliers.module';
import { CustomerOrdersModule } from './modules/orders/customer/customer-orders.module';
import { PartyOrdersModule } from './modules/orders/party/party-orders.module';
import { PurchaseOrdersModule } from './modules/orders/purchase/purchase-orders.module';
import { ProductsModule } from './modules/inventory/products/products.module';
import { RawMaterialsModule } from './modules/inventory/raw-materials/raw-materials.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    PrismaModule,
    AuthModule,
    UsersModule,
    WhatsappModule,
    AuditModule,
    CarpenterModule,
    DashboardModule,
    PaymentsModule,
    ReportsModule,
    SearchModule,
    PdfModule,
    SuppliersModule,
    CustomerOrdersModule,
    PartyOrdersModule,
    PurchaseOrdersModule,
    ProductsModule,
    RawMaterialsModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
