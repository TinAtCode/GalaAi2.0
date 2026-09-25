import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';

// Versicherungen und Verträge: Fristen, Kosten pro Jahr, Fixkosten-Verknüpfung
describe('Versicherungen und Verträge', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let other: TestCompany;
  let chef: { Authorization: string };
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Vertrag GmbH');
    other = await createCompany(app, prisma, 'Andere GmbH');
    chef = { Authorization: `Bearer ${company.token}` };
  });

  afterAll(async () => {
    await app.close();
  });

  it('berechnet Fristen und Jahreskosten und führt den Beitrag als Fixkosten', async () => {
    const insurance = (
      await api()
        .post('/finance/contracts')
        .set(chef)
        .send({
          name: 'Betriebshaftpflicht',
          kind: 'insurance',
          provider: 'Muster Versicherung',
          amount: 120,
          interval: 'quarterly',
          termEnd: '2020-12-31',
          renewalMonths: 12,
          noticeMonths: 3,
          asFixedCost: true,
          firstDue: '2026-10-01',
        })
        .expect(201)
    ).body;
    expect(insurance.yearly).toBe(480);
    expect(insurance.endsOn >= '2026-12-31').toBe(true);
    expect(insurance.recurringPaymentId).toBeTruthy();
    const recurring = await prisma.recurringPayment.findUniqueOrThrow({
      where: { id: insurance.recurringPaymentId },
    });
    expect(recurring).toMatchObject({ name: 'Betriebshaftpflicht', interval: 'quarterly', endDate: null });
    expect(recurring.amount.toNumber()).toBe(120);

    await api()
      .post('/finance/contracts')
      .set(chef)
      .send({
        name: 'Leasing Pritsche',
        kind: 'lease',
        amount: 399,
        interval: 'monthly',
        termEnd: '2099-01-31',
      })
      .expect(201);
    await api()
      .post('/finance/contracts')
      .set(chef)
      .send({ name: 'Fixkosten ohne Betrag', kind: 'other', asFixedCost: true })
      .expect(400);

    const list = (await api().get('/finance/contracts').set(chef).expect(200)).body;
    expect(list.summary.yearlyTotal).toBe(480 + 399 * 12);
    expect(list.summary.byKind).toEqual({ insurance: 480, lease: 4788 });

    // Kündigen: Fixkosten enden mit der Laufzeit; Audit-Log
    const cancelled = (
      await api()
        .put(`/finance/contracts/${insurance.id}`)
        .set(chef)
        .send({ name: 'Betriebshaftpflicht', kind: 'insurance', cancelledOn: '2026-09-01' })
        .expect(200)
    ).body;
    expect(cancelled.state).toMatch(/cancelled|expired/);
    const ended = await prisma.recurringPayment.findUniqueOrThrow({
      where: { id: insurance.recurringPaymentId },
    });
    expect(ended.endDate?.toISOString().slice(0, 10)).toBe(cancelled.endsOn);
    const audit = await prisma.auditLog.findMany({
      where: { companyId: company.companyId, entity: 'BusinessContract' },
      orderBy: { createdAt: 'asc' },
    });
    expect(audit.map((a) => a.action)).toEqual([
      'business_contract_created',
      'business_contract_created',
      'business_contract_cancelled',
    ]);

    // Fixkosten abwählen entfernt die Zeile; Löschen ebenso
    await api()
      .put(`/finance/contracts/${insurance.id}`)
      .set(chef)
      .send({ name: 'Betriebshaftpflicht', kind: 'insurance', asFixedCost: false })
      .expect(200);
    expect(await prisma.recurringPayment.count({ where: { id: insurance.recurringPaymentId } })).toBe(0);

    // andere Firma: nichts zu sehen
    const foreign = { Authorization: `Bearer ${other.token}` };
    expect((await api().get('/finance/contracts').set(foreign).expect(200)).body.contracts).toHaveLength(0);
    await api()
      .put(`/finance/contracts/${insurance.id}`)
      .set(foreign)
      .send({ name: 'x x', kind: 'other' })
      .expect(404);
    await api().delete(`/finance/contracts/${insurance.id}`).set(foreign).expect(404);
    await api().delete(`/finance/contracts/${insurance.id}`).set(chef).expect(200);
  });

  it('nur mit finance.read', async () => {
    const role = await prisma.role.create({
      data: {
        companyId: company.companyId,
        name: 'Mitarbeiter',
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
        email: 'm@vertrag.test',
        passwordHash: await bcrypt.hash('test12345', 4),
        firstName: 'M',
        lastName: 'A',
        roles: { create: { roleId: role.id } },
      },
    });
    const login = await api().post('/auth/login').send({ email: 'm@vertrag.test', password: 'test12345' });
    await api()
      .get('/finance/contracts')
      .set({ Authorization: `Bearer ${login.body.accessToken}` })
      .expect(403);
  });
});
