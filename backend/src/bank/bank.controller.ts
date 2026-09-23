import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
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
import { BankService } from './bank.service';
import { BookBankTransactionDto, ListBankTransactionsDto } from './bank.dto';

// Kontoauszüge sind klein; 5 MB reichen für viele Tausend Umsätze
const upload = FileInterceptor('file', { limits: { fileSize: 5 * 1024 * 1024 } });

// Gleiches Recht wie Rechnungen und Zahlungen
@Controller('bank')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.INVOICE_CREATE)
export class BankController {
  constructor(private bankService: BankService) {}

  // Kontoauszug im Format CAMT.053 (XML) einlesen
  @Post('import')
  @UseInterceptors(upload)
  importStatement(
    @CurrentUser() user: AuthenticatedUser,
    @UploadedFile(requiredFile()) file: Express.Multer.File,
  ) {
    return this.bankService.importStatement(user.companyId, user.userId, file);
  }

  @Get('transactions')
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: ListBankTransactionsDto) {
    return this.bankService.list(user.companyId, query.status);
  }

  @Post('transactions/:id/book')
  book(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: BookBankTransactionDto) {
    return this.bankService.book(user.companyId, user.userId, id, dto);
  }

  @Post('transactions/:id/ignore')
  @HttpCode(200)
  ignore(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bankService.setIgnored(user.companyId, id, true);
  }

  @Post('transactions/:id/reopen')
  @HttpCode(200)
  reopen(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.bankService.setIgnored(user.companyId, id, false);
  }
}
