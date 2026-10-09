import { Module } from '@nestjs/common';
import { CustomerOrdersModule } from '../orders/customer/customer-orders.module';
import { PartyOrdersModule } from '../orders/party/party-orders.module';
import { ProductsModule } from '../inventory/products/products.module';
import { RawMaterialsModule } from '../inventory/raw-materials/raw-materials.module';
import { SuppliersModule } from '../suppliers/suppliers.module';
import { PurchasesModule } from '../orders/purchase/purchases.module';
import { CarpenterModule } from '../carpenter/carpenter.module';
import { ExpensesModule } from '../expenses/expenses.module';
import { ImportsController } from './imports.controller';
import { ImportsService } from './imports.service';
import { CustomerOrdersImport } from './kinds/customer-orders.import';
import { PartyOrdersImport } from './kinds/party-orders.import';
import { ProductsImport, RawMaterialsImport } from './kinds/inventory.import';
import { PurchasesImport, SupplierPaymentsImport, SupplierPurchasesImport, SuppliersImport } from './kinds/purchasing.import';
import { ProductionWorkImport, WorkerPaymentsImport, WorkerWorkImport } from './kinds/production.import';
import { PaymentsImport } from './kinds/payments.import';
import { ExpensesImport } from './kinds/expenses.import';

@Module({
  imports: [CustomerOrdersModule, PartyOrdersModule, ProductsModule, RawMaterialsModule, SuppliersModule, PurchasesModule, CarpenterModule, ExpensesModule],
  controllers: [ImportsController],
  providers: [
    ImportsService,
    CustomerOrdersImport,
    PartyOrdersImport,
    ProductsImport,
    RawMaterialsImport,
    SuppliersImport,
    PurchasesImport,
    SupplierPurchasesImport,
    SupplierPaymentsImport,
    WorkerWorkImport,
    WorkerPaymentsImport,
    ProductionWorkImport,
    PaymentsImport,
    ExpensesImport,
  ],
})
export class ImportsModule {}
