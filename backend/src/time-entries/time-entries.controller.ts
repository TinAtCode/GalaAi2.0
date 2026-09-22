import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { parseDayParam } from '../common/time-zone';
import { TimeEntriesService } from './time-entries.service';
import { StartTimeEntryDto, StopTimeEntryDto } from './dto/time-entry.dto';

@Controller('time-entries')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class TimeEntriesController {
  constructor(private timeEntriesService: TimeEntriesService) {}

  // Start/Stopp/eigene Liste brauchen keine zusätzliche Permission – jeder
  // darf SEINE EIGENE Zeit erfassen (siehe Kommentar in TimeEntriesService).
  @Post('start')
  start(@CurrentUser() user: AuthenticatedUser, @Body() dto: StartTimeEntryDto) {
    return this.timeEntriesService.start(user.companyId, user.userId, dto);
  }

  @Post('stop')
  stop(@CurrentUser() user: AuthenticatedUser, @Body() dto: StopTimeEntryDto) {
    return this.timeEntriesService.stop(user.companyId, user.userId, dto);
  }

  @Get('mine')
  findMine(@CurrentUser() user: AuthenticatedUser) {
    return this.timeEntriesService.findMine(user.companyId, user.userId);
  }

  // Eigene Überstunden für einen Tag (Standard: heute) – Selbstbedienung,
  // keine zusätzliche Permission nötig.
  @Get('overtime/mine')
  myOvertime(@CurrentUser() user: AuthenticatedUser, @Query('date') date?: string) {
    return this.timeEntriesService.getMyDailyOvertime(user.companyId, user.userId, parseDayParam(date));
  }

  @Get('by-employee/:employeeId')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_DATA_READ)
  findAllForEmployee(@CurrentUser() user: AuthenticatedUser, @Param('employeeId') employeeId: string) {
    return this.timeEntriesService.findAllForEmployee(user.companyId, employeeId);
  }

  // Überstunden eines beliebigen Mitarbeiters (Vorgesetzte/Büro).
  @Get('overtime/:employeeId')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_DATA_READ)
  overtimeForEmployee(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @Query('date') date?: string,
  ) {
    return this.timeEntriesService.getDailyOvertime(user.companyId, employeeId, parseDayParam(date));
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_DATA_READ)
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.timeEntriesService.approve(user.companyId, id);
  }
}
