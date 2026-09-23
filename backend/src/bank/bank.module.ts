import { Module } from '@nestjs/common';
import { BankController } from './bank.controller';
import { BankService } from './bank.service';
import { InvoicesModule } from '../invoices/invoices.module';
import { FinanceModule } from '../finance/finance.module';

@Module({
  imports: [InvoicesModule, FinanceModule],
  controllers: [BankController],
  providers: [BankService],
})
export class BankModule {}
