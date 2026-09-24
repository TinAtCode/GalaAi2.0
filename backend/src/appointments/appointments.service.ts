import { BadRequestException, Injectable, NotFoundException, Optional } from '@nestjs/common';
import { PushService } from '../push/push.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  BoardQueryDto,
  CreateAppointmentDto,
  UpdateAppointmentDto,
  UpdateAppointmentStatusDto,
} from './dto/appointment.dto';
import {
  addCalendarDays,
  dayRangeInZone,
  formatTimeInZone,
  isValidDay,
  localDayString,
} from '../common/time-zone';
import { absenceMessage, absenceOn, publicAbsence } from '../absences/absences.service';
import { lockFor } from '../common/advisory-lock';
import { Prisma } from '@prisma/client';

const DEFAULT_DURATION_MS = 60 * 60 * 1000; // 1h Annahme, wenn kein endTime gesetzt ist

@Injectable()
export class AppointmentsService {
  constructor(
    private prisma: PrismaService,
    @Optional() private push?: PushService,
  ) {}

  // Push an den Mitarbeiter: nur für Termine der nächsten 14 Tage (keine Flut
  // bei Planungen weit voraus, nichts für Vergangenes)
  private async announce(
    companyId: string,
    appointment: { id: string; title: string; startTime: Date; assignedUserId: string | null },
    changed: boolean,
  ) {
    if (!this.push || !appointment.assignedUserId) return;
    const now = Date.now();
    const start = appointment.startTime.getTime();
    if (start < now || start > now + 14 * 86_400_000) return;
    const timeZone = await this.getTimeZone(companyId);
    const when = appointment.startTime.toLocaleString('de-DE', {
      weekday: 'short',
      day: 'numeric',
      month: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZone,
    });
    this.push.notifyLater(companyId, [appointment.assignedUserId], {
      title: changed ? 'Termin geändert' : 'Neuer Termin',
      body: `${when} Uhr: ${appointment.title}`,
      url: '/baustelle',
      tag: `appointment-${appointment.id}`,
    });
  }

