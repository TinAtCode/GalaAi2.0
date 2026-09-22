import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { CorrectTimeEntryDto, StartTimeEntryDto, StopTimeEntryDto } from './dto/time-entry.dto';
import { writeAudit } from '../common/audit';
import { calculateOvertime, OvertimeResult } from './overtime';
import { dayRangeInZone } from '../common/time-zone';
import { lockFor } from '../common/advisory-lock';

@Injectable()
export class TimeEntriesService {
  constructor(
    private prisma: PrismaService,
    private employeesService: EmployeesService,
  ) {}

  // Die Zeiterfassung ist bewusst Selbstbedienung: ein User bucht IMMER auf
  // den Employee-Datensatz, der mit seinem eigenen Account verknüpft ist –
  // nicht auf eine beliebige, im Body übergebene employeeId. Das verhindert,
  // dass jemand Zeiten für einen Kollegen bucht, ohne dass das explizit als
  // eigenes, berechtigungsgeprüftes Feature gebaut wird.
  private async getOwnEmployeeOrThrow(companyId: string, userId: string) {
    const employee = await this.employeesService.findByUserId(companyId, userId);
    if (!employee) {
      throw new BadRequestException(
        'Für diesen Benutzer ist kein Mitarbeiterprofil hinterlegt – Zeiterfassung nicht möglich.',
      );
    }
    return employee;
  }

