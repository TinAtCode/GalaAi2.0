import { Body, Controller, Get, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { PermissionsGuard } from '../common/permissions.guard';
import { RequirePermissions } from '../common/permissions.decorator';
import { PERMISSIONS } from '../common/permissions';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { parseDayParam } from '../common/time-zone';
import { AppointmentsService } from './appointments.service';
import {
  BoardQueryDto,
  CreateAppointmentDto,
  UpdateAppointmentDto,
  UpdateAppointmentStatusDto,
} from './dto/appointment.dto';

// Reduziert einen Termin auf genau das, was Punkt 24 für die
// Mitarbeiter-Ansicht "Mein Tag" fordert: Baustelle, Kunde, Adresse,
// Aufgabe, Uhrzeit – keine ERP-Details.
function toMyDayItem(appointment: any) {
  const property = appointment.project.property;
  return {
    id: appointment.id,
    time: appointment.startTime,
    task: appointment.title,
    site: appointment.project.title,
    customer: property.customer.name,
    address: [property.street, property.city].filter(Boolean).join(', '),
    status: appointment.status,
    notes: appointment.notes,
  };
}

@Controller('appointments')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class AppointmentsController {
  constructor(private appointmentsService: AppointmentsService) {}

  // Keine zusätzliche Permission: jeder eingeloggte User darf seinen
  // eigenen Tag sehen.
  @Get('my-day')
  async myDay(@CurrentUser() user: AuthenticatedUser, @Query('date') date?: string) {
    const targetDate = parseDayParam(date);
    const appointments = await this.appointmentsService.findMyDay(user.companyId, user.userId, targetDate);
    return appointments.map(toMyDayItem);
  }

  @Get('assignees')
  @RequirePermissions(PERMISSIONS.CUSTOMER_WRITE)
  assignees(@CurrentUser() user: AuthenticatedUser) {
    return this.appointmentsService.assignees(user.companyId);
  }

  // Plantafel: Termine aller Mitarbeiter in einem Zeitraum
  @Get('board')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  board(@CurrentUser() user: AuthenticatedUser, @Query() query: BoardQueryDto) {
    return this.appointmentsService.board(user.companyId, query, user.permissions);
  }

  @Get('by-project/:projectId')
  @RequirePermissions(PERMISSIONS.CUSTOMER_READ)
  findAllForProject(@CurrentUser() user: AuthenticatedUser, @Param('projectId') projectId: string) {
    return this.appointmentsService.findAllForProject(user.companyId, projectId);
  }

  @Post()
  @RequirePermissions(PERMISSIONS.CUSTOMER_WRITE)
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateAppointmentDto) {
    return this.appointmentsService.create(user.companyId, dto);
  }

  @Patch(':id')
  @RequirePermissions(PERMISSIONS.CUSTOMER_WRITE)
  update(@CurrentUser() user: AuthenticatedUser, @Param('id') id: string, @Body() dto: UpdateAppointmentDto) {
    return this.appointmentsService.update(user.companyId, id, dto);
  }

  @Patch(':id/status')
  @RequirePermissions(PERMISSIONS.CUSTOMER_WRITE)
  updateStatus(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateAppointmentStatusDto,
  ) {
    return this.appointmentsService.updateStatus(user.companyId, id, dto);
  }
}
