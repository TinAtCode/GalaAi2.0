import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsHistoryService } from './metrics-history.service';

@Module({
  controllers: [MetricsController],
  providers: [MetricsHistoryService],
})
export class MetricsModule {}
