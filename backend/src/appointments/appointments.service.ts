import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateAppointmentDto, UpdateAppointmentStatusDto } from './dto/appointment.dto';
import { dayRangeInZone, formatTimeInZone } from '../common/time-zone';

const DEFAULT_DURATION_MS = 60 * 60 * 1000; // 1h Annahme, wenn kein endTime gesetzt ist

@Injectable()
export class AppointmentsService {
  constructor(private prisma: PrismaService) {}

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
  private async assertNoCollision(
    companyId: string,
    assignedUserId: string,
    newStart: Date,
    newEnd: Date,
    excludeAppointmentId?: string,
  ) {
    const timeZone = await this.getTimeZone(companyId);
    const { start: dayStart, end: dayEnd } = dayRangeInZone(newStart, timeZone);

    const candidates = await this.prisma.appointment.findMany({
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

  async create(companyId: string, dto: CreateAppointmentDto) {
    await this.assertProjectBelongsToCompany(companyId, dto.projectId);

    if (dto.assignedUserId) {
      // Mandantenprüfung: der zugewiesene Mitarbeiter muss zur selben
      // Firma gehören wie das Projekt.
      const user = await this.prisma.user.findFirst({
        where: { id: dto.assignedUserId, companyId },
      });
      if (!user) {
        throw new NotFoundException('Zugewiesener Benutzer nicht gefunden.');
      }

      const startTime = new Date(dto.startTime);
      const endTime = dto.endTime
        ? new Date(dto.endTime)
        : new Date(startTime.getTime() + DEFAULT_DURATION_MS);
      await this.assertNoCollision(companyId, dto.assignedUserId, startTime, endTime);
    }

    return this.prisma.appointment.create({
      data: {
        companyId,
        projectId: dto.projectId,
        title: dto.title,
        startTime: new Date(dto.startTime),
        endTime: dto.endTime ? new Date(dto.endTime) : null,
        assignedUserId: dto.assignedUserId,
        notes: dto.notes,
      },
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
