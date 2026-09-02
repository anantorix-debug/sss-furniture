import { Module } from '@nestjs/common';
import { ExpensesController } from './expenses.controller';
import { ExpensesService } from './expenses.service';
import { ExpenseConfigController } from './expense-config.controller';
import { ExpenseConfigService } from './expense-config.service';

@Module({
  controllers: [ExpensesController, ExpenseConfigController],
  providers: [ExpensesService, ExpenseConfigService],
})
export class ExpensesModule {}
