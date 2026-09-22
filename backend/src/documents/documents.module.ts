import { Module } from '@nestjs/common';
import { DocumentsController } from './documents.controller';
import { DocumentsService } from './documents.service';
import { FILE_STORAGE } from './storage/file-storage.interface';
import { LocalDiskStorage } from './storage/local-disk.storage';

// Speicher-Anbieter wechseln = diese eine Zeile ändern (analog zum
// KI-Gateway), sobald z.B. S3/MinIO ansteht.
@Module({
  controllers: [DocumentsController],
  providers: [DocumentsService, { provide: FILE_STORAGE, useClass: LocalDiskStorage }],
})
export class DocumentsModule {}
