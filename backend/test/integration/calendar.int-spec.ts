import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';

// Kalender: Firmen-Termine sehen alle (eintragen nur Chef/Büro), persönliche
// nur ihr Besitzer; Zeitraum mit mehrtägigen Terminen; Mandanten.
describe('Kalender', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let other: TestCompany;
  let chef: { Authorization: string };
  let worker: { Authorization: string };
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Kalender GmbH');
    other = await createCompany(app, prisma, 'Andere GmbH');
    chef = { Authorization: `Bearer ${company.token}` };
    const role = await prisma.role.create({
      data: {
        companyId: company.companyId,
        name: 'Baustelle',
        permissions: {
          create: (await prisma.permission.findMany({ where: { key: 'site.use' } })).map((p) => ({
            permissionId: p.id,
          })),
        },
      },
    });
    await prisma.user.create({
      data: {
        companyId: company.companyId,
        email: 'kai@kalender.test',
        passwordHash: await bcrypt.hash('test12345', 4),
        firstName: 'Kai',
        lastName: 'Kelle',
        roles: { create: { roleId: role.id } },
      },
    });
    const login = await api().post('/auth/login').send({ email: 'kai@kalender.test', password: 'test12345' });
    worker = { Authorization: `Bearer ${login.body.accessToken}` };
  });

  afterAll(async () => {
    await app.close();
  });

  const list = (auth: Record<string, string>, from = '2026-10-01', to = '2026-10-31') =>
    api().get(`/calendar/events?from=${from}&to=${to}`).set(auth).expect(200);

  it('Firmen-Termine für alle, persönliche nur für mich', async () => {
    const party = await api()
      .post('/calendar/events')
      .set(chef)
      .send({
        scope: 'company',
        title: 'Betriebsurlaub',
        startTime: '2026-10-19T00:00:00+02:00',
        endTime: '2026-10-23T23:59:00+02:00',
        allDay: true,
      })
      .expect(201);
    await api()
      .post('/calendar/events')
      .set(worker)
      .send({ scope: 'personal', title: 'Zahnarzt', startTime: '2026-10-07T15:00:00+02:00' })
      .expect(201);
    // Mitarbeiter darf keine Firmen-Termine eintragen oder ändern
    await api()
      .post('/calendar/events')
      .set(worker)
      .send({ scope: 'company', title: 'Grillfest', startTime: '2026-10-09T17:00:00+02:00' })
      .expect(403);
    await api()
      .put(`/calendar/events/${party.body.id}`)
      .set(worker)
      .send({ scope: 'company', title: 'Weg', startTime: '2026-10-19T00:00:00+02:00' })
      .expect(403);

    const mine = (await list(worker)).body;
    expect(mine.canWriteCompany).toBe(false);
    expect(mine.events.map((e: { title: string; editable: boolean }) => [e.title, e.editable])).toEqual([
      ['Zahnarzt', true],
      ['Betriebsurlaub', false],
    ]);
    // der Chef sieht den persönlichen Termin nicht
    const chefs = (await list(chef)).body;
    expect(chefs.canWriteCompany).toBe(true);
    expect(chefs.events.map((e: { title: string }) => e.title)).toEqual(['Betriebsurlaub']);
    const zahnarzt = mine.events[0].id;
    await api()
      .put(`/calendar/events/${zahnarzt}`)
      .set(chef)
      .send({ scope: 'personal', title: 'Fremd', startTime: '2026-10-07T15:00:00+02:00' })
      .expect(404);
    await api().delete(`/calendar/events/${zahnarzt}`).set(chef).expect(404);
    await api().delete(`/calendar/events/${zahnarzt}`).set(worker).expect(200);
  });

  it('Zeitraum: mehrtägige Termine überlappen, Grenzen geprüft', async () => {
    // Betriebsurlaub 19.–23.10. erscheint auch in der Woche ab 21.10.
    expect((await list(chef, '2026-10-21', '2026-10-27')).body.events).toHaveLength(1);
    expect((await list(chef, '2026-10-24', '2026-10-30')).body.events).toHaveLength(0);
    await api().get('/calendar/events?from=2026-10-31&to=2026-10-01').set(chef).expect(400);
    await api().get('/calendar/events?from=2026-01-01&to=2026-12-31').set(chef).expect(400);
    await api()
      .post('/calendar/events')
      .set(chef)
      .send({
        scope: 'company',
        title: 'Rückwärts',
        startTime: '2026-10-10T10:00:00Z',
        endTime: '2026-10-10T09:00:00Z',
      })
      .expect(400);
  });

  it('Mandanten getrennt', async () => {
    const otherAuth = { Authorization: `Bearer ${other.token}` };
    expect((await list(otherAuth)).body.events).toEqual([]);
    const party = (await list(chef)).body.events[0].id;
    await api().delete(`/calendar/events/${party}`).set(otherAuth).expect(404);
  });
});
