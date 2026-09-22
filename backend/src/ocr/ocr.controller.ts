import { Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { OcrService } from './ocr.service';

// Gleiche Permission wie das Dokumente-Modul (document.read) – OCR ist
// Teil desselben fachlichen Bereichs (Punkt 15).
@Controller('ocr')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.DOCUMENT_READ)
export class OcrController {
  constructor(private ocrService: OcrService) {}

  @Post('extract')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } }))
  extract(@UploadedFile() file: Express.Multer.File) {
    return this.ocrService.extractFromFile(file);
  }
}
