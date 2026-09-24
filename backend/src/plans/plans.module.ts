import { Module } from '@nestjs/common';
import { DocumentsModule } from '../documents/documents.module';
import { PlansController } from './plans.controller';
import { PlansService } from './plans.service';

@Module({
  imports: [DocumentsModule],
  controllers: [PlansController],
  providers: [PlansService],
})
export class PlansModule {}
