import { Controller, Get, Query, Res, UseGuards } from '@nestjs/common';
import { Response } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { withTotalCount } from '../common/pagination';
import { AuditLogService } from './audit-log.service';
import { AuditLogQueryDto } from './audit-log.dto';

// Das Protokoll enthält auch Einkaufspreise und Rechteänderungen – daher ein
// eigenes Recht, standardmäßig nur für Administratoren.
@Controller('audit-log')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.AUDIT_READ)
export class AuditLogController {
  constructor(private auditLogService: AuditLogService) {}

  @Get()
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: AuditLogQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return withTotalCount(res, await this.auditLogService.findAll(user.companyId, query));
  }
}
