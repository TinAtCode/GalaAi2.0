import { Controller, Get, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';

// Permissions sind global (nicht pro Firma), daher reicht ein einfacher
// findMany ohne companyId-Filter.
@Controller('permissions')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PERMISSIONS.SYSTEM_SETTINGS_WRITE)
export class PermissionsController {
  constructor(private prisma: PrismaService) {}

  @Get()
  findAll() {
    return this.prisma.permission.findMany({ orderBy: { key: 'asc' } });
  }
}
