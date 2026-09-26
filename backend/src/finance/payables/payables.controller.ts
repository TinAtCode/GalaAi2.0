import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  Param,
  Patch,
  Post,
  Put,
  Query,
  StreamableFile,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../../auth/jwt-auth.guard';
import { PermissionsGuard } from '../../common/permissions.guard';
import { RequirePermissions } from '../../common/permissions.decorator';
import { PERMISSIONS } from '../../common/permissions';
import { CurrentUser } from '../../common/current-user.decorator';
import { AuthenticatedUser } from '../../common/authenticated-request';
import { requiredFile } from '../../common/required-file';
import { ListPayablesDto, PayPayableDto, SetDeliveryNotesDto, UpsertPayableDto } from './payables.dto';
import { PayablesService } from './payables.service';

const upload = FileInterceptor('file', { limits: { fileSize: 20 * 1024 * 1024 } });

// Eingangsrechnungen – wie der ganze Finanzbereich nur für Geschäftsführung
// und Buchhaltung (Recht finance.read)
@Controller('finance/payables')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.FINANCE_READ)
export class PayablesController {
  constructor(private payables: PayablesService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListPayablesDto) {
    return this.payables.list(user.companyId, query);
  }

  // Beleg einlesen (PDF, Foto, E-Rechnung): Vorschläge fürs Formular
  @Post('extract')
  @UseInterceptors(upload)
  extract(@CurrentUser() user: AuthenticatedUser, @UploadedFile(requiredFile()) file: Express.Multer.File) {
    return this.payables.extract(user.companyId, user.userId, file);
  }

  // Beleg von der KI lesen lassen (braucht einen Anbieter, der Bilder versteht)
  @Post('documents/:documentId/ai-read')
  @RequirePermissions(PERMISSIONS.FINANCE_READ, PERMISSIONS.AI_USE)
  readWithAi(@CurrentUser() user: AuthenticatedUser, @Param('documentId') documentId: string) {
    return this.payables.readWithAi(user, documentId);
  }

  // eingelesenen Beleg verwerfen, wenn doch keine Rechnung daraus wird
  @Delete('documents/:documentId')
  discard(@CurrentUser() user: AuthenticatedUser, @Param('documentId') documentId: string) {
    return this.payables.discardDocument(user.companyId, documentId);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: UpsertPayableDto) {
    return this.payables.create(user.companyId, user.userId, dto);
  }

  @Patch(':id')
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpsertPayableDto) {
    return this.payables.update(user.companyId, user.userId, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.payables.remove(user.companyId, user.userId, id);
  }

  // Lieferscheine zur Rechnung: zugeordnete und Vorschläge
  @Get(':id/delivery-notes')
  deliveryNotes(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.payables.deliveryNotes(user.companyId, id);
  }

  @Put(':id/delivery-notes')
  setDeliveryNotes(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: SetDeliveryNotesDto,
  ) {
    return this.payables.setDeliveryNotes(user.companyId, id, dto);
  }

  @Post(':id/pay')
  pay(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: PayPayableDto) {
    return this.payables.pay(user.companyId, user.userId, id, dto);
  }

  @Post(':id/reopen')
  reopen(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.payables.reopen(user.companyId, user.userId, id);
  }

  @Post(':id/cancel')
  cancel(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.payables.cancel(user.companyId, user.userId, id);
  }

  @Get(':id/file')
  @Header('Content-Type', 'application/octet-stream')
  async file(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    const { content, fileName } = await this.payables.file(user.companyId, id);
    return new StreamableFile(content, {
      disposition: `attachment; filename="${encodeURIComponent(fileName)}"`,
    });
  }
}
