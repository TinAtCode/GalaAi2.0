import { Body, Controller, Delete, Get, Param, Put, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { UnitsService } from './units.service';
import { UpsertUnitDto } from './units.dto';

// Lesen darf jeder Angemeldete (für Angebotsformular und Stammdaten),
// ändern nur mit Stammdaten-Recht
@Controller('units')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class UnitsController {
  constructor(private unitsService: UnitsService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser) {
    return this.unitsService.list(user.companyId);
  }

  @Put(':code')
  @RequirePermissions(PERMISSIONS.MASTERDATA_WRITE)
  upsert(@CurrentUser() user: AuthenticatedUser, @Param('code') code: string, @Body() dto: UpsertUnitDto) {
    return this.unitsService.upsert(user.companyId, code, dto);
  }

  @Delete(':code')
  @RequirePermissions(PERMISSIONS.MASTERDATA_WRITE)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('code') code: string) {
    return this.unitsService.remove(user.companyId, code);
  }
}
