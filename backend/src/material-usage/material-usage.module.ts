import { Module } from '@nestjs/common';
import { MaterialUsageController } from './material-usage.controller';
import { MaterialUsageService } from './material-usage.service';

@Module({
  controllers: [MaterialUsageController],
  providers: [MaterialUsageService],
})
export class MaterialUsageModule {}
