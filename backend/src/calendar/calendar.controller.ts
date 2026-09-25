import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { AuthenticatedUser } from '../common/authenticated-request';
import { CurrentUser } from '../common/current-user.decorator';
import { PermissionsGuard } from '../common/permissions.guard';
import { CalendarQueryDto, CreateCalendarEventDto } from './calendar.dto';
import { CalendarService } from './calendar.service';

// Kalender: jeder angemeldete Nutzer (persönliche Termine, Firmen-Termine
// lesen); Firmen-Termine eintragen prüft der Service
@Controller('calendar/events')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CalendarController {
  constructor(private calendar: CalendarService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: CalendarQueryDto) {
    return this.calendar.list(user, query);
  }

  @Post()
  create(@CurrentUser() user: AuthenticatedUser, @Body() dto: CreateCalendarEventDto) {
    return this.calendar.create(user, dto);
  }

  @Put(':id')
  update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateCalendarEventDto,
  ) {
    return this.calendar.update(user, id, dto);
  }

  @Delete(':id')
  remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.calendar.remove(user, id);
  }
}
