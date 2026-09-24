import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { addCalendarDays, localDayString, localTimeInZone } from '../../src/common/time-zone';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';

// Abwesenheiten: eintragen, Plantafel (Art nur mit Recht), keine Termine an
// diesen Tagen, Pflegeverträge lassen den Termin offen, Rechte und Mandanten.
describe('Abwesenheiten', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let other: TestCompany;
  let auth: { Authorization: string };
  let plannerAuth: { Authorization: string };
  let workerId: string;
  let projectId: string;
  const api = () => request(app.getHttpServer());
  const tz = 'Europe/Berlin';
  // Montag in drei Wochen: sicher in der Zukunft, ganze Woche frei
  const today = localDayString(new Date(), tz);
  const weekday = (new Date(`${today}T12:00:00Z`).getUTCDay() + 6) % 7;
  const monday = addCalendarDays(today, 21 - weekday);
  const at = (day: string, hour: number) => localTimeInZone(day, hour * 60, tz).toISOString();

  async function userWith(email: string, keys: string[]) {
    const role = await prisma.role.create({
      data: {
        companyId: company.companyId,
        name: email,
        permissions: {
          create: (await prisma.permission.findMany({ where: { key: { in: keys } } })).map((p) => ({
            permissionId: p.id,
          })),
        },
      },
    });
    const user = await prisma.user.create({
      data: {
        companyId: company.companyId,
        email,
        passwordHash: await bcrypt.hash('test12345', 4),
        firstName: 'Test',
        lastName: email,
        roles: { create: { roleId: role.id } },
      },
    });
    const login = await api().post('/auth/login').send({ email, password: 'test12345' });
    return { id: user.id, auth: { Authorization: `Bearer ${login.body.accessToken}` } };
  }

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Abwesend GmbH');
    other = await createCompany(app, prisma, 'Fremd Abwesend GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    ({ projectId } = await createProject(app, company.token));
    workerId = (await userWith('kai@abwesend.test', ['site.use'])).id;
    plannerAuth = (await userWith('plan@abwesend.test', ['customer.read', 'customer.write'])).auth;
  });

  afterAll(async () => {
    await app.close();
  });

  it('eintragen, Plantafel, keine Termine an den Tagen', async () => {
    // schon geplant: Dienstag 9 Uhr – wird als Konflikt gemeldet, bleibt aber stehen
    const planned = await api()
      .post('/appointments')
      .set(auth)
      .send({
        projectId,
        title: 'Hecke',
        startTime: at(addCalendarDays(monday, 1), 9),
        assignedUserId: workerId,
      })
      .expect(201);

    const created = await api()
      .post('/absences')
      .set(auth)
      .send({
        userId: workerId,
        kind: 'sick',
        startDate: monday,
        endDate: addCalendarDays(monday, 2),
        note: 'AU liegt vor',
      })
      .expect(201);
    expect(created.body.absence).toMatchObject({ kind: 'sick', note: 'AU liegt vor', startDate: monday });
    expect(created.body.conflicts).toHaveLength(1);
    expect(created.body.conflicts[0]).toMatchObject({ id: planned.body.id, day: addCalendarDays(monday, 1) });

    // neue Termine und Verschieben in die Abwesenheit: abgelehnt
    const blocked = await api()
      .post('/appointments')
      .set(plannerAuth)
      .send({
        projectId,
        title: 'Mähen',
        startTime: at(addCalendarDays(monday, 2), 14),
        assignedUserId: workerId,
      })
      .expect(400);
    expect(blocked.body.message).toContain('abwesend');
    expect(blocked.body.message).not.toContain('krank');
    const free = await api()
      .post('/appointments')
      .set(auth)
      .send({
        projectId,
        title: 'Pflanzen',
        startTime: at(addCalendarDays(monday, 3), 8),
        assignedUserId: workerId,
      })
      .expect(201);
    await api()
      .patch(`/appointments/${free.body.id}`)
      .set(auth)
      .send({ startTime: at(monday, 8) })
      .expect(400);
    // nicht zugeteilt geht immer
    await api()
      .post('/appointments')
      .set(auth)
      .send({ projectId, title: 'Offen', startTime: at(monday, 8) })
      .expect(201);

    // Plantafel: Chef sieht die Art, der Planer nur „abwesend“
    const board = await api().get(`/appointments/board?from=${monday}&days=7`).set(auth).expect(200);
    expect(board.body.absences).toEqual([expect.objectContaining({ userId: workerId, kind: 'sick' })]);
    const planner = await api().get(`/appointments/board?from=${monday}&days=7`).set(plannerAuth).expect(200);
    expect(planner.body.absences).toEqual([
      expect.objectContaining({ userId: workerId, kind: 'absent', note: null }),
    ]);
    const list = await api()
      .get(`/absences?from=${monday}&to=${addCalendarDays(monday, 30)}`)
      .set(plannerAuth)
      .expect(200);
    expect(list.body[0]).toMatchObject({ kind: 'absent' });
    expect(JSON.stringify(list.body)).not.toContain('AU liegt vor');

    expect(
      await prisma.auditLog.count({ where: { companyId: company.companyId, action: 'absence_created' } }),
    ).toBe(1);
  });

  it('Pflegevertrag: Einsatz am Abwesenheitstag bleibt offen', async () => {
    await api()
      .post('/contracts')
      .set(auth)
      .send({
        projectId,
        title: 'Pflege',
        startDate: today,
        billingInterval: 'monthly',
        lines: [{ description: 'Pflege', unit: 'psch', quantity: 1, unitPrice: 100 }],
        tasks: [
          {
            title: 'Rasen',
            everyWeeks: 1,
            seasonFrom: 1,
            seasonTo: 12,
            startMinutes: 13 * 60,
            nextDue: addCalendarDays(monday, 1),
            assignedUserId: workerId,
          },
        ],
      })
      .expect(201);
    const planned = await api()
      .post('/contracts/schedule')
      .set(auth)
      .send({ until: addCalendarDays(monday, 8) })
      .expect(201);
    // Dienstag (abwesend) offen, eine Woche später zugeteilt
    expect(planned.body).toEqual({ created: 2, unassigned: 1 });
  });

  it('prüft Eingaben, Rechte und Mandanten', async () => {
    const later = addCalendarDays(monday, 14);
    const body = { userId: workerId, kind: 'vacation', startDate: later, endDate: addCalendarDays(later, 4) };
    await api().post('/absences').set(plannerAuth).send(body).expect(403);
    await api()
      .post('/absences')
      .set(auth)
      .send({ ...body, endDate: addCalendarDays(later, -1) })
      .expect(400);
    await api()
      .post('/absences')
      .set(auth)
      .send({ ...body, kind: 'party' })
      .expect(400);
    await api()
      .post('/absences')
      .set(auth)
      .send({ ...body, endDate: addCalendarDays(later, 400) })
      .expect(400);
    const vacation = await api().post('/absences').set(auth).send(body).expect(201);
    // überschneidet sich
    await api()
      .post('/absences')
      .set(auth)
      .send({ ...body, startDate: addCalendarDays(later, 2), endDate: addCalendarDays(later, 6) })
      .expect(400);

    // andere Firma: sieht nichts, kann nichts löschen, nicht für fremde Nutzer eintragen
    const otherAuth = { Authorization: `Bearer ${other.token}` };
    expect(
      (
        await api()
          .get(`/absences?from=${monday}&to=${addCalendarDays(monday, 60)}`)
          .set(otherAuth)
          .expect(200)
      ).body,
    ).toEqual([]);
    await api().delete(`/absences/${vacation.body.absence.id}`).set(otherAuth).expect(404);
    await api().post('/absences').set(otherAuth).send(body).expect(404);

    // gelöscht: Termin wieder möglich
    await api().delete(`/absences/${vacation.body.absence.id}`).set(auth).expect(200);
    await api()
      .post('/appointments')
      .set(auth)
      .send({ projectId, title: 'Wieder da', startTime: at(later, 9), assignedUserId: workerId })
      .expect(201);
  });
});
