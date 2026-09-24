import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Absence, Prisma } from '@prisma/client';
import { writeAudit } from '../common/audit';
import { calendarDaysBetween, dayRangeInZone, isValidDay, localDayString } from '../common/time-zone';
import { PERMISSIONS } from '../common/permissions';
import { PrismaService } from '../prisma/prisma.service';
import { lockFor } from '../common/advisory-lock';
import { AbsenceQueryDto, CreateAbsenceDto } from './absence.dto';

const dayOf = (date: Date) => date.toISOString().slice(0, 10);
const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);
const german = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}.${day.slice(0, 4)}`;

// Was nach außen geht: die Art (und Notiz) nur mit dem Recht für
// Mitarbeiterdaten – „krank“ ist ein Gesundheitsdatum. Sonst nur „abwesend“.
export function publicAbsence(absence: Absence, permissions: string[]) {
  const full = permissions.includes(PERMISSIONS.EMPLOYEE_DATA_READ);
  return {
    id: absence.id,
    userId: absence.userId,
    startDate: dayOf(absence.startDate),
    endDate: dayOf(absence.endDate),
    kind: full ? absence.kind : ('absent' as const),
    note: full ? absence.note : null,
  };
}

// Ist der Nutzer an diesem Kalendertag abwesend? (für die Terminplanung)
export async function absenceOn(
  db: Prisma.TransactionClient,
  companyId: string,
  userId: string,
  day: string,
) {
  return db.absence.findFirst({
    where: { companyId, userId, startDate: { lte: dateOf(day) }, endDate: { gte: dateOf(day) } },
  });
}

export function absenceMessage(absence: Absence) {
  const end = dayOf(absence.endDate);
  return `Mitarbeiter ist an diesem Tag abwesend (bis ${german(end)}).`;
}

@Injectable()
export class AbsencesService {
  constructor(private prisma: PrismaService) {}

  async list(companyId: string, permissions: string[], query: AbsenceQueryDto) {
    if (!isValidDay(query.from) || !isValidDay(query.to) || query.to < query.from) {
      throw new BadRequestException('Ungültiger Zeitraum.');
    }
    const absences = await this.prisma.absence.findMany({
      where: { companyId, startDate: { lte: dateOf(query.to) }, endDate: { gte: dateOf(query.from) } },
      orderBy: [{ startDate: 'asc' }, { userId: 'asc' }],
    });
    return absences.map((a) => publicAbsence(a, permissions));
  }

  // Anlegen; überschneidet sich nicht mit einer anderen Abwesenheit derselben
  // Person. Zurück kommen auch die schon geplanten Termine in dem Zeitraum –
  // die muss das Büro neu verteilen (sie bleiben bewusst stehen).
  async create(caller: { companyId: string; userId: string; permissions: string[] }, dto: CreateAbsenceDto) {
    const { companyId } = caller;
    if (!isValidDay(dto.startDate) || !isValidDay(dto.endDate))
      throw new BadRequestException('Ungültiges Datum.');
    if (dto.endDate < dto.startDate) throw new BadRequestException('Das Ende liegt vor dem Beginn.');
    if (calendarDaysBetween(dto.startDate, dto.endDate) > 365) {
      throw new BadRequestException('Höchstens ein Jahr am Stück.');
    }
    const user = await this.prisma.user.findFirst({ where: { id: dto.userId, companyId } });
    if (!user) throw new NotFoundException('Mitarbeiter nicht gefunden.');
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });

    return this.prisma.$transaction(async (tx) => {
      // dieselbe Sperre wie beim Zuteilen von Terminen: kein Termin rutscht dazwischen
      await lockFor(tx, 'appointment', dto.userId);
      const overlap = await tx.absence.findFirst({
        where: {
          companyId,
          userId: dto.userId,
          startDate: { lte: dateOf(dto.endDate) },
          endDate: { gte: dateOf(dto.startDate) },
        },
      });
      if (overlap) {
        throw new BadRequestException(
          `Überschneidet sich mit einer Abwesenheit vom ${german(dayOf(overlap.startDate))} bis ${german(dayOf(overlap.endDate))}.`,
        );
      }
      const absence = await tx.absence.create({
        data: {
          companyId,
          userId: dto.userId,
          kind: dto.kind,
          startDate: dateOf(dto.startDate),
          endDate: dateOf(dto.endDate),
          note: dto.note?.trim() || null,
          createdByUserId: caller.userId,
        },
      });
      await writeAudit(tx, {
        companyId,
        userId: caller.userId,
        action: 'absence_created',
        entity: 'Absence',
        entityId: absence.id,
        newData: { userId: dto.userId, kind: dto.kind, startDate: dto.startDate, endDate: dto.endDate },
      });
      const from = dayRangeInZone(new Date(`${dto.startDate}T12:00:00Z`), company.timeZone).start;
      const to = dayRangeInZone(new Date(`${dto.endDate}T12:00:00Z`), company.timeZone).end;
      const conflicts = await tx.appointment.findMany({
        where: { companyId, assignedUserId: dto.userId, status: 'planned', startTime: { gte: from, lt: to } },
        select: { id: true, title: true, startTime: true, projectId: true },
        orderBy: { startTime: 'asc' },
      });
      return {
        absence: publicAbsence(absence, caller.permissions),
        conflicts: conflicts.map((c) => ({ ...c, day: localDayString(c.startTime, company.timeZone) })),
      };
    });
  }

  async remove(caller: { companyId: string; userId: string }, id: string) {
    const absence = await this.prisma.absence.findFirst({ where: { id, companyId: caller.companyId } });
    if (!absence) throw new NotFoundException('Abwesenheit nicht gefunden.');
    await this.prisma.$transaction(async (tx) => {
      await tx.absence.deleteMany({ where: { id, companyId: caller.companyId } });
      await writeAudit(tx, {
        companyId: caller.companyId,
        userId: caller.userId,
        action: 'absence_deleted',
        entity: 'Absence',
        entityId: id,
        oldData: {
          userId: absence.userId,
          kind: absence.kind,
          startDate: dayOf(absence.startDate),
          endDate: dayOf(absence.endDate),
        },
      });
    });
    return { deleted: true };
  }
}
