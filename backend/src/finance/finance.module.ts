import { AiGatewayModule } from '../ai-gateway/ai-gateway.module';
import { Module } from '@nestjs/common';
import { InvoicesModule } from '../invoices/invoices.module';
import { FinanceController } from './finance.controller';
import { FinanceService } from './finance.service';
import { CategoriesService } from './categories.service';
import { RecurringService } from './recurring.service';
import { ContractsService } from './contracts.service';
import { DocumentsModule } from '../documents/documents.module';
import { OcrModule } from '../ocr/ocr.module';
import { PayablesController } from './payables/payables.controller';
import { PayablesService } from './payables/payables.service';

@Module({
  imports: [InvoicesModule, DocumentsModule, OcrModule, AiGatewayModule],
  controllers: [FinanceController, PayablesController],
  providers: [FinanceService, CategoriesService, RecurringService, PayablesService, ContractsService],
  exports: [CategoriesService, PayablesService],
})
export class FinanceModule {}
