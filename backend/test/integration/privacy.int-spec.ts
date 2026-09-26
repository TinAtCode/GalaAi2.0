import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';

// Datenschutz: Auskunft und Anonymisieren von Kunden und Nutzern
describe('Datenschutz (Auskunft, Anonymisieren)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let admin: TestCompany;
  let other: TestCompany;
  let auth: { Authorization: string };

  const api = () => request(app.getHttpServer());
  const bearer = (token: string) => ({ Authorization: `Bearer ${token}` });

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    admin = await createCompany(app, prisma, 'Privat GmbH');
    other = await createCompany(app, prisma, 'Fremd GmbH');
    auth = bearer(admin.token);
  });

  afterAll(async () => {
    await app.close();
  });

  async function issuedInvoice(projectId: string, number: string) {
    const quote = await prisma.quote.create({
      data: { companyId: admin.companyId, projectId, status: 'accepted', totalNet: 100 },
    });
    const order = await prisma.order.create({
      data: { companyId: admin.companyId, projectId, quoteId: quote.id, totalNet: 100 },
    });
    return prisma.invoice.create({
      data: {
        companyId: admin.companyId,
        projectId,
        orderId: order.id,
        kind: 'final',
        status: 'issued',
        number,
        issueDate: new Date(),
        vatRate: 19,
        totalNet: 100,
        totalVat: 19,
        totalGross: 119,
        buyerSnapshot: { name: 'Familie Muster', city: 'Köln' },
      },
    });
  }

  it('Kunde: Auskunft enthält Stammdaten, Objekte, Projekte und Rechnungen', async () => {
    const { customerId, projectId } = await createProject(app, admin.token);
    await issuedInvoice(projectId, 'R-TEST-1');
    const res = await api().get(`/customers/${customerId}/export`).set(auth).expect(200);
    expect(res.body.customer.name).toBe('Familie Muster');
    expect(res.body.properties).toHaveLength(1);
    expect(res.body.projects).toHaveLength(1);
    expect(res.body.invoices[0].number).toBe('R-TEST-1');
    // fremde Firma sieht den Kunden nicht
    await api().get(`/customers/${customerId}/export`).set(bearer(other.token)).expect(404);
  });

  it('Kunde: nicht mit offener Rechnung oder laufendem Vertrag, danach anonymisiert; Rechnung bleibt', async () => {
    const { customerId, propertyId, projectId } = await createProject(app, admin.token);
    await api().patch(`/customers/${customerId}`).set(auth).send({ email: 'muster@example.org' }).expect(200);
    // älterer Protokolleintrag mit Personenbezug
    await prisma.auditLog.create({
      data: {
        companyId: admin.companyId,
        userId: admin.userId,
        action: 'update',
        entity: 'Customer',
        entityId: customerId,
        oldData: { email: null, name: 'Familie Muster' },
        newData: { email: 'muster@example.org', paymentTermDays: 14 },
      },
    });
    const invoice = await issuedInvoice(projectId, 'R-TEST-2');

    const blocked = await api().post(`/customers/${customerId}/anonymize`).set(auth).expect(409);
    expect(blocked.body.message).toContain('R-TEST-2');

    await prisma.invoicePayment.create({
      data: { companyId: admin.companyId, invoiceId: invoice.id, amount: 119, paidOn: new Date() },
    });
    const contract = await prisma.maintenanceContract.create({
      data: { companyId: admin.companyId, projectId, title: 'Pflege', startDate: new Date(), vatRate: 19 },
    });
    await api().post(`/customers/${customerId}/anonymize`).set(auth).expect(409);
    await prisma.maintenanceContract.update({ where: { id: contract.id }, data: { status: 'ended' } });

    // fremde Firma kann nicht anonymisieren
    await api().post(`/customers/${customerId}/anonymize`).set(bearer(other.token)).expect(404);

    const res = await api().post(`/customers/${customerId}/anonymize`).set(auth).expect(201);
    expect(res.body.name).toMatch(/^Anonymisiert /);
    expect(res.body.email).toBeNull();
    expect(res.body.anonymizedAt).not.toBeNull();

    const property = await prisma.property.findUniqueOrThrow({ where: { id: propertyId } });
    expect(property.city).toBeNull();
    // Beleg bleibt unverändert (Aufbewahrungspflicht)
    const kept = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(kept.buyerSnapshot).toEqual({ name: 'Familie Muster', city: 'Köln' });

    // alte Protokolleinträge ohne Klarnamen und E-Mail, Aktion bleibt sichtbar
    const audit = await prisma.auditLog.findMany({ where: { entity: 'Customer', entityId: customerId } });
    expect(JSON.stringify(audit)).not.toContain('muster@example.org');
    expect(JSON.stringify(audit)).not.toContain('Familie Muster');
    expect(audit.find((a) => a.action === 'update')?.newData).toEqual({
      email: '[anonymisiert]',
      paymentTermDays: 14,
    });
    expect(audit.map((a) => a.action)).toContain('customer_anonymize');

    await api().post(`/customers/${customerId}/anonymize`).set(auth).expect(409);
  });

  it('Nutzer: Auskunft ohne Passwort-Hash, Anonymisieren sperrt die Anmeldung', async () => {
    const created = await api()
      .post('/users')
      .set(auth)
      .send({
        email: 'weg@privat.test',
        firstName: 'Willi',
        lastName: 'Weg',
        password: 'startpasswort1',
        createEmployee: true,
      })
      .expect(201);
    const userId = created.body.id as string;
    const login = await api()
      .post('/auth/login')
      .send({ email: 'weg@privat.test', password: 'startpasswort1' })
      .expect(201);
    await prisma.absence.create({
      data: {
        companyId: admin.companyId,
        userId,
        kind: 'sick',
        startDate: new Date('2026-03-02'),
        endDate: new Date('2026-03-03'),
        note: 'Arzttermin',
        createdByUserId: admin.userId,
      },
    });

    const exported = await api().get(`/users/${userId}/export`).set(auth).expect(200);
    expect(exported.body.user.email).toBe('weg@privat.test');
    expect(exported.body.user.passwordHash).toBeUndefined();
    expect(exported.body.absences).toHaveLength(1);

    // nicht sich selbst, nicht fremde Firma
    await api().post(`/users/${admin.userId}/anonymize`).set(auth).expect(400);
    await api().post(`/users/${userId}/anonymize`).set(bearer(other.token)).expect(404);

    const res = await api().post(`/users/${userId}/anonymize`).set(auth).expect(201);
    expect(res.body.email).not.toContain('weg@');
    expect(res.body.active).toBe(false);
    expect(res.body.passwordHash).toBeUndefined();

    // alte Sitzung ungültig, Anmeldung mit altem Passwort nicht möglich
    await api().get('/auth/me').set(bearer(login.body.accessToken)).expect(401);
    await api()
      .post('/auth/login')
      .send({ email: 'weg@privat.test', password: 'startpasswort1' })
      .expect(401);

    // nicht wieder aktivierbar, kein neues Passwort
    await api().patch(`/users/${userId}`).set(auth).send({ active: true }).expect(400);
    await api().post(`/users/${userId}/password`).set(auth).send({ password: 'neuespasswort1' }).expect(400);

    const employee = await prisma.employee.findFirstOrThrow({ where: { userId } });
    expect(employee.firstName).toBe('Anonymisiert');
    const absence = await prisma.absence.findFirstOrThrow({ where: { userId } });
    expect(absence.note).toBeNull();
    const audit = await prisma.auditLog.findMany({ where: { entity: 'User', entityId: userId } });
    expect(JSON.stringify(audit)).not.toContain('weg@privat.test');
  });

  it('ohne Rechte kein Zugriff', async () => {
    const role = await prisma.role.create({
      data: {
        companyId: admin.companyId,
        name: 'Nur lesen',
        permissions: { create: [{ permission: { connect: { key: 'customer.read' } } }] },
      },
    });
    await api()
      .post('/users')
      .set(auth)
      .send({
        email: 'leser@privat.test',
        firstName: 'L',
        lastName: 'L',
        password: 'startpasswort1',
        roleIds: [role.id],
      })
      .expect(201);
    const login = await api()
      .post('/auth/login')
      .send({ email: 'leser@privat.test', password: 'startpasswort1' })
      .expect(201);
    const { customerId } = await createProject(app, admin.token);
    const reader = bearer(login.body.accessToken);
    await api().get(`/customers/${customerId}/export`).set(reader).expect(403);
    await api().post(`/customers/${customerId}/anonymize`).set(reader).expect(403);
    await api().get(`/users/${admin.userId}/export`).set(reader).expect(403);
  });
});
