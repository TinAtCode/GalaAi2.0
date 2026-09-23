import { Module } from '@nestjs/common';
import { InvoicesController, OpenItemsController } from './invoices.controller';
import { PaymentsService } from './payments.service';
import { DunningService } from './dunning.service';
import { InvoicesService } from './invoices.service';

@Module({
  controllers: [InvoicesController, OpenItemsController],
  providers: [InvoicesService, PaymentsService, DunningService],
  exports: [PaymentsService],
})
export class InvoicesModule {}
