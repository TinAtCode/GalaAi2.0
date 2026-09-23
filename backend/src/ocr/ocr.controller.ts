import {
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { OcrService } from './ocr.service';
import { OcrQueue } from './ocr-queue';
import { OcrJobsService } from './ocr-jobs.service';
import { requiredFile } from '../common/required-file';

const upload = FileInterceptor('file', { limits: { fileSize: 15 * 1024 * 1024 } });

// Gleiche Permission wie das Dokumente-Modul (document.read) – OCR ist
// Teil desselben fachlichen Bereichs (Punkt 15).
@Controller('ocr')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.DOCUMENT_READ)
export class OcrController {
  constructor(
    private ocrService: OcrService,
    private queue: OcrQueue,
    private jobs: OcrJobsService,
  ) {}

  // Sofort-Variante: wartet auf das Ergebnis, läuft aber ebenfalls über die
  // Warteschlange. Für große Scans besser /ocr/jobs.
  @Post('extract')
  @UseInterceptors(upload)
  extract(@UploadedFile(requiredFile()) file: Express.Multer.File) {
    this.ocrService.assertSupported(file);
    return this.queue.run(() => this.ocrService.extractFromFile(file));
  }

  // Auftrag anlegen: Antwort sofort (202) mit der Auftrags-ID.
  @Post('jobs')
  @HttpCode(202)
  @UseInterceptors(upload)
  createJob(@CurrentUser() user: AuthenticatedUser, @UploadedFile(requiredFile()) file: Express.Multer.File) {
    return this.jobs.create(user.companyId, user.userId, file);
  }

  // Status und – wenn fertig – Ergebnis eines Auftrags
  @Get('jobs/:id')
  getJob(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.jobs.findOne(user.companyId, id);
  }
}
