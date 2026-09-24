import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';

// Plantafel: Termine aller Mitarbeiter einer Woche, verschieben und neu
// zuteilen mit Kollisionsprüfung, Mandantentrennung.
describe('Plantafel', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let other: TestCompany;
  let auth: { Authorization: string };
  let projectId: string;
  let colleagueId: string;
  const api = () => request(app.getHttpServer());
  // Montag, 5. Oktober 2026 (Sommerzeit, UTC+2)
  const at = (day: string, time: string) => new Date(`${day}T${time}:00+02:00`).toISOString();

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Tafel GmbH');
    other = await createCompany(app, prisma, 'Fremd Tafel GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    ({ projectId } = await createProject(app, company.token));
    const colleague = await prisma.user.create({
      data: {
        companyId: company.companyId,
        email: 'kollege@tafel.test',
        passwordHash: 'x',
        firstName: 'Kai',
        lastName: 'Kollege',
      },
    });
    colleagueId = colleague.id;
    await prisma.user.create({
      data: {
        companyId: company.companyId,
        email: 'weg@tafel.test',
        passwordHash: 'x',
        firstName: 'Ex',
        lastName: 'Mitarbeiter',
        active: false,
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  const create = (title: string, start: string, end: string, assignedUserId?: string) =>
    api()
      .post('/appointments')
      .set(auth)
      .send({ projectId, title, startTime: start, endTime: end, assignedUserId })
      .expect(201);

  it('zeigt die Woche und verschiebt Termine', async () => {
    const mowing = await create(
      'Rasen mähen',
      at('2026-10-05', '08:00'),
      at('2026-10-05', '10:00'),
      company.userId,
    );
    const hedge = await create('Hecke', at('2026-10-06', '08:00'), at('2026-10-06', '12:00'), colleagueId);
    await create('Nächste Woche', at('2026-10-12', '08:00'), at('2026-10-12', '09:00'));
    const cancelled = await create('Abgesagt', at('2026-10-07', '08:00'), at('2026-10-07', '09:00'));
    await api()
      .patch(`/appointments/${cancelled.body.id}/status`)
      .set(auth)
      .send({ status: 'cancelled' })
      .expect(200);

    const board = await api().get('/appointments/board?from=2026-10-05&days=7').set(auth).expect(200);
    expect(board.body.appointments.map((a: { title: string }) => a.title)).toEqual(['Rasen mähen', 'Hecke']);
    expect(board.body.appointments[0].project).toMatchObject({ id: projectId, title: 'Terrasse anlegen' });
    // nur aktive Mitarbeiter
    expect(board.body.assignees.map((a: { lastName: string }) => a.lastName).sort()).toEqual([
      'Kollege',
      'Tafel GmbH',
    ]);

    // auf Dienstag zum Kollegen: überschneidet sich mit der Hecke
    const clash = await api()
      .patch(`/appointments/${mowing.body.id}`)
      .set(auth)
      .send({ startTime: at('2026-10-06', '09:00'), assignedUserId: colleagueId })
      .expect(400);
    expect(clash.body.message).toContain('Terminüberschneidung');
    // nachmittags passt es; die Dauer (2 h) bleibt
    const moved = await api()
      .patch(`/appointments/${mowing.body.id}`)
      .set(auth)
      .send({ startTime: at('2026-10-06', '13:00'), assignedUserId: colleagueId })
      .expect(200);
    expect(moved.body.endTime).toBe(at('2026-10-06', '15:00'));
    expect(moved.body.assignedUserId).toBe(colleagueId);
    // in sich selbst verschieben ist keine Überschneidung
    await api()
      .patch(`/appointments/${mowing.body.id}`)
      .set(auth)
      .send({ startTime: at('2026-10-06', '13:30') })
      .expect(200);
    // freigeben
    const released = await api()
      .patch(`/appointments/${hedge.body.id}`)
      .set(auth)
      .send({ assignedUserId: null })
      .expect(200);
    expect(released.body.assignedUserId).toBeNull();
    await api()
      .patch(`/appointments/${hedge.body.id}`)
      .set(auth)
      .send({ endTime: at('2026-10-06', '07:00') })
      .expect(400);
    await api().patch(`/appointments/${cancelled.body.id}`).set(auth).send({ title: 'Neu' }).expect(400);
  });

  it('nur eigene Termine und Mitarbeiter', async () => {
    const mine = await create('Meins', at('2026-10-08', '08:00'), at('2026-10-08', '09:00'));
    const otherAuth = { Authorization: `Bearer ${other.token}` };
    const board = await api().get('/appointments/board?from=2026-10-05').set(otherAuth).expect(200);
    expect(board.body.appointments).toHaveLength(0);
    expect(board.body.assignees).toHaveLength(1);
    await api().patch(`/appointments/${mine.body.id}`).set(otherAuth).send({ title: 'Fremd' }).expect(404);
    // fremden Mitarbeiter zuteilen
    await api()
      .patch(`/appointments/${mine.body.id}`)
      .set(auth)
      .send({ assignedUserId: other.userId })
      .expect(404);
    await api().get('/appointments/board?from=2026-13-40').set(auth).expect(400);
    await api().get('/appointments/board?from=2026-10-05&days=60').set(auth).expect(400);
  });
});
