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
  async bookings(@CurrentUser() user: AuthenticatedUser, @Query('from') from = '', @Query('to') to = '') {
    const { buffer, fileName } = await this.datevService.exportBookings(
      user.companyId,
      user.userId,
      from,
      to,
    );
    return new StreamableFile(buffer, {
      type: 'text/csv; charset=windows-1252',
      disposition: `attachment; filename="${fileName}"`,
    });
  }
}