  private async assertProjectBelongsToCompany(companyId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
    });
    if (!project) {
      throw new NotFoundException('Projekt nicht gefunden.');
    }
  }

  private async assertAppointmentBelongsToCompany(companyId: string, id: string) {
    const appointment = await this.prisma.appointment.findFirst({
      where: { id, companyId },
    });
    if (!appointment) {
      throw new NotFoundException('Termin nicht gefunden.');
    }
    return appointment;
  }

  private effectiveEnd(appointment: { startTime: Date; endTime: Date | null }): Date {
    return appointment.endTime ?? new Date(appointment.startTime.getTime() + DEFAULT_DURATION_MS);
  }

  private async getTimeZone(companyId: string): Promise<string> {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { timeZone: true },
    });
    return company.timeZone;
  }

  // Verhindert, dass derselbe Mitarbeiter zwei sich überschneidende Termine
  // bekommt. Ohne endTime wird eine Standarddauer von 1h angenommen (siehe
  // DEFAULT_DURATION_MS) – bewusste Vereinfachung, siehe STATUS.md.
  // Prüft nur denselben Kalendertag in der Zeitzone der Firma
  // (Terminüberschneidungen über Mitternacht hinweg sind für dieses
  // Geschäftsfeld praktisch irrelevant).
  // Läuft innerhalb einer Transaktion: ALLE Abfragen über `db` (die
  // Transaktion), nie über this.prisma – sonst braucht jede Anfrage eine
  // zweite Verbindung, und bei vielen gleichzeitigen Buchungen warten alle
  // Transaktionen auf freie Verbindungen, die keine bekommt (Deadlock).
  private async assertNoCollision(
    db: Prisma.TransactionClient,
    companyId: string,
    timeZone: string,
    assignedUserId: string,
    newStart: Date,
    newEnd: Date,
    excludeAppointmentId?: string,
  ) {
    const { start: dayStart, end: dayEnd } = dayRangeInZone(newStart, timeZone);
    const absent = await absenceOn(db, companyId, assignedUserId, localDayString(newStart, timeZone));
    if (absent) throw new BadRequestException(absenceMessage(absent));

    const candidates = await db.appointment.findMany({
      where: {
        companyId,
        assignedUserId,
        status: { not: 'cancelled' },
        startTime: { gte: dayStart, lt: dayEnd },
        ...(excludeAppointmentId ? { id: { not: excludeAppointmentId } } : {}),
      },
    });

    const collision = candidates.find((existing: any) => {
      const existingEnd = this.effectiveEnd(existing);
      return newStart < existingEnd && existing.startTime < newEnd;
    });

    if (collision) {
      const from = formatTimeInZone(collision.startTime, timeZone);
      const to = formatTimeInZone(this.effectiveEnd(collision), timeZone);
      throw new BadRequestException(
        `Terminüberschneidung: Mitarbeiter ist an diesem Tag bereits von ${from} bis ${to} Uhr verplant ("${collision.title}").`,
      );
    }
  }

  findAllForProject(companyId: string, projectId: string) {
    return this.prisma.appointment.findMany({
      where: { projectId, companyId },
      orderBy: { startTime: 'asc' },
    });
  }

  // Wem Termine zugeteilt werden können: aktive Nutzer der Firma (nur Namen)
  assignees(companyId: string) {
    return this.prisma.user.findMany({
      where: { companyId, active: true },
      select: { id: true, firstName: true, lastName: true },
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
    });
  }

  async create(companyId: string, dto: CreateAppointmentDto) {
    await this.assertProjectBelongsToCompany(companyId, dto.projectId);

    const startTime = new Date(dto.startTime);
    const endTime = dto.endTime ? new Date(dto.endTime) : null;
    if (endTime && endTime <= startTime) {
      throw new BadRequestException('Das Ende eines Termins muss nach dem Beginn liegen.');
    }

    const data = {
      companyId,
      projectId: dto.projectId,
      title: dto.title,
      startTime,
      endTime,
      assignedUserId: dto.assignedUserId,
      notes: dto.notes,
    };

    if (!dto.assignedUserId) {
      return this.prisma.appointment.create({ data });
    }
    const assignedUserId = dto.assignedUserId;

    // Mandantenprüfung: der zugewiesene Mitarbeiter muss zur selben Firma
    // gehören wie das Projekt.
    const user = await this.prisma.user.findFirst({ where: { id: assignedUserId, companyId } });
    if (!user) {
      throw new NotFoundException('Zugewiesener Benutzer nicht gefunden.');
    }

    // Kollisionsprüfung und Anlegen unter einer Sperre pro Mitarbeiter –
    // sonst könnten zwei gleichzeitige Buchungen beide die Prüfung bestehen.
    const timeZone = await this.getTimeZone(companyId);
    return this.prisma
      .$transaction(async (tx) => {
        await lockFor(tx, 'appointment', assignedUserId);
        const effectiveEnd = endTime ?? new Date(startTime.getTime() + DEFAULT_DURATION_MS);
        await this.assertNoCollision(tx, companyId, timeZone, assignedUserId, startTime, effectiveEnd);
        return tx.appointment.create({ data });
      })
      .then(async (created) => {
        await this.announce(companyId, created, false);
        return created;
      });
  }

  // Plantafel: alle nicht abgesagten Termine im Zeitraum, mit Baustelle und Kunde
  async board(companyId: string, query: BoardQueryDto, permissions: string[] = []) {
    if (!isValidDay(query.from)) throw new BadRequestException('Ungültiges Datum.');
    const timeZone = await this.getTimeZone(companyId);
    const days = query.days ?? 7;
    const noon = (day: string) => new Date(`${day}T12:00:00Z`);
    const start = dayRangeInZone(noon(query.from), timeZone).start;
    const end = dayRangeInZone(noon(addCalendarDays(query.from, days - 1)), timeZone).end;
    const [appointments, assignees] = await Promise.all([
      this.prisma.appointment.findMany({
        where: { companyId, status: { not: 'cancelled' }, startTime: { gte: start, lt: end } },
        select: {
          id: true,
          title: true,
          startTime: true,
          endTime: true,
          status: true,
          assignedUserId: true,
          contractTaskId: true,
          project: {
            select: {
              id: true,
              title: true,
              property: { select: { city: true, customer: { select: { name: true } } } },
            },
          },
        },
        orderBy: { startTime: 'asc' },
      }),
      this.assignees(companyId),
    ]);
    const lastDay = addCalendarDays(query.from, days - 1);
    const absences = await this.prisma.absence.findMany({
      where: {
        companyId,
        startDate: { lte: new Date(`${lastDay}T00:00:00Z`) },
        endDate: { gte: new Date(`${query.from}T00:00:00Z`) },
      },
      orderBy: { startDate: 'asc' },
    });
    return {
      from: query.from,
      days,
      timeZone,
      assignees,
      appointments,
      absences: absences.map((a) => publicAbsence(a, permissions)),
    };
  }

  // Verschieben und neu zuteilen – mit derselben Kollisionsprüfung wie beim Anlegen
  async update(companyId: string, id: string, dto: UpdateAppointmentDto) {
    const existing = await this.assertAppointmentBelongsToCompany(companyId, id);
    if (existing.status === 'cancelled') {
      throw new BadRequestException('Abgesagte Termine lassen sich nicht verschieben.');
    }
    const startTime = dto.startTime ? new Date(dto.startTime) : existing.startTime;
    let endTime: Date | null;
    if (dto.endTime !== undefined) endTime = dto.endTime ? new Date(dto.endTime) : null;
    else
      endTime = existing.endTime
        ? new Date(existing.endTime.getTime() + (startTime.getTime() - existing.startTime.getTime()))
        : null;
    if (endTime && endTime <= startTime) {
      throw new BadRequestException('Das Ende eines Termins muss nach dem Beginn liegen.');
    }
    const assignedUserId = dto.assignedUserId === undefined ? existing.assignedUserId : dto.assignedUserId;
    if (assignedUserId && assignedUserId !== existing.assignedUserId) {
      const user = await this.prisma.user.findFirst({
        where: { id: assignedUserId, companyId, active: true },
      });
      if (!user) throw new NotFoundException('Zugewiesener Benutzer nicht gefunden.');
    }
    const data = { title: dto.title ?? existing.title, startTime, endTime, assignedUserId };
    if (!assignedUserId) return this.prisma.appointment.update({ where: { id }, data });
    const timeZone = await this.getTimeZone(companyId);
    return this.prisma
      .$transaction(async (tx) => {
        await lockFor(tx, 'appointment', assignedUserId);
        const effectiveEnd = endTime ?? new Date(startTime.getTime() + DEFAULT_DURATION_MS);
        await this.assertNoCollision(tx, companyId, timeZone, assignedUserId, startTime, effectiveEnd, id);
        return tx.appointment.update({ where: { id }, data });
      })
      .then(async (updated) => {
        // neu zugeteilt oder verschoben: Bescheid geben
        const reassigned = updated.assignedUserId !== existing.assignedUserId;
        const moved = updated.startTime.getTime() !== existing.startTime.getTime();
        if (reassigned || moved) await this.announce(companyId, updated, !reassigned);
        return updated;
      });
  }

  async updateStatus(companyId: string, id: string, dto: UpdateAppointmentStatusDto) {
    await this.assertAppointmentBelongsToCompany(companyId, id);
    return this.prisma.appointment.update({ where: { id }, data: { status: dto.status } });
  }

  // "Mein Tag" (Punkt 23/24): einfache, radikal reduzierte Sicht für den
  // Ein-Personen-Betrieb bzw. den einzelnen Mitarbeiter – nur die eigenen
  // Termine des Tages, chronologisch, mit Baustelle/Kunde/Adresse.
  async findMyDay(companyId: string, userId: string, date: Date) {
    const { start: dayStart, end: dayEnd } = dayRangeInZone(date, await this.getTimeZone(companyId));

    return this.prisma.appointment.findMany({
      where: {
        assignedUserId: userId,
        startTime: { gte: dayStart, lt: dayEnd },
        companyId,
      },
      include: {
        project: {
          include: {
            property: {
              include: { customer: true },
            },
          },
        },
      },
      orderBy: { startTime: 'asc' },
    });
  }
}
