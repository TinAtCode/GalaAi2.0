import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';

@Module({
  imports: [InvoicesModule],
  controllers: [FinanceController],
  providers: [FinanceService],
})
export class FinanceModule {}
