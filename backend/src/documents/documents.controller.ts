import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
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
import { DocumentsService } from './documents.service';
import { CreateDocumentDto, DOCUMENT_TYPES } from './dto/create-document.dto';
import { requiredFile } from '../common/required-file';
import { Response } from 'express';
import { PageQueryDto, withTotalCount } from '../common/pagination';

// "Dokumente sehen" ist laut Punkt 8 eine eigene, geschützte Berechtigung –
// gilt hier für Lesen UND Registrieren (kein separates "Dokumente
// hochladen"-Recht im Ursprungsdokument definiert).
@Controller('documents')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.DOCUMENT_READ)
export class DocumentsController {
  constructor(private documentsService: DocumentsService) {}

  @Get()
  async findAllForCompany(
    @CurrentUser() user: AuthenticatedUser,
    @Query() page: PageQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return withTotalCount(res, await this.documentsService.findAllForCompany(user.companyId, page));
  }

  // ?q=: Suche in Dateiname und erkanntem Text
  @Get('by-project/:projectId')
  findAllForProject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('projectId') projectId: string,
    @Query('q') q?: string,
  ) {
    return this.documentsService.findAllForProject(user.companyId, projectId, q);
  }

  @Get(':id')
  findOne(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.documentsService.findOne(user.companyId, id);
  }

  @Get(':id/download')
  @Header('Content-Type', 'application/octet-stream')
  async download(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const { buffer, fileName } = await this.documentsService.getFileContent(user.companyId, id);
    return new StreamableFile(buffer, {
      disposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
    });
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateDocumentDto) {
    return this.documentsService.create(user.companyId, user.userId, dto);
  }

  // Echter Datei-Upload: Datei + Metadaten in einem Request statt "Datei
  // irgendwo ablegen, dann Pfad manuell in POST /documents eintragen".
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } }))
  upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile(requiredFile()) file: Express.Multer.File,
    @Query('projectId') projectId?: string,
    @Query('documentType') documentType?: (typeof DOCUMENT_TYPES)[number],
    // ocr=1: Text erkennen (PDF oder Bild), Ergebnis am Dokument
    @Query('ocr') ocr?: string,
  ) {
    return this.documentsService.upload(
      user.companyId,
      user.userId,
      file,
      projectId,
      documentType,
      ocr === '1' || ocr === 'true',
    );
  }

  // Löschen braucht zusätzlich ein eigenes Recht
  @Delete(':id')
  @RequirePermissions(PERMISSIONS.DOCUMENT_READ, PERMISSIONS.DOCUMENT_DELETE)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.documentsService.remove(user.companyId, user.userId, id);
  }
}
