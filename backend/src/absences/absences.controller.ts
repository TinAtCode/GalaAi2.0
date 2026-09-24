import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../common/authenticated-request';
import { CurrentUser } from '../common/current-user.decorator';
import { PERMISSIONS } from '../common/permissions';
import { RequirePermissions } from '../common/permissions.decorator';
import { PermissionsGuard } from '../common/permissions.guard';
import { AbsenceQueryDto, CreateAbsenceDto } from './absence.dto';
import { AbsencesService } from './absences.service';

// Sehen: wer die Plantafel sieht (Art nur mit Recht für Mitarbeiterdaten);
// eintragen und löschen: wer Mitarbeiterdaten sehen darf (Chef, Büro).
@Controller('absences')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AbsencesController {
  constructor(private absences: AbsencesService) {}

  @Get()
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: AbsenceQueryDto) {
    return this.absences.list(user.companyId, user.permissions, query);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.EMPLOYEE_DATA_READ)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAbsenceDto) {
    return this.absences.create(user, dto);
  }

  @Delete(':id')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_DATA_READ)
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.absences.remove(user, id);
  }
}
