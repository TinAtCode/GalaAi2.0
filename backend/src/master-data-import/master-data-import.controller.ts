import {
  Body,
  Controller,
  Delete,
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
import { requiredFile } from '../common/required-file';
import { MasterDataImportService } from './master-data-import.service';
import { ImportApplyDto, ImportPreviewDto, ImportTextDto } from './master-data-import.dto';

// Stammdaten-Import (Kunden, Lieferanten, Artikel, Maschinen): einlesen ->
// Spalten zuordnen -> Vorschau mit Abgleich -> ausgewählte Zeilen übernehmen.
// Wie der Preislisten-Import mit data.import, dazu masterdata.write.
@Controller('master-data-import')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.DATA_IMPORT, PERMISSIONS.MASTERDATA_WRITE)
export class MasterDataImportController {
  constructor(private service: MasterDataImportService) {}

  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  upload(@CurrentUser() user: AuthenticatedUser, @UploadedFile(requiredFile()) file: Express.Multer.File) {
    return this.service.fromFile(user.companyId, user.userId, file);
  }

  @Post('text')
  text(@CurrentUser() user: AuthenticatedUser, @Body() dto: ImportTextDto) {
    return this.service.fromText(user.companyId, user.userId, dto.text);
  }

  @Post(':sessionId/preview')
  preview(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
    @Body() dto: ImportPreviewDto,
  ) {
    return this.service.preview(user.companyId, user.permissions, sessionId, dto.entity, dto.mapping);
  }

  @Post(':sessionId/apply')
  apply(
    @CurrentUser() user: AuthenticatedUser,
    @Param('sessionId') sessionId: string,
    @Body() dto: ImportApplyDto,
  ) {
    return this.service.apply(
      user.companyId,
      user.userId,
      user.permissions,
      sessionId,
      dto.entity,
      dto.mapping,
      dto.accept,
    );
  }

  @Delete(':sessionId')
  discard(@CurrentUser() user: AuthenticatedUser, @Param('sessionId') sessionId: string) {
    return this.service.discard(user.companyId, sessionId);
  }
}
