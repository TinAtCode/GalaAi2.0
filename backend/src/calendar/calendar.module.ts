import { Module } from '@nestjs/common';
import { EquipmentModule } from '../equipment/equipment.module';
import { CalendarController } from './calendar.controller';
import { CalendarService } from './calendar.service';

@Module({ imports: [EquipmentModule], controllers: [CalendarController], providers: [CalendarService] })
export class CalendarModule {}