  async start(companyId: string, userId: string, dto: StartTimeEntryDto) {
    const employee = await this.getOwnEmployeeOrThrow(companyId, userId);

    if (dto.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: dto.projectId, companyId },
      });
      if (!project) {
        throw new NotFoundException('Projekt nicht gefunden.');
      }
    }

    // Prüfen und Anlegen unter einer Sperre pro Mitarbeiter: zwei schnelle
    // Klicks auf "Start" ergeben sonst zwei laufende Zeiterfassungen.
    return this.prisma.$transaction(async (tx) => {
      await lockFor(tx, 'time-entry', employee.id);
      const openEntry = await tx.timeEntry.findFirst({
        where: { employeeId: employee.id, companyId, status: 'open' },
      });
      if (openEntry) {
        throw new BadRequestException('Es läuft bereits eine offene Zeiterfassung – zuerst beenden.');
      }
      return tx.timeEntry.create({
        data: {
          companyId,
          employeeId: employee.id,
          projectId: dto.projectId,
          activity: dto.activity,
          startTime: new Date(),
        },
      });
    });
  }

  async stop(companyId: string, userId: string, dto: StopTimeEntryDto) {
    const employee = await this.getOwnEmployeeOrThrow(companyId, userId);

    return this.prisma.$transaction(async (tx) => {
      await lockFor(tx, 'time-entry', employee.id);
      const openEntry = await tx.timeEntry.findFirst({
        where: { employeeId: employee.id, companyId, status: 'open' },
      });
      if (!openEntry) {
        throw new BadRequestException('Keine offene Zeiterfassung vorhanden.');
      }

      const endTime = new Date();
      const breakMinutes = dto.breakMinutes ?? 0;
      const workedMinutes = (endTime.getTime() - openEntry.startTime.getTime()) / 60000;
      if (breakMinutes > workedMinutes) {
        throw new BadRequestException('Die Pause kann nicht länger sein als die erfasste Zeit.');
      }

      return tx.timeEntry.update({
        where: { id: openEntry.id },
        data: { endTime, breakMinutes, status: 'completed' },
      });
    });
  }

  async findMine(companyId: string, userId: string) {
    const employee = await this.getOwnEmployeeOrThrow(companyId, userId);
    return this.prisma.timeEntry.findMany({
      where: { employeeId: employee.id, companyId },
      orderBy: { startTime: 'desc' },
    });
  }

  // Für Vorgesetzte/Büro: Zeiten eines beliebigen Mitarbeiters einsehen
  // (permission-geprüft im Controller: employee.data.read).
  async findAllForEmployee(companyId: string, employeeId: string) {
    await this.employeesService.findOne(companyId, employeeId); // wirft NotFound, falls fremde Firma
    return this.prisma.timeEntry.findMany({
      where: { employeeId, companyId },
      orderBy: { startTime: 'desc' },
    });
  }

  private async findEntryOrThrow(companyId: string, id: string) {
    const entry = await this.prisma.timeEntry.findFirst({ where: { id, companyId } });
    if (!entry) {
      throw new NotFoundException('Zeiteintrag nicht gefunden.');
    }
    return entry;
  }

  // Freigabe als bedingtes Update (nur aus "completed") plus Audit-Eintrag –
  // wer wann freigegeben hat, bleibt nachvollziehbar.
  async approve(companyId: string, userId: string, id: string) {
    const entry = await this.findEntryOrThrow(companyId, id);
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.timeEntry.updateMany({
        where: { id, companyId, status: 'completed' },
        data: { status: 'approved', approvedByUserId: userId, approvedAt: new Date() },
      });
      if (count === 0) {
        throw new BadRequestException(
          `Nur abgeschlossene Zeiteinträge können freigegeben werden (aktueller Status: "${entry.status}").`,
        );
      }
      await writeAudit(tx, {
        companyId,
        userId,
        action: 'time_entry_approve',
        entity: 'TimeEntry',
        entityId: id,
      });
      return tx.timeEntry.findUniqueOrThrow({ where: { id } });
    });
  }

  // Korrektur durch Vorgesetzte: abgeschlossene Einträge anpassen oder einen
  // noch laufenden (vergessenes "Stopp") mit Endzeit abschließen. Freigegebene
  // Einträge sind gesperrt. Jede Korrektur wird mit Begründung protokolliert.
  async correct(companyId: string, userId: string, id: string, dto: CorrectTimeEntryDto) {
    const entry = await this.findEntryOrThrow(companyId, id);
    if (entry.status === 'approved') {
      throw new BadRequestException('Freigegebene Zeiteinträge können nicht mehr geändert werden.');
    }

    const startTime = dto.startTime ? new Date(dto.startTime) : entry.startTime;
    const endTime = dto.endTime ? new Date(dto.endTime) : entry.endTime;
    const breakMinutes = dto.breakMinutes ?? entry.breakMinutes;
    if (!endTime) {
      throw new BadRequestException('Für einen laufenden Eintrag muss eine Endzeit angegeben werden.');
    }
    const minutes = (endTime.getTime() - startTime.getTime()) / 60000;
    if (minutes <= 0) {
      throw new BadRequestException('Das Ende muss nach dem Beginn liegen.');
    }
    if (minutes > 24 * 60) {
      throw new BadRequestException('Ein Zeiteintrag darf höchstens 24 Stunden umfassen.');
    }
    if (breakMinutes > minutes) {
      throw new BadRequestException('Die Pause kann nicht länger sein als die erfasste Zeit.');
    }
    if (endTime > new Date()) {
      throw new BadRequestException('Die Endzeit darf nicht in der Zukunft liegen.');
    }

    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.timeEntry.updateMany({
        where: { id, companyId, status: { in: ['open', 'completed'] } },
        data: { startTime, endTime, breakMinutes, status: 'completed' },
      });
      if (count === 0) {
        throw new BadRequestException('Der Zeiteintrag wurde inzwischen freigegeben.');
      }
      await writeAudit(tx, {
        companyId,
        userId,
        action: 'time_entry_correct',
        entity: 'TimeEntry',
        entityId: id,
        oldData: {
          startTime: entry.startTime.toISOString(),
          endTime: entry.endTime?.toISOString() ?? null,
          breakMinutes: entry.breakMinutes,
          status: entry.status,
        },
        newData: {
          startTime: startTime.toISOString(),
          endTime: endTime.toISOString(),
          breakMinutes,
          status: 'completed',
          reason: dto.reason,
        },
      });
      return tx.timeEntry.findUniqueOrThrow({ where: { id } });
    });
  }

  // Überstunden für EINEN Kalendertag eines Mitarbeiters (Punkt 29).
  // Zählt nur abgeschlossene/freigegebene Einträge – ein noch laufender
  // ("open") Eintrag fließt bewusst nicht ein, da seine Dauer noch offen ist.
  async getDailyOvertime(companyId: string, employeeId: string, date: Date): Promise<OvertimeResult> {
    await this.employeesService.findOne(companyId, employeeId); // wirft NotFound, falls fremde Firma

    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const { start: dayStart, end: dayEnd } = dayRangeInZone(date, company.timeZone);

    const entries = await this.prisma.timeEntry.findMany({
      where: {
        employeeId,
        companyId,
        status: { in: ['completed', 'approved'] },
        startTime: { gte: dayStart, lt: dayEnd },
      },
    });

    const workedMinutes = entries.reduce((sum: number, entry: any) => {
      if (!entry.endTime) return sum;
      const durationMs = new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime();
      return sum + Math.max(0, durationMs / 60000 - (entry.breakMinutes ?? 0));
    }, 0);

    return calculateOvertime(workedMinutes, Number(company.regularDailyHours));
  }

  // Eigene Überstunden-Selbstbedienung (analog zu findMine).
  async getMyDailyOvertime(companyId: string, userId: string, date: Date): Promise<OvertimeResult> {
    const employee = await this.getOwnEmployeeOrThrow(companyId, userId);
    return this.getDailyOvertime(companyId, employee.id, date);
  }
}
