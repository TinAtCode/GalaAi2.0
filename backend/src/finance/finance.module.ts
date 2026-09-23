import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { CategoriesService } from './categories.service';
import { RecurringService } from './recurring.service';

@Module({
  imports: [InvoicesModule],
  controllers: [FinanceController],
  providers: [FinanceService, CategoriesService, RecurringService],
  exports: [CategoriesService],
})
export class FinanceModule {}
