import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { CalendarEvent } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSIONS } from '../common/permissions';
import { dayRangeInZone, DEFAULT_TIME_ZONE, isValidDay } from '../common/time-zone';
import { CalendarQueryDto, CreateCalendarEventDto } from './calendar.dto';

interface Caller {
  companyId: string;
  userId: string;
  permissions: string[];
}

// höchstens so viele Tage auf einmal (Monatsansicht mit Rand: 6 Wochen)
const MAX_DAYS = 62;

// Firmen-Termine sehen alle, eintragen dürfen sie Chef und Büro (Recht
// employee.data.read wie bei Abwesenheiten); persönliche Termine sieht und
// ändert nur, wem sie gehören – auch der Chef nicht.
@Injectable()
export class CalendarService {
  constructor(private prisma: PrismaService) {}

  private canWriteCompany(caller: Caller) {
    return caller.permissions.includes(PERMISSIONS.EMPLOYEE_DATA_READ);
  }

  private view(e: CalendarEvent, caller: Caller) {
    return {
      id: e.id,
      scope: e.scope,
      title: e.title,
      startTime: e.startTime,
      endTime: e.endTime,
      allDay: e.allDay,
      notes: e.notes,
      mine: e.ownerUserId === caller.userId,
      editable: e.scope === 'personal' ? e.ownerUserId === caller.userId : this.canWriteCompany(caller),
    };
  }

  async list(caller: Caller, query: CalendarQueryDto) {
    if (!isValidDay(query.from) || !isValidDay(query.to) || query.from > query.to) {
      throw new BadRequestException('Ungültiger Zeitraum.');
    }
    const days = (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000 + 1;
    if (days > MAX_DAYS) throw new BadRequestException(`Höchstens ${MAX_DAYS} Tage auf einmal.`);
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: caller.companyId },
      select: { timeZone: true },
    });
    const tz = company.timeZone || DEFAULT_TIME_ZONE;
    const start = dayRangeInZone(new Date(`${query.from}T12:00:00Z`), tz).start;
    const end = dayRangeInZone(new Date(`${query.to}T12:00:00Z`), tz).end;
    const events = await this.prisma.calendarEvent.findMany({
      where: {
        companyId: caller.companyId,
        OR: [{ scope: 'company' }, { scope: 'personal', ownerUserId: caller.userId }],
        startTime: { lt: end },
        AND: [{ OR: [{ endTime: { gte: start } }, { endTime: null, startTime: { gte: start } }] }],
      },
      orderBy: { startTime: 'asc' },
    });
    return { events: events.map((e) => this.view(e, caller)), canWriteCompany: this.canWriteCompany(caller) };
  }

  private check(dto: Pick<CreateCalendarEventDto, 'startTime' | 'endTime'>) {
    if (dto.endTime && new Date(dto.endTime) < new Date(dto.startTime)) {
      throw new BadRequestException('Das Ende liegt vor dem Beginn.');
    }
  }

  async create(caller: Caller, dto: CreateCalendarEventDto) {
    if (dto.scope === 'company' && !this.canWriteCompany(caller)) {
      throw new ForbiddenException('Firmen-Termine tragen Chef und Büro ein.');
    }
    this.check(dto);
    const event = await this.prisma.calendarEvent.create({
      data: {
        companyId: caller.companyId,
        ownerUserId: caller.userId,
        scope: dto.scope,
        title: dto.title.trim(),
        startTime: new Date(dto.startTime),
        endTime: dto.endTime ? new Date(dto.endTime) : null,
        allDay: dto.allDay ?? false,
        notes: dto.notes?.trim() || null,
      },
    });
    return this.view(event, caller);
  }

  private async editable(caller: Caller, id: string) {
    const event = await this.prisma.calendarEvent.findFirst({ where: { id, companyId: caller.companyId } });
    // fremde persönliche Termine gibt es für andere nicht
    if (!event || (event.scope === 'personal' && event.ownerUserId !== caller.userId)) {
      throw new NotFoundException('Termin nicht gefunden.');
    }
    if (event.scope === 'company' && !this.canWriteCompany(caller)) {
      throw new ForbiddenException('Firmen-Termine ändern Chef und Büro.');
    }
    return event;
  }

  async update(caller: Caller, id: string, dto: CreateCalendarEventDto) {
    const event = await this.editable(caller, id);
    if (dto.scope !== event.scope && dto.scope === 'company' && !this.canWriteCompany(caller)) {
      throw new ForbiddenException('Firmen-Termine tragen Chef und Büro ein.');
    }
    this.check(dto);
    const saved = await this.prisma.calendarEvent.update({
      where: { id: event.id },
      data: {
        scope: dto.scope,
        title: dto.title.trim(),
        startTime: new Date(dto.startTime),
        endTime: dto.endTime ? new Date(dto.endTime) : null,
        allDay: dto.allDay ?? false,
        notes: dto.notes?.trim() || null,
      },
    });
    return this.view(saved, caller);
  }

  async remove(caller: Caller, id: string) {
    const event = await this.editable(caller, id);
    await this.prisma.calendarEvent.delete({ where: { id: event.id } });
    return { deleted: true };
  }
}
