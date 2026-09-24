import { Module } from '@nestjs/common';
import { QuotesController } from './quotes.controller';
import { QuotesService } from './quotes.service';
import { UnitsModule } from '../units/units.module';
import { CalculationsModule } from '../calculations/calculations.module';

@Module({
  imports: [CalculationsModule, UnitsModule],
  controllers: [QuotesController],
  providers: [QuotesService],
})
export class QuotesModule {}
