import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { OverviewService } from './overview.service';

// Übersicht für „Mein Tag“ und die Schnellsuche. Jeder Eintrag prüft das
// passende Recht selbst – ohne Recht fehlt er einfach.
@Controller('overview')
@UseGuards(JwtAuthGuard)
export class OverviewController {
  constructor(private overview: OverviewService) {}

  @Get('todos')
  todos(@CurrentUser() user: AuthenticatedUser) {
    return this.overview.todos(user.companyId, user.permissions);
  }

  @Get('search')
  search(@CurrentUser() user: AuthenticatedUser, @Query('q') q = '') {
    return this.overview.searchNumbers(user.companyId, user.permissions, String(q).slice(0, 50));
  }
}
