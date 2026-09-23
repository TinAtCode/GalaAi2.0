import { Module } from '@nestjs/common';
import { DatevController } from './datev.controller';
import { DatevService } from './datev.service';

@Module({
  controllers: [DatevController],
  providers: [DatevService],
})
export class DatevModule {}
