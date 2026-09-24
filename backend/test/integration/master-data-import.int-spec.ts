import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';

// Stammdaten-Import: einlesen, zuordnen, abgleichen, ausgewählt übernehmen.
describe('Stammdaten-Import', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let other: TestCompany;
  let auth: { Authorization: string };
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Import GmbH');
    other = await createCompany(app, prisma, 'Fremd Import GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    await prisma.customer.create({
      data: {
        companyId: company.companyId,
        name: 'Müller GmbH',
        email: 'info@mueller.example',
        postalCode: '50667',
        city: 'Köln',
        debtorNumber: 10001,
      },
    });
    await prisma.customer.create({
      data: { companyId: company.companyId, name: 'Gartenbau Maier', postalCode: '80331', city: 'München' },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('Kunden aus CSV: Vorschau, Auswahl, Übernahme', async () => {
    const csv = [
      'Kundennr;Firma;E-Mail;Straße;PLZ;Ort;Gewerblich',
      '10001;Müller GmbH;info@mueller.example;Ringstraße 5;50667;Köln;ja', // Straße neu -> geändert
      ';Gartenbau Meier;;;80333;München;', // ähnlich wie Maier -> mögliche Dublette
      ';Familie Linde;linde@example.com;Lindenweg 3;1067;Dresden;nein', // neu, PLZ mit Null
      ';Kaputt;keine-mail;;;;', // fehlerhaft
    ].join('\r\n');
    const upload = await api()
      .post('/master-data-import/upload')
      .set(auth)
      .attach('file', Buffer.from(csv, 'latin1'), { filename: 'kunden.csv', contentType: 'text/csv' })
      .expect(201);
    expect(upload.body).toMatchObject({ entity: 'customers', rowCount: 4, source: 'kunden.csv' });
    const mapping = upload.body.entities.find((e: { type: string }) => e.type === 'customers').suggested;
    expect(mapping).toMatchObject({
      name: 'Firma',
      email: 'E-Mail',
      street: 'Straße',
      postalCode: 'PLZ',
      city: 'Ort',
      isBusiness: 'Gewerblich',
      debtorNumber: 'Kundennr',
    });

    const preview = await api()
      .post(`/master-data-import/${upload.body.sessionId}/preview`)
      .set(auth)
      .send({ entity: 'customers', mapping })
      .expect(201);
    expect(preview.body.summary).toEqual({
      total: 4,
      new: 1,
      update: 1,
      unchanged: 0,
      duplicate: 1,
      invalid: 1,
    });
    const [mueller, meier, linde, broken] = preview.body.rows;
    expect(mueller).toMatchObject({ status: 'update', matchedBy: 'Debitorennummer', preselected: true });
    expect(mueller.changes.map((c: { field: string }) => c.field).sort()).toEqual(['isBusiness', 'street']);
    expect(meier).toMatchObject({ status: 'duplicate', preselected: false });
    expect(meier.similar[0].label).toContain('Gartenbau Maier');
    expect(linde.values.postalCode).toBe('01067');
    expect(broken.errors[0]).toContain('E-Mail');

    // fremde Firma sieht die Sitzung nicht
    await api()
      .post(`/master-data-import/${upload.body.sessionId}/preview`)
      .set({ Authorization: `Bearer ${other.token}` })
      .send({ entity: 'customers', mapping })
      .expect(404);
    // Pflichtfeld nicht zugeordnet, unbekannte Spalte
    await api()
      .post(`/master-data-import/${upload.body.sessionId}/preview`)
      .set(auth)
      .send({ entity: 'customers', mapping: { ...mapping, name: null } })
      .expect(400);
    await api()
      .post(`/master-data-import/${upload.body.sessionId}/preview`)
      .set(auth)
      .send({ entity: 'customers', mapping: { ...mapping, city: 'Gibt es nicht' } })
      .expect(400);

    // Übernahme: Müller, Linde und die fehlerhafte Zeile (wird übersprungen), Meier nicht
    const applied = await api()
      .post(`/master-data-import/${upload.body.sessionId}/apply`)
      .set(auth)
      .send({ entity: 'customers', mapping, accept: [0, 2, 3] })
      .expect(201);
    expect(applied.body).toMatchObject({ created: 1, updated: 1 });
    expect(applied.body.skipped).toEqual([
      { row: 5, reason: 'E-Mail: „keine-mail“ ist keine E-Mail-Adresse' },
    ]);
    const customers = await prisma.customer.findMany({
      where: { companyId: company.companyId },
      orderBy: { name: 'asc' },
    });
    expect(customers.map((c) => c.name)).toEqual(['Familie Linde', 'Gartenbau Maier', 'Müller GmbH']);
    expect(customers[2]).toMatchObject({
      street: 'Ringstraße 5',
      isBusiness: true,
      email: 'info@mueller.example',
    });
    expect(customers[0]).toMatchObject({ postalCode: '01067', isBusiness: false });
    const audit = await prisma.auditLog.findFirstOrThrow({ where: { action: 'masterdata.import' } });
    expect(audit.newData).toMatchObject({ source: 'kunden.csv', created: 1, updated: 1, skipped: 1 });
    // die Sitzung ist danach weg
    await api()
      .post(`/master-data-import/${upload.body.sessionId}/preview`)
      .set(auth)
      .send({ entity: 'customers', mapping })
      .expect(404);
  });

  it('Artikel aus eingefügtem Text; Rechte; eindeutige Werte', async () => {
    await prisma.article.create({
      data: {
        companyId: company.companyId,
        articleNumber: 'M-1',
        name: 'Rindenmulch',
        unit: 'm³',
        purchasePrice: 20,
        salePrice: 30,
      },
    });
    const text =
      'Art.-Nr.\tBezeichnung\tME\tEK\tVK\nM-1\tRindenmulch\tcbm\t20,00\t32,50\nK-2\tKies 16/32\tt\t18\t29,9\n';
    const session = await api().post('/master-data-import/text').set(auth).send({ text }).expect(201);
    expect(session.body.entity).toBe('articles');
    const mapping = session.body.entities.find((e: { type: string }) => e.type === 'articles').suggested;
    const preview = await api()
      .post(`/master-data-import/${session.body.sessionId}/preview`)
      .set(auth)
      .send({ entity: 'articles', mapping })
      .expect(201);
    expect(preview.body.rows.map((r: { status: string }) => r.status)).toEqual(['update', 'new']);
    expect(preview.body.rows[0].changes).toEqual([
      { field: 'salePrice', label: 'Verkaufspreis', old: 30, new: 32.5 },
    ]);

    // ohne Einkaufspreis-Recht kein Artikel-Import
    const role = await prisma.role.create({
      data: {
        companyId: company.companyId,
        name: 'Import ohne Preise',
        permissions: {
          create: (
            await prisma.permission.findMany({ where: { key: { in: ['data.import', 'masterdata.write'] } } })
          ).map((p) => ({ permissionId: p.id })),
        },
      },
    });
    await prisma.user.create({
      data: {
        companyId: company.companyId,
        email: 'import@import.test',
        passwordHash: await bcrypt.hash('test12345', 4),
        firstName: 'Ina',
        lastName: 'Import',
        roles: { create: { roleId: role.id } },
      },
    });
    const login = await api()
      .post('/auth/login')
      .send({ email: 'import@import.test', password: 'test12345' });
    const limited = { Authorization: `Bearer ${login.body.accessToken}` };
    await api()
      .post(`/master-data-import/${session.body.sessionId}/preview`)
      .set(limited)
      .send({ entity: 'articles', mapping })
      .expect(403);
    // Lieferanten dürfen sie
    const suppliers = await api()
      .post('/master-data-import/text')
      .set(limited)
      .send({ text: 'Lieferant;E-Mail\nBaustoff Nord;info@nord.example\n' })
      .expect(201);
    expect(suppliers.body.entity).toBe('suppliers');

    const applied = await api()
      .post(`/master-data-import/${session.body.sessionId}/apply`)
      .set(auth)
      .send({ entity: 'articles', mapping, accept: [0, 1] })
      .expect(201);
    expect(applied.body).toMatchObject({ created: 1, updated: 1 });
    const kies = await prisma.article.findFirstOrThrow({
      where: { companyId: company.companyId, articleNumber: 'K-2' },
    });
    expect(kies).toMatchObject({ unit: 't', name: 'Kies 16/32' });
    expect(Number(kies.salePrice)).toBe(29.9);

    // gleiche Debitorennummer zweimal in der Quelle: die zweite Zeile ist fehlerhaft
    const twice = await api()
      .post('/master-data-import/text')
      .set(auth)
      .send({ text: 'Name;E-Mail;Debitor\nNeu B;b@example.com;10002\nNeu C;c@example.com;10002\n' })
      .expect(201);
    const twiceMapping = twice.body.entities.find((e: { type: string }) => e.type === 'customers').suggested;
    const twicePreview = await api()
      .post(`/master-data-import/${twice.body.sessionId}/preview`)
      .set(auth)
      .send({ entity: 'customers', mapping: twiceMapping })
      .expect(201);
    expect(twicePreview.body.rows.map((r: { status: string }) => r.status)).toEqual(['new', 'invalid']);
    expect(twicePreview.body.rows[1].errors[0]).toContain('doppelt');
  });

  it('lehnt unbrauchbare Quellen ab', async () => {
    await api()
      .post('/master-data-import/upload')
      .set(auth)
      .attach('file', Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0]), { filename: 'alt.xls' })
      .expect(400);
    await api().post('/master-data-import/text').set(auth).send({ text: 'Nur eine Kopfzeile' }).expect(400);
    await api().post('/master-data-import/upload').set(auth).expect(400);
  });
});
