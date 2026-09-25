import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';

// Geräte: Schäden setzen den Zustand, Wartung rückt weiter, Inventur, Rechte, Mandanten
describe('Geräte und Fahrzeuge', () => {
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
    company = await createCompany(app, prisma, 'Geräte GmbH');
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
        email: 'ole@geraete.test',
        passwordHash: await bcrypt.hash('test12345', 4),
        firstName: 'Ole',
        lastName: 'Schaufel',
        roles: { create: { roleId: role.id } },
      },
    });
    const login = await api().post('/auth/login').send({ email: 'ole@geraete.test', password: 'test12345' });
    worker = { Authorization: `Bearer ${login.body.accessToken}` };
  });

  afterAll(async () => {
    await app.close();
  });

  it('Schäden melden setzt den Zustand, Erledigen hebt ihn auf', async () => {
    const bagger = (
      await api()
        .post('/equipment')
        .set(chef)
        .send({ name: 'Minibagger KX019', kind: 'machine', inventoryNumber: 'M-01' })
        .expect(201)
    ).body;
    // Mitarbeiter dürfen keine Geräte anlegen, aber Schäden melden
    await api().post('/equipment').set(worker).send({ name: 'Rüttler', kind: 'machine' }).expect(403);
    await api()
      .post('/equipment')
      .set(chef)
      .send({ name: 'Zweiter', kind: 'tool', inventoryNumber: 'M-01' })
      .expect(409);

    const minor = await api()
      .post(`/equipment/${bagger.id}/damages`)
      .set(worker)
      .send({ description: 'Spiegel gesprungen', severity: 'minor' })
      .expect(201);
    expect(minor.body.equipmentStatus).toBe('ready');
    const hard = await api()
      .post(`/equipment/${bagger.id}/damages`)
      .set(worker)
      .send({ description: 'Hydraulikschlauch geplatzt', severity: 'unusable' })
      .expect(201);
    expect(hard.body.equipmentStatus).toBe('broken');

    const list = (await api().get('/equipment').set(worker).expect(200)).body;
    expect(list[0]).toMatchObject({ name: 'Minibagger KX019', status: 'broken', openDamages: 2 });

    await api().put(`/equipment/damages/${hard.body.id}`).set(worker).send({ status: 'fixed' }).expect(403);
    const fixed = await api()
      .put(`/equipment/damages/${hard.body.id}`)
      .set(chef)
      .send({ status: 'fixed', repairCost: 180.5, resolutionNote: 'Schlauch getauscht' })
      .expect(200);
    expect(fixed.body).toMatchObject({ status: 'fixed', repairCost: 180.5, equipmentStatus: 'ready' });
    expect(fixed.body.resolvedAt).toBeTruthy();
    const open = (await api().get('/equipment/damages').set(worker).expect(200)).body;
    expect(open.map((d: { description: string }) => d.description)).toEqual(['Spiegel gesprungen']);

    const audit = await prisma.auditLog.findMany({
      where: { companyId: company.companyId, entity: 'EquipmentDamage' },
    });
    expect(audit.map((a) => a.action).sort()).toEqual([
      'equipment_damage_changed',
      'equipment_damage_reported',
      'equipment_damage_reported',
    ]);

    // andere Firma sieht und meldet nichts
    const foreign = { Authorization: `Bearer ${other.token}` };
    await api().get(`/equipment/${bagger.id}`).set(foreign).expect(404);
    await api()
      .post(`/equipment/${bagger.id}/damages`)
      .set(foreign)
      .send({ description: 'fremd', severity: 'minor' })
      .expect(404);
  });

  it('Wartung: erledigt rückt die Fälligkeit weiter und steht im Kalender', async () => {
    const lkw = (
      await api()
        .post('/equipment')
        .set(chef)
        .send({ name: 'Pritsche', kind: 'vehicle', licensePlate: 'hh-ga 123' })
        .expect(201)
    ).body;
    expect(lkw.licensePlate).toBe('HH-GA 123');
    const tuev = (
      await api()
        .post(`/equipment/${lkw.id}/maintenance`)
        .set(chef)
        .send({ title: 'HU/TÜV', intervalMonths: 12, nextDue: '2026-01-31' })
        .expect(201)
    ).body;
    const once = (
      await api()
        .post(`/equipment/${lkw.id}/maintenance`)
        .set(chef)
        .send({ title: 'Anhängerkupplung nachrüsten', nextDue: '2026-02-10' })
        .expect(201)
    ).body;

    const due = (await api().get('/equipment/maintenance/due?until=2026-02-28').set(worker).expect(200)).body;
    expect(due.map((d: { title: string; overdue: boolean }) => [d.title, d.overdue])).toEqual([
      ['HU/TÜV', true],
      ['Anhängerkupplung nachrüsten', true],
    ]);
    const calendar = (
      await api().get('/calendar/events?from=2026-01-26&to=2026-02-28').set(worker).expect(200)
    ).body;
    expect(calendar.maintenance.map((m: { title: string; due: string }) => [m.title, m.due])).toEqual([
      ['HU/TÜV', '2026-01-31'],
      ['Anhängerkupplung nachrüsten', '2026-02-10'],
    ]);

    await api()
      .post(`/equipment/maintenance/${tuev.id}/done`)
      .set(chef)
      .send({ doneOn: '2099-01-01' })
      .expect(400);
    const done = (
      await api()
        .post(`/equipment/maintenance/${tuev.id}/done`)
        .set(chef)
        .send({ doneOn: '2026-01-31', cost: 95 })
        .expect(201)
    ).body;
    expect(done).toMatchObject({ lastDone: '2026-01-31', nextDue: '2027-01-31', active: true });
    const onceDone = (
      await api()
        .post(`/equipment/maintenance/${once.id}/done`)
        .set(chef)
        .send({ doneOn: '2026-02-10' })
        .expect(201)
    ).body;
    expect(onceDone.active).toBe(false);

    const detail = (await api().get(`/equipment/${lkw.id}`).set(worker).expect(200)).body;
    const hu = detail.maintenance.find((m: { title: string }) => m.title === 'HU/TÜV');
    expect(hu.logs).toEqual([expect.objectContaining({ doneOn: '2026-01-31', cost: 95 })]);
  });

  it('Inventur: zählen, fehlende sehen, abschließen', async () => {
    const all = (await api().get('/equipment').set(chef).expect(200)).body as { id: string; name: string }[];
    const count = (
      await api().post('/inventory-counts').set(chef).send({ title: 'Inventur 2026' }).expect(201)
    ).body;
    await api().post('/inventory-counts').set(chef).send({ title: 'Doppelt' }).expect(409);
    await api().post('/inventory-counts').set(worker).send({ title: 'Mitarbeiter' }).expect(403);

    const [first, second] = all;
    await api()
      .put(`/inventory-counts/${count.id}/items/${first.id}`)
      .set(worker)
      .send({ found: true, location: 'Halle 2' })
      .expect(200);
    await api()
      .put(`/inventory-counts/${count.id}/items/${second.id}`)
      .set(worker)
      .send({ found: false, note: 'nicht auffindbar' })
      .expect(200);
    const state = (await api().get(`/inventory-counts/${count.id}`).set(worker).expect(200)).body;
    expect(state.summary).toEqual({ total: all.length, found: 1, missing: 1, open: all.length - 2 });

    await api().post(`/inventory-counts/${count.id}/close`).set(chef).expect(201);
    await api()
      .put(`/inventory-counts/${count.id}/items/${first.id}`)
      .set(worker)
      .send({ found: true })
      .expect(400);
    const counted = (await api().get(`/equipment/${first.id}`).set(chef).expect(200)).body;
    expect(counted.location).toBe('Halle 2');
    expect(counted.lastInventoryAt).toBeTruthy();
    // danach darf die nächste Inventur starten
    await api().post('/inventory-counts').set(chef).send({ title: 'Nachzählung' }).expect(201);
  });
});
