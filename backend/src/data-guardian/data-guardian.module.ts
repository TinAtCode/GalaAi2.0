import { Module } from '@nestjs/common';
import { DataGuardianController } from './data-guardian.controller';
import { DataGuardianService } from './data-guardian.service';

@Module({
  controllers: [DataGuardianController],
  providers: [DataGuardianService],
})
export class DataGuardianModule {}
