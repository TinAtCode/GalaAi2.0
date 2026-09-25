import { Body, Controller, Get, Param, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { parseDayParam } from '../common/time-zone';
import { TimeEntriesService } from './time-entries.service';
import {
  ApproveTimeEntriesDto,
  CorrectTimeEntryDto,
  StartTimeEntryDto,
  StopTimeEntryDto,
} from './dto/time-entry.dto';
import { Response } from 'express';
import { PageQueryDto, withTotalCount } from '../common/pagination';

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
  async findMine(
    @CurrentUser() user: AuthenticatedUser,
    @Query() page: PageQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return withTotalCount(res, await this.timeEntriesService.findMine(user.companyId, user.userId, page));
  }

  // Eigene Überstunden für einen Tag (Standard: heute) – Selbstbedienung,
  // keine zusätzliche Permission nötig.
  @Get('overtime/mine')
  myOvertime(@CurrentUser() user: AuthenticatedUser, @Query('date') date?: string) {
    return this.timeEntriesService.getMyDailyOvertime(user.companyId, user.userId, parseDayParam(date));
  }

  @Get('by-employee/:employeeId')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_DATA_READ)
  async findAllForEmployee(
    @CurrentUser() user: AuthenticatedUser,
    @Param('employeeId') employeeId: string,
    @Query() page: PageQueryDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    return withTotalCount(
      res,
      await this.timeEntriesService.findAllForEmployee(user.companyId, employeeId, page),
    );
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

  // Sammelfreigabe: nur abgeschlossene Einträge, der Rest wird übersprungen
  @Post('approve')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_DATA_READ)
  approveMany(@CurrentUser() user: AuthenticatedUser, @Body() dto: ApproveTimeEntriesDto) {
    return this.timeEntriesService.approveMany(user.companyId, user.userId, dto.ids);
  }

  @Post(':id/approve')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_DATA_READ)
  approve(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string) {
    return this.timeEntriesService.approve(user.companyId, user.userId, id);
  }

  // Korrektur durch Vorgesetzte (dieselbe Berechtigung wie die Freigabe).
  @Patch(':id')
  @RequirePermissions(PERMISSIONS.EMPLOYEE_DATA_READ)
  correct(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: CorrectTimeEntryDto) {
    return this.timeEntriesService.correct(user.companyId, user.userId, id, dto);
  }
}
