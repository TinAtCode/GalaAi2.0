import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { withTotalCount } from '../common/pagination';
import { FinanceService } from './finance.service';
import { ListTransactionsDto } from './finance.dto';

// Nur Geschäftsführung und Buchhaltung (Recht finance.read)
@Controller('finance')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.FINANCE_READ)
export class FinanceController {
  constructor(private financeService: FinanceService) {}

  @Get('overview')
  overview(@CurrentUser() user: AuthenticatedUser) {
    return this.financeService.overview(user.companyId);
  }

  @Get('transactions')
  async transactions(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListTransactionsDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return withTotalCount(res, await this.financeService.transactions(user.companyId, query));
  }
}
