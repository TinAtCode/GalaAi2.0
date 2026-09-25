import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, SiteDiaryEntry } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { changedFields, writeAudit } from '../common/audit';
import {
  addCalendarDays,
  dayRangeInZone,
  DEFAULT_TIME_ZONE,
  isValidDay,
  localDayString,
} from '../common/time-zone';
import { DiaryEntryDto, DiaryQueryDto } from './site-diary.dto';

interface Caller {
  companyId: string;
  userId: string;
}

const FIELDS = [
  'weather',
  'temperature',
  'crew',
  'crewCount',
  'work',
  'delayHours',
  'delayReason',
  'delayNote',
  'notes',
] as const;

const trimmed = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;
const asDay = (day: string) => new Date(`${day}T00:00:00Z`);

// Bautagebuch je Projekt: ein Eintrag je Tag, von der Baustelle oder aus dem
// Büro. Einträge in der Zukunft gibt es nicht; jede Änderung steht mit altem
// und neuem Wert im Audit-Log (Nachweis gegenüber Kunde oder Gericht).
@Injectable()
export class SiteDiaryService {
  constructor(private prisma: PrismaService) {}

  private async context(companyId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
      select: { id: true, title: true, company: { select: { timeZone: true } } },
    });
    if (!project) throw new NotFoundException('Projekt nicht gefunden.');
    return { project, tz: project.company.timeZone || DEFAULT_TIME_ZONE };
  }

  private view(e: SiteDiaryEntry & { createdBy?: unknown }) {
    return { ...e, day: e.day.toISOString().slice(0, 10), delayHours: e.delayHours?.toNumber() ?? null };
  }

  async list(companyId: string, projectId: string, query: DiaryQueryDto) {
    const { project, tz } = await this.context(companyId, projectId);
    const to = query.to ?? localDayString(new Date(), tz);
    const from = query.from ?? addCalendarDays(to, -60);
    if (!isValidDay(from) || !isValidDay(to) || from > to)
      throw new BadRequestException('Ungültiger Zeitraum.');
    const entries = await this.prisma.siteDiaryEntry.findMany({
      where: { companyId, projectId, day: { gte: asDay(from), lte: asDay(to) } },
      orderBy: { day: 'desc' },
    });
    // Fotos der Baustelle je Tag (aus den Nachrichten)
    const photos = await this.prisma.projectMessage.findMany({
      where: {
        companyId,
        projectId,
        documentId: { not: null },
        createdAt: {
          gte: dayRangeInZone(new Date(`${from}T12:00:00Z`), tz).start,
          lt: dayRangeInZone(new Date(`${to}T12:00:00Z`), tz).end,
        },
      },
      select: { documentId: true, createdAt: true },
      orderBy: { createdAt: 'asc' },
    });
    const photosByDay: Record<string, string[]> = {};
    for (const p of photos) (photosByDay[localDayString(p.createdAt, tz)] ??= []).push(p.documentId!);

    // Verzögerungen im ganzen Projekt, je Ursache
    const delays = await this.prisma.siteDiaryEntry.groupBy({
      by: ['delayReason'],
      where: { companyId, projectId, delayHours: { gt: 0 } },
      _sum: { delayHours: true },
      _count: true,
    });
    return {
      project: { id: project.id, title: project.title },
      from,
      to,
      entries: entries.map((e) => ({
        ...this.view(e),
        photos: photosByDay[e.day.toISOString().slice(0, 10)] ?? [],
      })),
      photosByDay,
      delays: {
        hours: delays.reduce((sum, d) => sum + (d._sum.delayHours?.toNumber() ?? 0), 0),
        days: delays.reduce((sum, d) => sum + d._count, 0),
        byReason: delays.map((d) => ({
          reason: d.delayReason ?? 'other',
          hours: d._sum.delayHours?.toNumber() ?? 0,
          days: d._count,
        })),
      },
    };
  }

  async save(caller: Caller, projectId: string, day: string, dto: DiaryEntryDto) {
    const { companyId, userId } = caller;
    const { tz } = await this.context(companyId, projectId);
    if (!isValidDay(day)) throw new BadRequestException('Ungültiges Datum.');
    if (day > localDayString(new Date(), tz)) {
      throw new BadRequestException('Das Bautagebuch wird für heute oder vergangene Tage geführt.');
    }
    const data = {
      weather: dto.weather,
      temperature: dto.temperature,
      crew: trimmed(dto.crew),
      crewCount: dto.crewCount,
      work: trimmed(dto.work),
      delayHours: dto.delayHours,
      delayReason: dto.delayReason,
      delayNote: trimmed(dto.delayNote),
      notes: trimmed(dto.notes),
    };
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.siteDiaryEntry.findFirst({ where: { companyId, projectId, day: asDay(day) } });
      const hours =
        data.delayHours !== undefined ? data.delayHours : (before?.delayHours?.toNumber() ?? null);
      const reason = data.delayReason !== undefined ? data.delayReason : (before?.delayReason ?? null);
      if (hours && !reason) throw new BadRequestException('Bitte die Ursache der Verzögerung angeben.');

      const saved = before
        ? await tx.siteDiaryEntry.update({
            where: { id: before.id },
            data: { ...data, updatedByUserId: userId },
          })
        : await tx.siteDiaryEntry.create({
            data: {
              ...data,
              companyId,
              projectId,
              day: asDay(day),
              createdByUserId: userId,
              updatedByUserId: userId,
            },
          });
      const patch = Object.fromEntries(FIELDS.map((f) => [f, data[f]]));
      const { oldData, newData, hasChanges } = changedFields(
        (before ?? {}) as Record<string, unknown>,
        patch as Record<string, unknown>,
      );
      if (hasChanges || !before) {
        await writeAudit(tx, {
          companyId,
          userId,
          action: before ? 'site_diary_changed' : 'site_diary_created',
          entity: 'SiteDiaryEntry',
          entityId: saved.id,
          oldData: { day, ...oldData } as Prisma.InputJsonValue,
          newData: { day, ...newData } as Prisma.InputJsonValue,
        });
      }
      return this.view(saved);
    });
  }
}
