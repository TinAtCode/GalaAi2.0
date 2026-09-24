import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { FILE_STORAGE } from './storage/file-storage.interface';
import { fileStorageProvider } from './storage/file-storage.factory';
import { OcrModule } from '../ocr/ocr.module';

// Speicher: Dateisystem oder S3-kompatibler Objektspeicher (STORAGE=s3),
// siehe storage/file-storage.factory.ts
@Module({
  imports: [OcrModule],
  controllers: [DocumentsController],
  providers: [DocumentsService, { provide: FILE_STORAGE, useFactory: fileStorageProvider }],
  exports: [FILE_STORAGE],
})
export class DocumentsModule {}
