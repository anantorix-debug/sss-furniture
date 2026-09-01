import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { PdfModule } from './pdf/pdf.module';
import { AuditModule } from './audit/audit.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CustomerOrdersModule } from './customer-orders/customer-orders.module';
import { PartyOrdersModule } from './party-orders/party-orders.module';
import { SuppliersModule } from './suppliers/suppliers.module';
import { CarpenterModule } from './carpenter/carpenter.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { ProductsModule } from './products/products.module';
import { RawMaterialsModule } from './raw-materials/raw-materials.module';
import { PurchaseOrdersModule } from './purchase-orders/purchase-orders.module';
import { PaymentsModule } from './payments/payments.module';
import { ReportsModule } from './reports/reports.module';
import { SearchModule } from './search/search.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 120 }]),
    PrismaModule,
    WhatsappModule,
    PdfModule,
    AuditModule,
    AuthModule,
    UsersModule,
    CustomerOrdersModule,
    PartyOrdersModule,
    SuppliersModule,
    CarpenterModule,
    DashboardModule,
    ProductsModule,
    RawMaterialsModule,
    PurchaseOrdersModule,
    PaymentsModule,
    ReportsModule,
    SearchModule,
  ],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule {}
