import { BadRequestException, NotFoundException } from '@nestjs/common';
import { AppointmentsService } from '../src/appointments/appointments.service';

function createPrismaMock() {
  const projects = [{ id: 'proj-a', property: { customer: { companyId: 'company-a' } } }];
  const users = [
    { id: 'user-a', companyId: 'company-a' },
    { id: 'user-b', companyId: 'company-b' },
  ];
  const appointments: any[] = [];

  return {
    project: {
      findFirst: jest.fn(({ where }: any) => {
        if (where.id !== 'proj-a') return Promise.resolve(null);
        return Promise.resolve(projects[0]);
      }),
    },
    user: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(users.find((u) => u.id === where.id && u.companyId === where.companyId) ?? null),
      ),
    },
    appointment: {
      findFirst: jest.fn(({ where }: any) =>
        Promise.resolve(appointments.find((a) => a.id === where.id) ?? null),
      ),
      create: jest.fn(({ data }: any) => {
        const appt = { id: `appt-${appointments.length + 1}`, status: 'planned', ...data };
        appointments.push(appt);
        return Promise.resolve(appt);
      }),
      findMany: jest.fn(({ where }: any) =>
        Promise.resolve(
          appointments.filter((a) => {
            if (a.assignedUserId !== where.assignedUserId) return false;
            if (where.startTime && (a.startTime < where.startTime.gte || a.startTime >= where.startTime.lt)) {
              return false;
            }
            if (where.status?.not && a.status === where.status.not) return false;
            if (where.id?.not && a.id === where.id.not) return false;
            return true;
          }),
        ),
      ),
      update: jest.fn(({ where, data }: any) => {
        const appt = appointments.find((a) => a.id === where.id);
        Object.assign(appt, data);
        return Promise.resolve(appt);
      }),
    },
  };
}

describe('AppointmentsService', () => {
  it('lehnt Terminerstellung an einem fremden Projekt ab', async () => {
    const prisma = createPrismaMock();
    const service = new AppointmentsService(prisma as any);

    await expect(
      service.create('company-a', {
        projectId: 'unknown-project',
        title: 'Test',
        startTime: new Date().toISOString(),
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('lehnt Zuweisung an einen Mitarbeiter einer fremden Firma ab', async () => {
    const prisma = createPrismaMock();
    const service = new AppointmentsService(prisma as any);

    await expect(
      service.create('company-a', {
        projectId: 'proj-a',
        title: 'Terrasse bauen',
        startTime: new Date().toISOString(),
        assignedUserId: 'user-b', // gehört zu company-b
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('"Mein Tag" liefert nur Termine des angefragten Users am angefragten Tag', async () => {
    const prisma = createPrismaMock();
    const service = new AppointmentsService(prisma as any);

    await service.create('company-a', {
      projectId: 'proj-a',
      title: 'Heute: Terrasse',
      startTime: '2026-05-10T08:00:00.000Z',
      assignedUserId: 'user-a',
    });
    await service.create('company-a', {
      projectId: 'proj-a',
      title: 'Morgen: Hecke schneiden',
      startTime: '2026-05-11T08:00:00.000Z',
      assignedUserId: 'user-a',
    });

    const today = await service.findMyDay('company-a', 'user-a', new Date('2026-05-10T12:00:00.000Z'));
    expect(today).toHaveLength(1);
    expect(today[0].title).toBe('Heute: Terrasse');
  });
});

describe('AppointmentsService – Kollisionsprüfung', () => {
  it('lehnt einen überlappenden Termin für denselben Mitarbeiter ab', async () => {
    const prisma = createPrismaMock();
    const service = new AppointmentsService(prisma as any);

    await service.create('company-a', {
      projectId: 'proj-a',
      title: 'Terrasse pflastern',
      startTime: '2026-06-01T08:00:00.000Z',
      endTime: '2026-06-01T11:00:00.000Z',
      assignedUserId: 'user-a',
    });

    await expect(
      service.create('company-a', {
        projectId: 'proj-a',
        title: 'Hecke schneiden',
        startTime: '2026-06-01T10:00:00.000Z', // überlappt mit 08:00-11:00
        endTime: '2026-06-01T12:00:00.000Z',
        assignedUserId: 'user-a',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('erlaubt zwei direkt aneinander anschließende Termine (kein Überlappen)', async () => {
    const prisma = createPrismaMock();
    const service = new AppointmentsService(prisma as any);

    await service.create('company-a', {
      projectId: 'proj-a',
      title: 'Vormittags: Terrasse',
      startTime: '2026-06-01T08:00:00.000Z',
      endTime: '2026-06-01T11:00:00.000Z',
      assignedUserId: 'user-a',
    });

    const second = await service.create('company-a', {
      projectId: 'proj-a',
      title: 'Nachmittags: Hecke',
      startTime: '2026-06-01T11:00:00.000Z', // beginnt genau, wenn der erste endet
      endTime: '2026-06-01T13:00:00.000Z',
      assignedUserId: 'user-a',
    });
    expect(second.title).toBe('Nachmittags: Hecke');
  });

  it('nimmt ohne endTime eine Standarddauer von 1h für die Kollisionsprüfung an', async () => {
    const prisma = createPrismaMock();
    const service = new AppointmentsService(prisma as any);

    await service.create('company-a', {
      projectId: 'proj-a',
      title: 'Aufmaß',
      startTime: '2026-06-02T08:00:00.000Z', // keine endTime -> gilt bis 09:00
      assignedUserId: 'user-a',
    });

    await expect(
      service.create('company-a', {
        projectId: 'proj-a',
        title: 'Zweiter Termin',
        startTime: '2026-06-02T08:30:00.000Z',
        assignedUserId: 'user-a',
      }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('ein stornierter Termin blockiert keine neue Buchung mehr', async () => {
    const prisma = createPrismaMock();
    const service = new AppointmentsService(prisma as any);

    const first = await service.create('company-a', {
      projectId: 'proj-a',
      title: 'Wird storniert',
      startTime: '2026-06-03T08:00:00.000Z',
      endTime: '2026-06-03T11:00:00.000Z',
      assignedUserId: 'user-a',
    });
    await service.updateStatus('company-a', first.id, { status: 'cancelled' });

    const second = await service.create('company-a', {
      projectId: 'proj-a',
      title: 'Neuer Termin zur selben Zeit',
      startTime: '2026-06-03T09:00:00.000Z',
      endTime: '2026-06-03T10:00:00.000Z',
      assignedUserId: 'user-a',
    });
    expect(second.title).toBe('Neuer Termin zur selben Zeit');
  });

  it('unterschiedliche Mitarbeiter können sich zeitlich überschneiden', async () => {
    const prisma = createPrismaMock();
    const service = new AppointmentsService(prisma as any);

    await service.create('company-a', {
      projectId: 'proj-a',
      title: 'Team 1',
      startTime: '2026-06-04T08:00:00.000Z',
      endTime: '2026-06-04T11:00:00.000Z',
      assignedUserId: 'user-a',
    });

    const forOtherEmployee = await service.create('company-a', {
      projectId: 'proj-a',
      title: 'Team 2',
      startTime: '2026-06-04T08:00:00.000Z',
      endTime: '2026-06-04T11:00:00.000Z',
      // kein assignedUserId -> keine Kollisionsprüfung nötig
    });
    expect(forOtherEmployee.title).toBe('Team 2');
  });
});
