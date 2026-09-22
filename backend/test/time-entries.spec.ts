import { BadRequestException, NotFoundException } from '@nestjs/common';
import { TimeEntriesService } from '../src/time-entries/time-entries.service';

function createPrismaMock() {
  const projects = [{ id: 'proj-a', property: { customer: { companyId: 'company-a' } } }];
  const timeEntries: any[] = [];

  const mock: any = {
    project: {
      findFirst: jest.fn(({ where }: any) =>
        where.id === 'proj-a' ? Promise.resolve(projects[0]) : Promise.resolve(null),
      ),
    },
    timeEntry: {
      findFirst: jest.fn(({ where }: any) => {
        if (where.employeeId && where.status === 'open') {
          return Promise.resolve(
            timeEntries.find((t) => t.employeeId === where.employeeId && t.status === 'open') ?? null,
          );
        }
        if (where.id) {
          const entry = timeEntries.find((t) => t.id === where.id);
          if (!entry) return Promise.resolve(null);
          const requiredCompanyId = where.employee?.companyId;
          // In diesem Mock kennen wir die companyId des Employees direkt.
          if (requiredCompanyId && entry.employeeCompanyId !== requiredCompanyId)
            return Promise.resolve(null);
          return Promise.resolve(entry);
        }
        return Promise.resolve(null);
      }),
      create: jest.fn(({ data }: any) => {
        const entry = {
          id: `entry-${timeEntries.length + 1}`,
          status: 'open',
          employeeCompanyId: 'company-a',
          ...data,
        };
        timeEntries.push(entry);
        return Promise.resolve(entry);
      }),
      update: jest.fn(({ where, data }: any) => {
        const entry = timeEntries.find((t) => t.id === where.id);
        Object.assign(entry, data);
        return Promise.resolve(entry);
      }),
      updateMany: jest.fn(({ where, data }: any) => {
        const entry = timeEntries.find(
          (t) =>
            t.id === where.id &&
            (typeof where.status === 'string'
              ? t.status === where.status
              : where.status.in.includes(t.status)),
        );
        if (entry) Object.assign(entry, data);
        return Promise.resolve({ count: entry ? 1 : 0 });
      }),
      findUniqueOrThrow: jest.fn(({ where }: any) =>
        Promise.resolve(timeEntries.find((t) => t.id === where.id)),
      ),
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          timeEntries.filter((t) => {
            if (t.employeeId !== where.employeeId) return false;
            if (where.startTime && (t.startTime < where.startTime.gte || t.startTime >= where.startTime.lt)) {
              return false;
            }
            if (where.status?.in && !where.status.in.includes(t.status)) return false;
            return true;
          }),
        ),
      ),
    },
    auditLog: {
      create: jest.fn(({ data }: any) => Promise.resolve(data)),
    },
    company: {
      findUniqueOrThrow: jest.fn(() =>
        Promise.resolve({ id: 'company-a', regularDailyHours: 8, timeZone: 'Europe/Berlin' }),
      ),
    },
  };
  // Interaktive Transaktion: der Callback bekommt denselben Mock als tx.
  mock.$transaction = jest.fn((arg: any) => (typeof arg === 'function' ? arg(mock) : Promise.all(arg)));
  mock.$executeRaw = jest.fn(() => Promise.resolve(0));
  return mock;
}

function createEmployeesServiceMock(employeeId: string | null) {
  return {
    findByUserId: jest.fn(() =>
      Promise.resolve(employeeId ? { id: employeeId, companyId: 'company-a' } : null),
    ),
    findOne: jest.fn(() => Promise.resolve({ id: employeeId, companyId: 'company-a' })),
  };
}

