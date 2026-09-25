import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { addCalendarDays, localDayString } from '../../src/common/time-zone';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';

// Bautagebuch: ein Eintrag je Tag, Verzögerungen mit Ursache, Fotos des Tages,
// nichts in der Zukunft, jede Änderung im Audit-Log, Rechte und Mandanten.
describe('Bautagebuch', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let other: TestCompany;
  let auth: { Authorization: string };
  let worker: { Authorization: string };
  let projectId: string;
  const api = () => request(app.getHttpServer());
  const today = localDayString(new Date(), 'Europe/Berlin');
  const yesterday = addCalendarDays(today, -1);
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Tagebuch GmbH');
    other = await createCompany(app, prisma, 'Andere GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    ({ projectId } = await createProject(app, company.token));
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
        email: 'kai@tagebuch.test',
        passwordHash: await bcrypt.hash('test12345', 4),
        firstName: 'Kai',
        lastName: 'Kelle',
        roles: { create: { roleId: role.id } },
      },
    });
    const login = await api().post('/auth/login').send({ email: 'kai@tagebuch.test', password: 'test12345' });
    worker = { Authorization: `Bearer ${login.body.accessToken}` };
  });

  afterAll(async () => {
    await app.close();
  });

  it('Eintrag je Tag, von der Baustelle, mit Verzögerung und Fotos', async () => {
    const saved = await api()
      .put(`/projects/${projectId}/diary/${yesterday}`)
      .set(worker)
      .send({
        weather: 'rain',
        temperature: 8,
        crew: 'Kai, Lena',
        crewCount: 2,
        work: 'Unterbau Terrasse verdichtet',
        delayHours: 3,
        delayReason: 'weather',
        delayNote: 'Starkregen ab 13 Uhr',
      })
      .expect(200);
    expect(saved.body).toMatchObject({ day: yesterday, weather: 'rain', delayHours: 3 });

    // Verzögerung ohne Ursache: abgelehnt
    await api().put(`/projects/${projectId}/diary/${today}`).set(worker).send({ delayHours: 2 }).expect(400);
    await api()
      .put(`/projects/${projectId}/diary/${today}`)
      .set(auth)
      .send({
        work: 'Randsteine gesetzt',
        delayHours: 1.5,
        delayReason: 'material',
        delayNote: 'Lieferung zu spät',
      })
      .expect(200);
    // Foto von heute erscheint beim Eintrag
    await api()
      .post(`/site/projects/${projectId}/photos`)
      .set(worker)
      .attach('file', png, { filename: 'randsteine.png', contentType: 'image/png' })
      .expect(201);

    const list = await api().get(`/projects/${projectId}/diary`).set(auth).expect(200);
    expect(list.body.entries.map((e: { day: string }) => e.day)).toEqual([today, yesterday]);
    expect(list.body.entries[0].photos).toHaveLength(1);
    expect(list.body.delays).toMatchObject({ hours: 4.5, days: 2 });
    expect(list.body.delays.byReason).toEqual(
      expect.arrayContaining([
        { reason: 'weather', hours: 3, days: 1 },
        { reason: 'material', hours: 1.5, days: 1 },
      ]),
    );
  });

  it('ändern: nur geänderte Felder im Audit-Log; leeren mit null', async () => {
    await api()
      .put(`/projects/${projectId}/diary/${yesterday}`)
      .set(auth)
      .send({ delayHours: 4, temperature: null })
      .expect(200);
    const logs = await prisma.auditLog.findMany({
      where: { companyId: company.companyId, entity: 'SiteDiaryEntry' },
      orderBy: { createdAt: 'asc' },
    });
    expect(logs.map((l) => l.action)).toEqual([
      'site_diary_created',
      'site_diary_created',
      'site_diary_changed',
    ]);
    expect(logs[2].oldData).toEqual({ day: yesterday, delayHours: 3, temperature: 8 });
    expect(logs[2].newData).toEqual({ day: yesterday, delayHours: 4, temperature: null });
    // gleicher Stand noch einmal: kein neuer Eintrag im Protokoll
    await api()
      .put(`/projects/${projectId}/diary/${yesterday}`)
      .set(auth)
      .send({ delayHours: 4 })
      .expect(200);
    expect(
      await prisma.auditLog.count({ where: { companyId: company.companyId, entity: 'SiteDiaryEntry' } }),
    ).toBe(3);
    // Ursache entfernen, solange Stunden stehen: abgelehnt
    await api()
      .put(`/projects/${projectId}/diary/${yesterday}`)
      .set(auth)
      .send({ delayReason: null })
      .expect(400);
  });

  it('keine Einträge in der Zukunft, Rechte und Mandanten', async () => {
    await api()
      .put(`/projects/${projectId}/diary/${addCalendarDays(today, 1)}`)
      .set(auth)
      .send({ work: 'morgen' })
      .expect(400);
    await api().put(`/projects/${projectId}/diary/2026-02-30`).set(auth).send({}).expect(400);
    await api().put(`/projects/${projectId}/diary/${today}`).set(auth).send({ weather: 'hagel' }).expect(400);
    const otherAuth = { Authorization: `Bearer ${other.token}` };
    await api().get(`/projects/${projectId}/diary`).set(otherAuth).expect(404);
    await api().put(`/projects/${projectId}/diary/${today}`).set(otherAuth).send({ work: 'x' }).expect(404);
  });
});
