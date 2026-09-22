import { Module } from '@nestjs/common';
import { PostCalculationController } from './post-calculation.controller';
import { PostCalculationService } from './post-calculation.service';

@Module({
  controllers: [PostCalculationController],
  providers: [PostCalculationService],
})
export class PostCalculationModule {}
