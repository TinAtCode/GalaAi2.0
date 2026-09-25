import { Controller, Get, Query, StreamableFile, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { DatevService } from './datev.service';

@Controller('datev')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.DATA_EXPORT)
export class DatevController {
  constructor(private datevService: DatevService) {}

  // GET /datev/bookings?from=2026-09-01&to=2026-09-30
  @Get('bookings')
  // &payments=1: Zahlungseingänge mitexportieren
  async bookings(
    @CurrentUser() user: AuthenticatedUser,
    @Query('from') from = '',
    @Query('to') to = '',
    @Query('payments') payments = '',
  ) {
    const { buffer, fileName } = await this.datevService.exportBookings(
      user.companyId,
      user.userId,
      from,
      to,
      payments === '1' || payments === 'true',
    );
    return new StreamableFile(buffer, {
      type: 'text/csv; charset=windows-1252',
      disposition: `attachment; filename="${fileName}"`,
    });
  }

  // GET /datev/debtors[?invoiced=1]: Debitoren-Stammdaten (Name, Anschrift)
  @Get('debtors')
  async debtors(@CurrentUser() user: AuthenticatedUser, @Query('invoiced') invoiced = '') {
    const { buffer, fileName } = await this.datevService.exportDebtors(
      user.companyId,
      user.userId,
      invoiced === '1' || invoiced === 'true',
    );
    return new StreamableFile(buffer, {
      type: 'text/csv; charset=windows-1252',
      disposition: `attachment; filename="${fileName}"`,
    });
  }
}