describe('TimeEntriesService', () => {
  it('lehnt Start ab, wenn kein Mitarbeiterprofil verknüpft ist', async () => {
    const prisma = createPrismaMock();
    const employees = createEmployeesServiceMock(null);
    const service = new TimeEntriesService(prisma as any, employees as any);

    await expect(service.start('company-a', 'user-x', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('verhindert eine zweite offene Zeiterfassung für denselben Mitarbeiter', async () => {
    const prisma = createPrismaMock();
    const employees = createEmployeesServiceMock('emp-1');
    const service = new TimeEntriesService(prisma as any, employees as any);

    await service.start('company-a', 'user-a', { projectId: 'proj-a' });
    await expect(service.start('company-a', 'user-a', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('stop schlägt fehl, wenn keine offene Zeiterfassung existiert', async () => {
    const prisma = createPrismaMock();
    const employees = createEmployeesServiceMock('emp-1');
    const service = new TimeEntriesService(prisma as any, employees as any);

    await expect(service.stop('company-a', 'user-a', {})).rejects.toBeInstanceOf(BadRequestException);
  });

  it('start -> stop funktioniert und setzt den Status auf completed', async () => {
    const prisma = createPrismaMock();
    const employees = createEmployeesServiceMock('emp-1');
    const service = new TimeEntriesService(prisma as any, employees as any);

    const started = await service.start('company-a', 'user-a', {
      projectId: 'proj-a',
      activity: 'Terrasse pflastern',
    });
    started.startTime = new Date(Date.now() - 4 * 60 * 60 * 1000); // vor 4 Stunden begonnen
    const stopped = await service.stop('company-a', 'user-a', { breakMinutes: 30 });

    expect(stopped.status).toBe('completed');
    expect(stopped.breakMinutes).toBe(30);
  });

  it('stop lehnt eine Pause ab, die länger ist als die erfasste Zeit', async () => {
    const prisma = createPrismaMock();
    const employees = createEmployeesServiceMock('emp-1');
    const service = new TimeEntriesService(prisma as any, employees as any);

    const started = await service.start('company-a', 'user-a', { projectId: 'proj-a' });
    started.startTime = new Date(Date.now() - 20 * 60 * 1000); // vor 20 Minuten begonnen
    await expect(service.stop('company-a', 'user-a', { breakMinutes: 30 })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('approve funktioniert nur aus dem Status "completed"', async () => {
    const prisma = createPrismaMock();
    const employees = createEmployeesServiceMock('emp-1');
    const service = new TimeEntriesService(prisma as any, employees as any);

    const started = await service.start('company-a', 'user-a', {});
    await expect(service.approve('company-a', 'user-boss', started.id)).rejects.toBeInstanceOf(
      BadRequestException,
    );

    await service.stop('company-a', 'user-a', {});
    const approved = await service.approve('company-a', 'user-boss', started.id);
    expect(approved.status).toBe('approved');
  });

  it('unbekannter Zeiteintrag wirft NotFoundException', async () => {
    const prisma = createPrismaMock();
    const employees = createEmployeesServiceMock('emp-1');
    const service = new TimeEntriesService(prisma as any, employees as any);

    await expect(service.approve('company-a', 'user-boss', 'does-not-exist')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });
});

describe('TimeEntriesService – Überstunden', () => {
  it('berechnet 0 Überstunden ohne Zeiteinträge an dem Tag', async () => {
    const prisma = createPrismaMock();
    const employees = createEmployeesServiceMock('emp-1');
    const service = new TimeEntriesService(prisma as any, employees as any);

    const result = await service.getDailyOvertime('company-a', 'emp-1', new Date('2026-07-01T12:00:00.000Z'));
    expect(result.workedMinutes).toBe(0);
    expect(result.overtimeMinutes).toBe(0);
  });

  it('summiert mehrere abgeschlossene Einträge desselben Tages und berechnet Überstunden', async () => {
    const prisma = createPrismaMock();
    const employees = createEmployeesServiceMock('emp-1');
    const service = new TimeEntriesService(prisma as any, employees as any);

    // 6h + 3,5h = 9,5h gearbeitet, 8h Regelarbeitszeit -> 1,5h = 90 Min Überstunden
    await (prisma as any).timeEntry.create({
      data: {
        id: 'e1',
        employeeId: 'emp-1',
        status: 'completed',
        startTime: new Date('2026-07-02T07:00:00.000Z'),
        endTime: new Date('2026-07-02T13:00:00.000Z'),
        breakMinutes: 0,
      },
    });
    await (prisma as any).timeEntry.create({
      data: {
        id: 'e2',
        employeeId: 'emp-1',
        status: 'approved',
        startTime: new Date('2026-07-02T13:30:00.000Z'),
        endTime: new Date('2026-07-02T17:00:00.000Z'),
        breakMinutes: 0,
      },
    });
    // Ein "open"-Eintrag desselben Tages darf NICHT mitgezählt werden.
    await (prisma as any).timeEntry.create({
      data: {
        id: 'e3',
        employeeId: 'emp-1',
        status: 'open',
        startTime: new Date('2026-07-02T18:00:00.000Z'),
        endTime: null,
        breakMinutes: 0,
      },
    });

    const result = await service.getDailyOvertime('company-a', 'emp-1', new Date('2026-07-02T20:00:00.000Z'));
    expect(result.workedMinutes).toBe(570); // 9,5h
    expect(result.overtimeMinutes).toBe(90);
  });

  it('getMyDailyOvertime nutzt das eigene, verknüpfte Mitarbeiterprofil', async () => {
    const prisma = createPrismaMock();
    const employees = createEmployeesServiceMock('emp-1');
    const service = new TimeEntriesService(prisma as any, employees as any);

    const result = await service.getMyDailyOvertime(
      'company-a',
      'user-a',
      new Date('2026-07-03T12:00:00.000Z'),
    );
    expect(result.overtimeMinutes).toBe(0);
    expect(employees.findByUserId).toHaveBeenCalledWith('company-a', 'user-a');
  });
});
