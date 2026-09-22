import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { EmployeesService } from '../employees/employees.service';
import { StartTimeEntryDto, StopTimeEntryDto } from './dto/time-entry.dto';
import { calculateOvertime, OvertimeResult } from './overtime';
import { dayRangeInZone } from '../common/time-zone';

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

    const openEntry = await this.prisma.timeEntry.findFirst({
      where: { employeeId: employee.id, status: 'open' },
    });
    if (openEntry) {
      throw new BadRequestException('Es läuft bereits eine offene Zeiterfassung – zuerst beenden.');
    }

    if (dto.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: dto.projectId, companyId },
      });
      if (!project) {
        throw new NotFoundException('Projekt nicht gefunden.');
      }
    }

    return this.prisma.timeEntry.create({
      data: {
        companyId,
        employeeId: employee.id,
        projectId: dto.projectId,
        activity: dto.activity,
        startTime: new Date(),
      },
    });
  }

  async stop(companyId: string, userId: string, dto: StopTimeEntryDto) {
    const employee = await this.getOwnEmployeeOrThrow(companyId, userId);

    const openEntry = await this.prisma.timeEntry.findFirst({
      where: { employeeId: employee.id, status: 'open' },
    });
    if (!openEntry) {
      throw new BadRequestException('Keine offene Zeiterfassung vorhanden.');
    }

    return this.prisma.timeEntry.update({
      where: { id: openEntry.id },
      data: { endTime: new Date(), breakMinutes: dto.breakMinutes ?? 0, status: 'completed' },
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

  async approve(companyId: string, id: string) {
    const entry = await this.prisma.timeEntry.findFirst({
      where: { id, companyId },
    });
    if (!entry) {
      throw new NotFoundException('Zeiteintrag nicht gefunden.');
    }
    if (entry.status !== 'completed') {
      throw new BadRequestException(
        `Nur abgeschlossene Zeiteinträge können freigegeben werden (aktueller Status: "${entry.status}").`,
      );
    }
    return this.prisma.timeEntry.update({ where: { id }, data: { status: 'approved' } });
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
