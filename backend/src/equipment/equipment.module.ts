import { Module } from '@nestjs/common';
import { EquipmentController, InventoryController } from './equipment.controller';
import { EquipmentService } from './equipment.service';

@Module({
  controllers: [EquipmentController, InventoryController],
  providers: [EquipmentService],
  exports: [EquipmentService],
})
export class EquipmentModule {}
