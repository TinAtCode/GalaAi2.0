import { Body, Controller, Post, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { DataGuardianService } from './data-guardian.service';
import { AnalyzePriceListDto, ApplyPriceListDto } from './dto/price-list-import.dto';
import { requiredFile } from '../common/required-file';

@Controller('data-guardian/price-list')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.DATA_IMPORT)
export class DataGuardianController {
  constructor(private dataGuardianService: DataGuardianService) {}

  // Punkt 17: "Datei auswählen -> Format erkennen -> Daten erkennen ->
  // Zuordnung vorschlagen -> Vorschau". Dieser Endpunkt deckt genau das ab
  // und gibt (wie /analyze) NUR eine Vorschau zurück – nichts wird
  // übernommen. Die zurückgegebenen "rows" können unverändert an /apply
  // geschickt werden, um die Änderungen tatsächlich zu übernehmen.
  @Post('upload')
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } }))
  async upload(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile(requiredFile()) file: Express.Multer.File,
  ) {
    const rows = await this.dataGuardianService.parsePriceListFile(file);
    const diff = await this.dataGuardianService.analyzePriceList(user.companyId, rows);
    // "rows" unverändert an /apply schicken, um die Änderungen zu übernehmen.
    return { rows, diff };
  }

  @Post('analyze')
  analyze(@CurrentUser() user: AuthenticatedUser, @Body() dto: AnalyzePriceListDto) {
    return this.dataGuardianService.analyzePriceList(user.companyId, dto.rows);
  }

  @Post('apply')
  apply(@CurrentUser() user: AuthenticatedUser, @Body() dto: ApplyPriceListDto) {
    return this.dataGuardianService.applyPriceList(
      user.companyId,
      user.userId,
      dto.rows,
      dto.acceptedArticleNumbers,
    );
  }
}
