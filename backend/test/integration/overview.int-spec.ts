import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { EMPLOYEE_PERMISSIONS } from '../../src/common/permissions';
import { localDayString, addCalendarDays } from '../../src/common/time-zone';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';

// „Zu erledigen“ auf Mein Tag und die Suche nach Belegnummern: zählt je
// Firma und nur, wofür der Nutzer Rechte hat.
describe('Übersicht: Zu erledigen und Belegsuche', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let other: TestCompany;
  let auth: { Authorization: string };
  let projectId: string;
  const api = () => request(app.getHttpServer());
  const today = localDayString(new Date(), 'Europe/Berlin');
  const day = (d: string) => new Date(`${d}T00:00:00Z`);

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Ueberblick GmbH');
    other = await createCompany(app, prisma, 'Andere GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    ({ projectId } = await createProject(app, company.token));
    const c = company.companyId;

    // zwei offene Lieferscheine, einer schon zugeordnet
    for (const [i, status] of (['open', 'open', 'confirmed'] as const).entries()) {
      const doc = await prisma.document.create({
        data: {
          companyId: c,
          fileName: `ls${i}.pdf`,
          storagePath: `x/ls${i}.pdf`,
          documentType: 'delivery_note',
        },
      });
      await prisma.deliveryNote.create({ data: { companyId: c, documentId: doc.id, status } });
    }
    await prisma.checklistTemplate.create({
      data: { companyId: c, title: 'Zaun', items: [], status: 'proposed' },
    });
    const bagger = await prisma.equipment.create({
      data: { companyId: c, name: 'Bagger 1', kind: 'machine' },
    });
    await prisma.equipmentDamage.create({
      data: {
        companyId: c,
        equipmentId: bagger.id,
        reportedByUserId: company.userId,
        description: 'Hydraulik leckt',
        severity: 'limited',
      },
    });
    await prisma.equipmentMaintenance.createMany({
      data: [
        { companyId: c, equipmentId: bagger.id, title: 'UVV', nextDue: day(addCalendarDays(today, -3)) },
        {
          companyId: c,
          equipmentId: bagger.id,
          title: 'Ölwechsel',
          nextDue: day(addCalendarDays(today, 10)),
        },
        { companyId: c, equipmentId: bagger.id, title: 'TÜV', nextDue: day(addCalendarDays(today, 60)) },
      ],
    });
    await prisma.incomingInvoice.createMany({
      data: [
        { companyId: c, supplierName: 'Baustoff AG', amount: 100, dueDate: day(addCalendarDays(today, -1)) },
        { companyId: c, supplierName: 'Pflanzen KG', amount: 50, dueDate: day(addCalendarDays(today, 30)) },
      ],
    });
    // Angebot im Entwurf (Nummer A-…)
    await api()
      .post('/quotes')
      .set(auth)
      .send({
        projectId,
        lineItems: [{ description: 'Pauschale', unit: 'psch', quantity: 1, unitPrice: 100 }],
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });

  it('zählt, was ansteht, mit Links und Beispielen', async () => {
    const res = await api().get('/overview/todos').set(auth).expect(200);
    const byKey = Object.fromEntries(res.body.map((t: { key: string }) => [t.key, t]));
    expect(byKey.delivery_notes).toMatchObject({ count: 2, to: '/lieferscheine' });
    expect(byKey.checklist_proposals).toMatchObject({ count: 1, to: '/checklisten' });
    expect(byKey.damages).toMatchObject({ count: 1, examples: [{ label: 'Bagger 1' }] });
    // fällig in 14 Tagen: UVV (überfällig) und Ölwechsel, nicht der TÜV in 60 Tagen
    expect(byKey.maintenance).toMatchObject({ count: 2, meta: 'davon 1 überfällig' });
    expect(byKey.payables).toMatchObject({
      count: 1,
      meta: 'davon 1 überfällig',
      to: '/finanzen?tab=payables',
    });
    expect(byKey.quotes_draft.count).toBe(1);
    expect(byKey.quotes_draft.examples[0].to).toBe(`/projekte/${projectId}#angebote`);
    // nichts offen → kein Eintrag
    expect(byKey.quotes_sent).toBeUndefined();
    expect(byKey.time_entries).toBeUndefined();
  });

  it('andere Firma sieht nichts davon; ohne Rechte fehlen die Einträge', async () => {
    const res = await api()
      .get('/overview/todos')
      .set({ Authorization: `Bearer ${other.token}` })
      .expect(200);
    expect(res.body).toEqual([]);

    // Mitarbeiter: nur Baustellen-Rechte → keine Büro-Aufgaben
    const role = await prisma.role.create({
      data: {
        companyId: company.companyId,
        name: 'Nur Baustelle',
        permissions: {
          create: (await prisma.permission.findMany({ where: { key: { in: EMPLOYEE_PERMISSIONS } } })).map(
            (p) => ({
              permissionId: p.id,
            }),
          ),
        },
      },
    });
    const user = await prisma.user.create({
      data: {
        companyId: company.companyId,
        email: 'worker@ueberblick.test',
        passwordHash: (await prisma.user.findUniqueOrThrow({ where: { id: company.userId } })).passwordHash,
        firstName: 'Wim',
        lastName: 'Worker',
        roles: { create: { roleId: role.id } },
      },
    });
    const login = await api()
      .post('/auth/login')
      .send({ email: user.email, password: 'test12345' })
      .expect(201);
    const worker = await api()
      .get('/overview/todos')
      .set({ Authorization: `Bearer ${login.body.accessToken}` })
      .expect(200);
    expect(worker.body).toEqual([]);
    const search = await api()
      .get('/overview/search?q=A-')
      .set({ Authorization: `Bearer ${login.body.accessToken}` })
      .expect(200);
    expect(search.body).toEqual([]);
  });

  it('Belegsuche findet Angebotsnummern der eigenen Firma', async () => {
    const quote = await prisma.quote.findFirstOrThrow({ where: { companyId: company.companyId } });
    const res = await api().get(`/overview/search?q=${quote.number}`).set(auth).expect(200);
    expect(res.body).toEqual([
      { label: quote.number, meta: 'Angebot · Terrasse anlegen', to: `/projekte/${projectId}#angebote` },
    ]);
    const foreign = await api()
      .get(`/overview/search?q=${quote.number}`)
      .set({ Authorization: `Bearer ${other.token}` })
      .expect(200);
    expect(foreign.body).toEqual([]);
    await api().get('/overview/search?q=A').set(auth).expect(200, []);
  });
});
