import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { addCalendarDays, localDayString } from '../../src/common/time-zone';
import { createApp, createCompany, fetchPdfText, resetDatabase, TestCompany } from './helpers';

// Pflege- und Wartungsverträge: Einsätze als Termine, Vergütung je Zeitraum
// als Rechnung, Storno gibt den Zeitraum frei, Mandantentrennung.
describe('Pflegeverträge', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let other: TestCompany;
  let auth: { Authorization: string };
  let projectId: string;
  const api = () => request(app.getHttpServer());
  const today = localDayString(new Date(), 'Europe/Berlin');
  const month = (day: string) => Number(day.slice(5, 7));

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Pflege GmbH');
    other = await createCompany(app, prisma, 'Andere GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    await api()
      .patch('/company/settings')
      .set(auth)
      .send({
        street: 'Gartenstraße 1',
        postalCode: '50667',
        city: 'Köln',
        taxNumber: '214/5678/1234',
        email: 'info@pflege.example',
        phone: '+49 221 12345',
        iban: 'DE89370400440532013000',
      })
      .expect(200);
    const customer = await api()
      .post('/customers')
      .set(auth)
      .send({
        name: 'Hausverwaltung Rhein',
        email: 'rhein@example.com',
        street: 'Ring 5',
        postalCode: '50667',
        city: 'Köln',
      })
      .expect(201);
    const property = await api()
      .post('/properties')
      .set(auth)
      .send({ customerId: customer.body.id, label: 'Wohnanlage' })
      .expect(201);
    const project = await api()
      .post('/projects')
      .set(auth)
      .send({ propertyId: property.body.id, title: 'Grünpflege Wohnanlage' })
      .expect(201);
    projectId = project.body.id;
  });

  afterAll(async () => {
    await app.close();
  });

  const body = (patch: object = {}) => ({
    projectId,
    title: 'Grünpflege 2026',
    startDate: addCalendarDays(today, -40),
    billingInterval: 'monthly',
    lines: [
      { description: 'Rasenpflege pauschal', unit: 'psch', quantity: 1, unitPrice: 180 },
      { description: 'Heckenschnitt', unit: 'h', quantity: 2.5, unitPrice: 48.5 },
    ],
    tasks: [
      {
        title: 'Rasen mähen',
        everyWeeks: 1,
        seasonFrom: 1,
        seasonTo: 12,
        nextDue: today,
        assignedUserId: company.userId,
      },
      // nur im Monat von heute: in 5 Wochen außerhalb der Saison
      { title: 'Laub', everyWeeks: 5, seasonFrom: month(today), seasonTo: month(today), nextDue: today },
    ],
    ...patch,
  });

  it('legt Verträge an, rechnet und plant sie', async () => {
    const created = await api().post('/contracts').set(auth).send(body()).expect(201);
    const id = created.body.id;
    // 180 + 2,5 × 48,50 = 301,25 € netto je Monat; Beginn vor 40 Tagen -> fällig
    expect(created.body).toMatchObject({
      netPerPeriod: '301.25',
      billingDue: true,
      tasksDue: true,
      vatRate: '19',
      nextPeriod: { start: addCalendarDays(today, -40) },
    });

    // Termine für drei Wochen: Rasen 4×, Laub 1× (in 5 Wochen außerhalb der Saison)
    const until = addCalendarDays(today, 21);
    const planned = await api().post('/contracts/schedule').set(auth).send({ until }).expect(201);
    expect(planned.body).toEqual({ created: 5, unassigned: 0 });
    const appointments = await api().get(`/appointments/by-project/${projectId}`).set(auth).expect(200);
    expect(appointments.body).toHaveLength(5);
    expect(appointments.body.filter((a: { title: string }) => a.title === 'Rasen mähen')).toHaveLength(4);
    // zweiter Aufruf legt nichts doppelt an
    expect((await api().post('/contracts/schedule').set(auth).send({ until }).expect(201)).body.created).toBe(
      0,
    );
    await api()
      .post('/contracts/schedule')
      .set(auth)
      .send({ until: addCalendarDays(today, 400) })
      .expect(400);

    // Abrechnen: zwei Monate seit Beginn fällig
    const due = await api().post('/contracts/invoice-due').set(auth).expect(201);
    expect(due.body.created).toBe(2);
    const invoices = await api().get(`/invoices/by-project/${projectId}`).set(auth).expect(200);
    expect(invoices.body).toHaveLength(2);
    const [first, second] = invoices.body;
    expect(first).toMatchObject({ kind: 'periodic', contractId: id, orderId: null, totalNet: '301.25' });
    expect(first.servicePeriodStart.slice(0, 10)).toBe(addCalendarDays(today, -40));
    expect(second.servicePeriodStart.slice(0, 10) > first.servicePeriodEnd.slice(0, 10)).toBe(true);
    expect((await api().post('/contracts/invoice-due').set(auth).expect(201)).body.created).toBe(0);

    // Ausstellen, PDF, Storno gibt den Zeitraum wieder frei
    const issued = await api().post(`/invoices/${first.id}/issue`).set(auth).send({}).expect(201);
    const pdf = await fetchPdfText(app, `/invoices/${first.id}/pdf`, company.token);
    expect(pdf.text).toContain('Rasenpflege pauschal');
    const xml = await api()
      .get(`/invoices/${first.id}/xrechnung`)
      .set(auth)
      .buffer(true)
      .parse((res, done) => {
        let text = '';
        res.on('data', (chunk: Buffer) => (text += chunk.toString('utf8')));
        res.on('end', () => done(null, text));
      })
      .expect(200);
    expect(xml.body).toContain('<ram:TypeCode>380</ram:TypeCode>');
    expect(xml.body).toContain('<ram:BillingSpecifiedPeriod>');
    // Mit XRECHNUNG_OUT=<Verzeichnis> für den KoSIT-Validator speichern
    if (process.env.XRECHNUNG_OUT) {
      mkdirSync(process.env.XRECHNUNG_OUT, { recursive: true });
      writeFileSync(join(process.env.XRECHNUNG_OUT, 'int-contract.xml'), xml.body as string);
    }
    await api()
      .post(`/invoices/${first.id}/cancel`)
      .set(auth)
      .send({ reason: 'Falscher Betrag' })
      .expect(201);
    const cancellation = await prisma.invoice.findFirstOrThrow({
      where: { cancelsInvoiceId: issued.body.id },
    });
    expect(cancellation.contractId).toBe(id);
    // der zweite Entwurf deckt den späteren Zeitraum: nach dem Löschen ist der erste wieder dran
    await api().delete(`/invoices/${second.id}`).set(auth).expect(200);
    const again = await api().post(`/contracts/${id}/invoice`).set(auth).expect(201);
    expect(again.body.servicePeriodStart.slice(0, 10)).toBe(addCalendarDays(today, -40));

    // Rechnungen: löschen nicht mehr möglich, beenden schon (sagt künftige Termine ab)
    await api().delete(`/contracts/${id}`).set(auth).expect(400);
    const contract = (await api().get(`/contracts/${id}`).set(auth).expect(200)).body;
    const ended = await api()
      .put(`/contracts/${id}`)
      .set(auth)
      .send({
        ...body(),
        status: 'ended',
        tasks: contract.tasks.map((t: Record<string, unknown>) => ({
          id: t.id,
          title: t.title,
          everyWeeks: t.everyWeeks,
          nextDue: String(t.nextDue).slice(0, 10),
        })),
      })
      .expect(200);
    expect(ended.body.status).toBe('ended');
    const future = await prisma.appointment.count({
      where: { projectId, status: 'planned', startTime: { gt: new Date() } },
    });
    expect(future).toBe(0);
    await api().post(`/contracts/${id}/invoice`).set(auth).expect(400);
    const audit = await prisma.auditLog.findMany({ where: { entityId: id }, orderBy: { createdAt: 'asc' } });
    expect(audit.map((a) => a.action)).toEqual(['contract.create', 'contract.status']);
  });

  it('rechnet den letzten, gekürzten Zeitraum anteilig ab', async () => {
    // Monatsvertrag endet 15 Tage nach Beginn eines Zeitraums von 1.3. bis 31.3.
    const created = await api()
      .post('/contracts')
      .set(auth)
      .send(
        body({
          title: 'Kurzvertrag',
          startDate: '2026-03-01',
          endDate: '2026-03-15',
          tasks: [],
          lines: [{ description: 'Pflege pauschal', unit: 'psch', quantity: 2, unitPrice: 310 }],
        }),
      )
      .expect(201);
    const invoice = await api().post(`/contracts/${created.body.id}/invoice`).set(auth).expect(201);
    // 310 € × 15/31 = 150,00 € je Einheit, 2 Einheiten
    expect(invoice.body).toMatchObject({
      totalNet: '300',
      servicePeriodEnd: expect.stringMatching(/^2026-03-15/),
    });
    expect(invoice.body.lineItems[0]).toMatchObject({
      description: 'Pflege pauschal (anteilig 15 von 31 Tagen)',
      quantity: '2',
      unitPrice: '150',
    });
    await api().post(`/contracts/${created.body.id}/invoice`).set(auth).expect(400);
  });

  it('prüft Eingaben, Rechte und Mandanten', async () => {
    await api()
      .post('/contracts')
      .set(auth)
      .send(body({ endDate: addCalendarDays(today, -50) }))
      .expect(400);
    const otherAuth = { Authorization: `Bearer ${other.token}` };
    // fremdes Projekt, fremder Mitarbeiter
    await api().post('/contracts').set(otherAuth).send(body()).expect(404);
    const otherCustomer = await api()
      .post('/customers')
      .set(otherAuth)
      .send({ name: 'Kunde Fremd' })
      .expect(201);
    const otherProperty = await api()
      .post('/properties')
      .set(otherAuth)
      .send({ customerId: otherCustomer.body.id, label: 'Garten Fremd' })
      .expect(201);
    const otherProject = await api()
      .post('/projects')
      .set(otherAuth)
      .send({ propertyId: otherProperty.body.id, title: 'Projekt Fremd' })
      .expect(201);
    await api()
      .post('/contracts')
      .set(otherAuth)
      .send(body({ projectId: otherProject.body.id }))
      .expect(400);

    const mine = await api()
      .post('/contracts')
      .set(auth)
      .send(body({ title: 'Winterdienst', tasks: [] }))
      .expect(201);
    await api().get(`/contracts/${mine.body.id}`).set(otherAuth).expect(404);
    expect((await api().get('/contracts').set(otherAuth).expect(200)).body).toHaveLength(0);
    await api().post(`/contracts/${mine.body.id}/invoice`).set(otherAuth).expect(404);

    // ohne Verkaufspreise: keine Preise in der Antwort, anlegen verboten
    const role = await prisma.role.create({
      data: {
        companyId: company.companyId,
        name: 'Nur lesen',
        permissions: {
          create: (
            await prisma.permission.findMany({ where: { key: { in: ['customer.read', 'customer.write'] } } })
          ).map((p) => ({ permissionId: p.id })),
        },
      },
    });
    await prisma.user.create({
      data: {
        companyId: company.companyId,
        email: 'leser@pflege.test',
        passwordHash: await (await import('bcrypt')).hash('test12345', 4),
        firstName: 'Lea',
        lastName: 'Leser',
        roles: { create: { roleId: role.id } },
      },
    });
    const login = await api().post('/auth/login').send({ email: 'leser@pflege.test', password: 'test12345' });
    const readerAuth = { Authorization: `Bearer ${login.body.accessToken}` };
    const seen = await api().get(`/contracts/${mine.body.id}`).set(readerAuth).expect(200);
    expect(seen.body.netPerPeriod).toBeUndefined();
    expect(seen.body.lines[0].unitPrice).toBeUndefined();
    expect(seen.body.lines[0].description).toBe('Rasenpflege pauschal');
    await api().post('/contracts').set(readerAuth).send(body()).expect(403);
    await api().post('/contracts/invoice-due').set(readerAuth).expect(403);

    // Datenbank: Rechnung ohne Auftrag und Vertrag ist unmöglich
    await expect(
      prisma.invoice.create({
        data: {
          companyId: company.companyId,
          projectId,
          kind: 'final',
          vatRate: 19,
          totalNet: 0,
          totalVat: 0,
          totalGross: 0,
        },
      }),
    ).rejects.toThrow(/Invoice_source_check/);
  });
});
