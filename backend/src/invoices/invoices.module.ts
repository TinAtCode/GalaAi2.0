import { Module } from '@nestjs/common';
import { InvoicesController, OpenItemsController } from './invoices.controller';
import { PaymentsService } from './payments.service';
import { InvoicesService } from './invoices.service';

@Module({
  controllers: [InvoicesController, OpenItemsController],
  providers: [InvoicesService, PaymentsService],
})
export class InvoicesModule {}
