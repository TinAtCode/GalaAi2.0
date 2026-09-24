import { Module } from '@nestjs/common';
import { MasterDataImportController } from './master-data-import.controller';
import { MasterDataImportService } from './master-data-import.service';

@Module({
  controllers: [MasterDataImportController],
  providers: [MasterDataImportService],
})
export class MasterDataImportModule {}
