import { INestApplication } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import PDFDocument from 'pdfkit';
import request from 'supertest';
import { addCalendarDays, localDayString } from '../../src/common/time-zone';
import { PermissionKey } from '../../src/common/permissions';
import { buildXRechnung, XRechnungInput } from '../../src/invoices/xrechnung';
import { renderBusinessDocumentPdf } from '../../src/pdf/business-document.pdf';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';

type Payable = {
  id: string;
  supplierName: string;
  invoiceNumber: string | null;
  amount: string;
  status: string;
  paidAt: string | null;
  paidAmount: string | null;
  bankTransactionId: string | null;
  category: { id: string; name: string } | null;
  document: { id: string; fileName: string } | null;
  plan: { date: string; amount: string; withDiscount: boolean } | null;
  match: { transactionId: string; reasons: string[] } | null;
};

const D = (n: string) => new Prisma.Decimal(n);
const toDate = (day: string) => new Date(`${day}T10:00:00Z`);

// Eingangsrechnungen: Beleg einlesen, erfassen, mit Abbuchungen abgleichen,
// in Jahresüberblick und Liquiditätsvorschau
describe('Eingangsrechnungen', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let auth: { Authorization: string };
  const api = () => request(app.getHttpServer());
  const today = localDayString(new Date(), 'Europe/Berlin');

  const einvoice = (
    number: string,
    issueDay: string,
    gross = '1190.00',
    supplier = 'Stein & Kies GmbH',
  ): XRechnungInput => ({
    kind: 'final',
    number,
    issueDate: toDate(issueDay),
    servicePeriodStart: null,
    servicePeriodEnd: toDate(issueDay),
    timeZone: 'Europe/Berlin',
    buyerReference: 'Material',
    seller: {
      name: supplier,
      street: 'Hafenweg 3',
      postalCode: '20095',
      city: 'Hamburg',
      email: 'info@stein.example',
      contactName: 'Jan Stein',
      phone: '+49 40 123456',
      taxNumber: '12/345/67890',
      vatId: 'DE123456789',
      iban: 'DE89370400440532013000',
      bic: null,
      paymentTermDays: 30,
    },
    buyer: {
      name: 'Payables GmbH',
      street: 'Weg 1',
      postalCode: '10115',
      city: 'Berlin',
      email: 'b@p.example',
    },
    vatTreatment: 'standard',
    vatRate: D('19.00'),
    totalNet: D(String((Number(gross) / 1.19).toFixed(2))),
    totalVat: D(String((Number(gross) - Number(gross) / 1.19).toFixed(2))),
    totalGross: D(gross),
    notes: [],
    lines: [
      { description: 'Split', unit: 't', quantity: D('10'), unitPrice: D('100'), lineTotal: D('1000') },
    ],
  });

  const extract = (buffer: Buffer, name: string, contentType: string, headers = auth) =>
    api()
      .post('/finance/payables/extract')
      .set(headers)
      .attach('file', buffer, { filename: name, contentType });

  // PDF mit Textebene (wie die meisten Lieferantenrechnungen)
  const textPdf = (lines: string[]) =>
    new Promise<Buffer>((resolve) => {
      const doc = new PDFDocument();
      const chunks: Buffer[] = [];
      doc.on('data', (c: Buffer) => chunks.push(c));
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      for (const line of lines) doc.text(line);
      doc.end();
    });

  // Kontoauszug mit Abbuchungen
  const statement = (
    id: string,
    debits: { amount: string; name: string; iban?: string; text: string; day: string }[],
  ) =>
    Buffer.from(`<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt>
<GrpHdr><MsgId>${id}</MsgId><CreDtTm>${today}T08:00:00</CreDtTm></GrpHdr>
<Stmt><Id>${id}</Id><CreDtTm>${today}T08:00:00</CreDtTm><Acct><Id><IBAN>DE44500105175407324931</IBAN></Id></Acct>
<Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">5000.00</Amt><CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>${today}</Dt></Dt></Bal>
${debits
  .map(
    (d, i) => `<Ntry><Amt Ccy="EUR">${d.amount}</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
<BookgDt><Dt>${d.day}</Dt></BookgDt><AcctSvcrRef>${id}-${i}</AcctSvcrRef><BkTxCd/>
<NtryDtls><TxDtls><RltdPties><Cdtr><Pty><Nm>${d.name}</Nm></Pty></Cdtr>${
      d.iban ? `<CdtrAcct><Id><IBAN>${d.iban}</IBAN></Id></CdtrAcct>` : ''
    }</RltdPties><RmtInf><Ustrd>${d.text}</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>`,
  )
  .join('\n')}
</Stmt></BkToCstmrStmt></Document>`);
  const importStatement = (xml: Buffer) =>
    api().post('/bank/import').set(auth).attach('file', xml, 'auszug.xml').expect(201);

  const list = async (status = 'open') =>
    (await api().get(`/finance/payables?status=${status}`).set(auth).expect(200)).body as Payable[];

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Payables GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
  });

  afterAll(async () => {
    await app.close();
  });

  it('E-Rechnung (XML): exakte Angaben, Beleg gespeichert; erfassen; doppelt wird erkannt', async () => {
    const issue = addCalendarDays(today, -5);
    const xml = Buffer.from(buildXRechnung(einvoice('SK-1001', issue)));
    const res = await extract(xml, 'SK-1001.xml', 'application/xml').expect(201);
    expect(res.body).toMatchObject({
      source: 'einvoice',
      fileName: 'SK-1001.xml',
      draft: {
        supplierName: 'Stein & Kies GmbH',
        supplierIban: 'DE89370400440532013000',
        invoiceNumber: 'SK-1001',
        invoiceDate: issue,
        dueDate: addCalendarDays(issue, 30),
        amount: '1190.00',
      },
      duplicateOf: null,
    });
    // Kategorie über die Startregeln ("kies"? nein – "stein" nicht; bleibt leer)
    const created = await api()
      .post('/finance/payables')
      .set(auth)
      .send({
        ...Object.fromEntries(
          Object.entries(res.body.draft).filter(
            ([k, v]) =>
              v !== null &&
              !['netAmount', 'vatAmount', 'categoryId', 'discountPercent', 'discountUntil'].includes(k),
          ),
        ),
        amount: 1190,
        documentId: res.body.documentId,
        source: 'einvoice',
      })
      .expect(201);
    expect(created.body).toMatchObject({
      status: 'open',
      document: { fileName: 'SK-1001.xml' },
      source: 'einvoice',
    });

    // gleiche Rechnung noch einmal: Hinweis beim Einlesen, 409 beim Erfassen
    const again = await extract(xml, 'SK-1001.xml', 'application/xml').expect(201);
    expect(again.body.duplicateOf).toMatchObject({ id: created.body.id });
    await api()
      .post('/finance/payables')
      .set(auth)
      .send({ supplierName: 'STEIN & KIES GMBH', invoiceNumber: 'sk-1001', amount: 1190 })
      .expect(409);
    // verworfenen Beleg entfernen; schon zugeordneten nicht
    await api().delete(`/finance/payables/documents/${again.body.documentId}`).set(auth).expect(200);
    await api().delete(`/finance/payables/documents/${res.body.documentId}`).set(auth).expect(404);
    // Beleg herunterladen
    const file = await api().get(`/finance/payables/${created.body.id}/file`).set(auth).expect(200);
    expect(file.headers['content-disposition']).toContain('SK-1001.xml');
  });

  it('ZUGFeRD-PDF und PDF mit Textebene; falscher Dateityp', async () => {
    const issue = addCalendarDays(today, -2);
    const pdf = await renderBusinessDocumentPdf({
      title: 'Rechnung SK-1002',
      draft: false,
      seller: { name: 'Stein & Kies GmbH', street: 'Hafenweg 3', postalCode: '20095', city: 'Hamburg' },
      buyer: { name: 'Payables GmbH', street: 'Weg 1', postalCode: '10115', city: 'Berlin' },
      meta: [['Rechnungsdatum', issue]],
      lines: [],
      totals: { net: '500', vatRate: '19', vat: '95', gross: '595' },
      notes: [],
      eInvoiceXml: Buffer.from(buildXRechnung(einvoice('SK-1002', issue, '595.00'))),
    });
    const zugferd = await extract(pdf, 'SK-1002.pdf', 'application/pdf').expect(201);
    expect(zugferd.body).toMatchObject({
      source: 'einvoice',
      draft: { invoiceNumber: 'SK-1002', amount: '595.00' },
    });

    const scanned = await textPdf([
      'Baustoffe Müller KG',
      'Industriestraße 5, 50667 Köln',
      'Rechnung',
      'Rechnungsnummer: BM-7781',
      `Rechnungsdatum: ${issue.split('-').reverse().join('.')}`,
      'Rechnungsbetrag 412,50 EUR',
      'Zahlbar innerhalb 14 Tagen. 2 % Skonto innerhalb 7 Tagen.',
    ]);
    const text = await extract(scanned, 'scan.pdf', 'application/pdf').expect(201);
    expect(text.body).toMatchObject({
      source: 'text',
      draft: {
        supplierName: 'Baustoffe Müller KG',
        invoiceNumber: 'BM-7781',
        invoiceDate: issue,
        dueDate: addCalendarDays(issue, 14),
        amount: '412.50',
        discountPercent: '2.00',
        discountUntil: addCalendarDays(issue, 7),
        // Startregel "baustoff" -> Material
        categoryId: expect.any(String),
      },
    });
    expect(text.body.candidates.supplierName).toContain('Baustoffe Müller KG');
    await extract(Buffer.from('hallo'), 'notiz.txt', 'text/plain').expect(400);
    // Gutschriften (UBL CreditNote, CII-Typ 381) sind keine Rechnungen
    const creditNote = await extract(
      Buffer.from(
        buildXRechnung(einvoice('SK-G1', issue)).replace(
          '<ram:TypeCode>380</ram:TypeCode>',
          '<ram:TypeCode>381</ram:TypeCode>',
        ),
      ),
      'gutschrift.xml',
      'application/xml',
    ).expect(400);
    expect(creditNote.body.message).toContain('Gutschrift');
    await extract(
      Buffer.from(
        '<CreditNote xmlns="urn:oasis:names:specification:ubl:schema:xsd:CreditNote-2"><ID>G2</ID></CreditNote>',
      ),
      'gutschrift2.xml',
      'application/xml',
    ).expect(400);
    await extract(Buffer.from('<Document/>'), 'kein.xml', 'application/xml').expect(400);
    for (const id of [zugferd.body.documentId, text.body.documentId])
      await api().delete(`/finance/payables/documents/${id}`).set(auth).expect(200);
  });

  it('Kontoauszug: eindeutige Abbuchung (Betrag + Nummer) verbucht automatisch, übernimmt die Kategorie', async () => {
    const material = (await api().get('/finance/categories').set(auth).expect(200)).body.find(
      (c: { name: string }) => c.name === 'Material',
    );
    const bill = await api()
      .post('/finance/payables')
      .set(auth)
      .send({
        supplierName: 'Baumschule Lorenz',
        invoiceNumber: 'BL-2026-55',
        invoiceDate: addCalendarDays(today, -10),
        dueDate: addCalendarDays(today, 20),
        amount: 850,
        discountPercent: 3,
        discountUntil: addCalendarDays(today, 4),
        categoryId: material.id,
      })
      .expect(201);
    expect(bill.body.plan).toBeUndefined(); // Plan nur in der Liste
    const open = (await list()).find((p) => p.id === bill.body.id)!;
    expect(open.plan).toEqual({
      date: addCalendarDays(today, 4),
      amount: '824.50',
      withDiscount: true,
      overdue: false,
    });

    const res = await importStatement(
      statement('PAY-1', [
        {
          amount: '824.50',
          name: 'Baumschule Lorenz GmbH',
          text: 'Rechnung BL 2026 55 abzgl. 3% Skonto',
          day: today,
        },
      ]),
    );
    expect(res.body.payablesPaid).toBe(1);
    const paid = (await list('paid')).find((p) => p.id === bill.body.id)!;
    expect(paid).toMatchObject({ status: 'paid', paidAt: today, paidAmount: '824.5' });
    const tx = await prisma.bankTransaction.findUniqueOrThrow({ where: { id: paid.bankTransactionId! } });
    expect(tx.categoryId).toBe(material.id);
  });

  it('nur Betrag und Name: Vorschlag, Verbuchen von Hand; Konflikte', async () => {
    const bill = await api()
      .post('/finance/payables')
      .set(auth)
      .send({ supplierName: 'Hornbach Baumarkt AG', invoiceDate: addCalendarDays(today, -3), amount: 129.9 })
      .expect(201);
    const other = await api()
      .post('/finance/payables')
      .set(auth)
      .send({ supplierName: 'Hornbach Baumarkt AG', invoiceNumber: 'H-2', amount: 55 })
      .expect(201);
    await importStatement(
      statement('PAY-2', [{ amount: '129.90', name: 'HORNBACH 0815', text: 'Kartenzahlung', day: today }]),
    );
    const row = (await list()).find((p) => p.id === bill.body.id)!;
    expect(row.match).toMatchObject({ reasons: ['amount', 'name'] });
    expect(row.status).toBe('open');
    await api()
      .post(`/finance/payables/${bill.body.id}/pay`)
      .set(auth)
      .send({ bankTransactionId: row.match!.transactionId })
      .expect(201);
    await api()
      .post(`/finance/payables/${bill.body.id}/pay`)
      .set(auth)
      .send({ bankTransactionId: row.match!.transactionId })
      .expect(409);
    // dieselbe Abbuchung für eine zweite Rechnung
    await api()
      .post(`/finance/payables/${other.body.id}/pay`)
      .set(auth)
      .send({ bankTransactionId: row.match!.transactionId })
      .expect(409);
    // wieder öffnen: diese Abbuchung war falsch – nicht erneut vorschlagen oder automatisch verbuchen
    await api().post(`/finance/payables/${bill.body.id}/reopen`).set(auth).expect(201);
    expect((await list()).find((p) => p.id === bill.body.id)!.match).toBeNull();
    await api()
      .post('/finance/payables')
      .set(auth)
      .send({ supplierName: 'Irgendwer', amount: 1 })
      .expect(201);
    expect((await list()).find((p) => p.id === bill.body.id)!.status).toBe('open');
    // bewusst von Hand gewählt geht weiterhin
    await api()
      .post(`/finance/payables/${bill.body.id}/pay`)
      .set(auth)
      .send({ bankTransactionId: row.match!.transactionId })
      .expect(201);

    // von Hand bezahlt (ohne Kontoauszug), Skonto nur innerhalb der Frist
    await api()
      .patch(`/finance/payables/${other.body.id}`)
      .set(auth)
      .send({ discountPercent: 2, discountUntil: today })
      .expect(200);
    const manual = await api()
      .post(`/finance/payables/${other.body.id}/pay`)
      .set(auth)
      .send({ paidAt: today })
      .expect(201);
    expect(manual.body).toMatchObject({ status: 'paid', paidAmount: '53.9', bankTransactionId: null });
    await api().post(`/finance/payables/${other.body.id}/cancel`).set(auth).expect(409);
  });

  it('Jahresüberblick und Liquiditätsvorschau', async () => {
    const due = addCalendarDays(today, 10);
    const bill = await api()
      .post('/finance/payables')
      .set(auth)
      .send({ supplierName: 'Container Nord', invoiceNumber: 'C-1', dueDate: due, amount: 300 })
      .expect(201);
    const year = await api()
      .get(`/finance/year?year=${due.slice(0, 4)}`)
      .set(auth)
      .expect(200);
    const month = year.body.months.find((m: { month: string }) => m.month === due.slice(0, 7));
    expect(month.planned).toContainEqual(
      expect.objectContaining({ kind: 'payable', id: bill.body.id, due, name: 'Container Nord (C-1)' }),
    );

    const forecast = (await api().get('/finance/forecast').set(auth).expect(200)).body;
    expect(forecast.weeks).toHaveLength(13);
    expect(forecast.today).toBe(today);
    const week = forecast.weeks.find((w: { from: string; to: string }) => w.from <= due && due <= w.to);
    expect(week.items).toContainEqual(
      expect.objectContaining({ kind: 'payable', name: 'Container Nord (C-1)' }),
    );
    // Stand fortgeschrieben: Start + Eingänge − Ausgaben
    let balance = Number(forecast.startBalance);
    for (const w of forecast.weeks) {
      balance += Number(w.income) - Number(w.expenses);
      expect(Number(w.balance)).toBeCloseTo(balance, 2);
    }
    expect(Number(forecast.payables.total)).toBeGreaterThanOrEqual(300);

    await api().delete(`/finance/payables/${bill.body.id}`).set(auth).expect(200);
    await api().get(`/finance/payables/${bill.body.id}/file`).set(auth).expect(404);

    // schon abgebucht (Vorschlag vorhanden, noch nicht verbucht): nicht noch einmal einplanen
    await importStatement(
      statement('PAY-3', [{ amount: '77.70', name: 'Kieswerk Süd', text: 'Lieferung', day: today }]),
    );
    const paidAlready = await api()
      .post('/finance/payables')
      .set(auth)
      .send({ supplierName: 'Kieswerk Süd', invoiceDate: addCalendarDays(today, -1), amount: 77.7 })
      .expect(201);
    expect((await list()).find((p) => p.id === paidAlready.body.id)!.match).not.toBeNull();
    const again = (await api().get('/finance/forecast').set(auth).expect(200)).body;
    expect(JSON.stringify(again.weeks)).not.toContain('Kieswerk Süd');
  });

  it('Löschen entfernt den Beleg; Mandantentrennung; nur mit finance.read', async () => {
    const xml = Buffer.from(buildXRechnung(einvoice('SK-2000', today, '99.00')));
    const res = await extract(xml, 'SK-2000.xml', 'application/xml').expect(201);
    const created = await api()
      .post('/finance/payables')
      .set(auth)
      .send({
        supplierName: 'Stein & Kies GmbH',
        invoiceNumber: 'SK-2000',
        amount: 99,
        documentId: res.body.documentId,
      })
      .expect(201);

    const other = await createCompany(app, prisma, 'Fremd Payables GmbH');
    const foreign = { Authorization: `Bearer ${other.token}` };
    await api().get(`/finance/payables/${created.body.id}/file`).set(foreign).expect(404);
    await api().patch(`/finance/payables/${created.body.id}`).set(foreign).send({ amount: 1 }).expect(404);
    await api().delete(`/finance/payables/${created.body.id}`).set(foreign).expect(404);
    await api().delete(`/finance/payables/documents/${res.body.documentId}`).set(foreign).expect(404);
    // Projektdokumente sind keine Belege: weder zuordnen noch verwerfen
    const planDoc = await prisma.document.create({
      data: {
        companyId: company.companyId,
        fileName: 'lageplan.pdf',
        storagePath: 'x/lageplan.pdf',
        documentType: 'invoice',
      },
    });
    await api()
      .post('/finance/payables')
      .set(auth)
      .send({ supplierName: 'Plan GmbH', amount: 5, documentId: planDoc.id })
      .expect(404);
    await api().delete(`/finance/payables/documents/${planDoc.id}`).set(auth).expect(404);
    expect(await prisma.document.count({ where: { id: planDoc.id } })).toBe(1);
    // fremder Beleg bzw. fremde Abbuchung
    await api()
      .post('/finance/payables')
      .set(foreign)
      .send({ supplierName: 'Xaver Bau', amount: 5, documentId: res.body.documentId })
      .expect(404);
    const foreignBill = await api()
      .post('/finance/payables')
      .set(foreign)
      .send({ supplierName: 'Xaver Bau', amount: 5 })
      .expect(201);
    const ownTx = await prisma.bankTransaction.findFirstOrThrow({
      where: { companyId: company.companyId, direction: 'debit' },
    });
    await api()
      .post(`/finance/payables/${foreignBill.body.id}/pay`)
      .set(foreign)
      .send({ bankTransactionId: ownTx.id })
      .expect(404);
    expect((await api().get('/finance/payables?status=all').set(foreign).expect(200)).body).toHaveLength(1);

    // ohne finance.read
    const role = await prisma.role.create({
      data: {
        companyId: company.companyId,
        name: 'Nur Dokumente',
        permissions: {
          create: (['document.read'] as PermissionKey[]).map((key) => ({ permission: { connect: { key } } })),
        },
      },
    });
    await prisma.user.create({
      data: {
        companyId: company.companyId,
        email: 'doku@payables.example',
        passwordHash: await bcrypt.hash('test12345', 4),
        firstName: 'D',
        lastName: 'D',
        roles: { create: { roleId: role.id } },
      },
    });
    const login = await api()
      .post('/auth/login')
      .send({ email: 'doku@payables.example', password: 'test12345' })
      .expect(201);
    const staff = { Authorization: `Bearer ${login.body.accessToken}` };
    await api().get('/finance/payables').set(staff).expect(403);
    await extract(xml, 'x.xml', 'application/xml', staff).expect(403);
    await api().get('/finance/forecast').set(staff).expect(403);

    // Löschen: Rechnung und Beleg weg
    await api().delete(`/finance/payables/${created.body.id}`).set(auth).expect(200);
    expect(await prisma.document.count({ where: { id: res.body.documentId } })).toBe(0);
  });

  it('Projekt zuordnen: Filter, Nachkalkulation, fremdes Projekt abgelehnt', async () => {
    const newProject = async (companyId: string, title: string) => {
      const customer = await prisma.customer.create({ data: { companyId, name: `Kunde ${title}` } });
      const property = await prisma.property.create({
        data: { companyId, customerId: customer.id, label: 'Garten' },
      });
      return prisma.project.create({ data: { companyId, propertyId: property.id, title } });
    };
    const project = await newProject(company.companyId, 'Terrasse Weber');
    const bill = await api()
      .post('/finance/payables')
      .set(auth)
      .send({
        supplierName: 'Holz Nord',
        invoiceNumber: 'HN-1',
        amount: 238,
        netAmount: 200,
        projectId: project.id,
      })
      .expect(201);
    expect(bill.body.project).toEqual({ id: project.id, number: project.number, title: 'Terrasse Weber' });
    // ohne Nettobetrag zählt der Rechnungsbetrag
    await api()
      .post('/finance/payables')
      .set(auth)
      .send({ supplierName: 'Kies Süd', invoiceNumber: 'KS-1', amount: 50, projectId: project.id })
      .expect(201);
    const cancelled = await api()
      .post('/finance/payables')
      .set(auth)
      .send({ supplierName: 'Kies Süd', invoiceNumber: 'KS-2', amount: 999, projectId: project.id })
      .expect(201);
    await api().post(`/finance/payables/${cancelled.body.id}/cancel`).set(auth).expect(201);

    const filtered = (
      await api().get(`/finance/payables?status=all&projectId=${project.id}`).set(auth).expect(200)
    ).body as Payable[];
    expect(filtered).toHaveLength(3);

    const calc = await api().get(`/post-calculation/${project.id}`).set(auth).expect(200);
    expect(calc.body.purchases).toEqual({ count: 2, net: 250 });

    // Zuordnung aufheben
    await api().patch(`/finance/payables/${bill.body.id}`).set(auth).send({ projectId: null }).expect(200);
    const after = await api().get(`/post-calculation/${project.id}`).set(auth).expect(200);
    expect(after.body.purchases).toEqual({ count: 1, net: 50 });

    // Projekt einer anderen Firma
    const other = await createCompany(app, prisma, 'Fremd Projekt GmbH');
    const foreignProject = await newProject(other.companyId, 'Fremd');
    await api()
      .patch(`/finance/payables/${bill.body.id}`)
      .set(auth)
      .send({ projectId: foreignProject.id })
      .expect(404);
    // die Datenbank verhindert es auch ohne Dienst-Prüfung
    await expect(
      prisma.incomingInvoice.update({ where: { id: bill.body.id }, data: { projectId: foreignProject.id } }),
    ).rejects.toThrow();

    // Projekt gelöscht → Rechnung bleibt, nur ohne Projekt
    await prisma.project.delete({ where: { id: project.id } });
    const kept = await prisma.incomingInvoice.findMany({
      where: { companyId: company.companyId, supplierName: 'Kies Süd' },
    });
    expect(kept.every((k) => k.projectId === null)).toBe(true);
  });

  it('Lieferscheine: Lieferant erkannt, Vorschläge, Zuordnung übernimmt das Projekt, Konflikte', async () => {
    const cid = company.companyId;
    const supplier = await prisma.supplier.create({ data: { companyId: cid, name: 'Kieswerk Ost GmbH' } });
    const otherSupplier = await prisma.supplier.create({ data: { companyId: cid, name: 'Holzhandel Süd' } });
    const customer = await prisma.customer.create({ data: { companyId: cid, name: 'Kunde LS' } });
    const property = await prisma.property.create({
      data: { companyId: cid, customerId: customer.id, label: 'Garten' },
    });
    const project = await prisma.project.create({
      data: { companyId: cid, propertyId: property.id, title: 'Einfahrt' },
    });
    const note = async (
      noteNumber: string,
      noteDate: string,
      supplierId: string,
      status: 'open' | 'confirmed' = 'confirmed',
    ) => {
      const document = await prisma.document.create({
        data: {
          companyId: cid,
          fileName: `${noteNumber}.pdf`,
          storagePath: `x/${noteNumber}.pdf`,
          documentType: 'delivery_note',
        },
      });
      return prisma.deliveryNote.create({
        data: {
          companyId: cid,
          documentId: document.id,
          supplierId,
          projectId: project.id,
          noteNumber,
          noteDate: new Date(`${noteDate}T00:00:00Z`),
          status,
        },
      });
    };
    const invoiceDay = today;
    const before = (days: number) => addCalendarDays(today, -days);
    const byNumber = await note('LS-0042', before(10), supplier.id);
    const byDate = await note('LS-0040', before(20), supplier.id);
    await note('LS-0041', before(5), supplier.id, 'open'); // unbestätigt: kein Vorschlag
    await note('H-77', before(3), otherSupplier.id); // anderer Lieferant

    const bill = await api()
      .post('/finance/payables')
      .set(auth)
      .send({
        supplierName: 'KIESWERK OST',
        invoiceNumber: 'KO-9',
        invoiceDate: invoiceDay,
        amount: 500,
        notes: 'Lieferung laut LS 0042',
      })
      .expect(201);
    expect(bill.body.supplier).toEqual({ id: supplier.id, name: 'Kieswerk Ost GmbH' });
    expect(bill.body.project).toBeNull();

    const options = await api().get(`/finance/payables/${bill.body.id}/delivery-notes`).set(auth).expect(200);
    expect(options.body.linked).toEqual([]);
    expect(options.body.suggestions.map((n: { id: string }) => n.id)).toEqual([byNumber.id, byDate.id]);
    expect(options.body.suggestions[0].reasons).toContain('number');

    const saved = await api()
      .put(`/finance/payables/${bill.body.id}/delivery-notes`)
      .set(auth)
      .send({ deliveryNoteIds: [byNumber.id, byDate.id] })
      .expect(200);
    expect(saved.body.linked).toHaveLength(2);
    const listed = (await list('open')).find((p) => p.id === bill.body.id) as unknown as {
      deliveryNoteCount: number;
      project: { id: string } | null;
    };
    expect(listed.deliveryNoteCount).toBe(2);
    // alle Lieferscheine am selben Projekt → die Rechnung übernimmt es
    expect(listed.project?.id).toBe(project.id);

    // schon abgerechnet: eine zweite Rechnung bekommt ihn nicht
    const second = await api()
      .post('/finance/payables')
      .set(auth)
      .send({ supplierName: 'Kieswerk Ost', invoiceNumber: 'KO-10', amount: 50 })
      .expect(201);
    await api()
      .put(`/finance/payables/${second.body.id}/delivery-notes`)
      .set(auth)
      .send({ deliveryNoteIds: [byNumber.id] })
      .expect(409);
    const unconfirmed = await prisma.deliveryNote.findFirstOrThrow({ where: { noteNumber: 'LS-0041' } });
    await api()
      .put(`/finance/payables/${second.body.id}/delivery-notes`)
      .set(auth)
      .send({ deliveryNoteIds: [unconfirmed.id] })
      .expect(400);

    // abwählen gibt ihn frei
    await api()
      .put(`/finance/payables/${bill.body.id}/delivery-notes`)
      .set(auth)
      .send({ deliveryNoteIds: [byDate.id] })
      .expect(200);
    expect(
      (await prisma.deliveryNote.findUniqueOrThrow({ where: { id: byNumber.id } })).incomingInvoiceId,
    ).toBeNull();

    // Lieferschein-Liste zeigt „abgerechnet“ (incomingInvoiceId)
    const notes = (await api().get('/delivery-notes?status=confirmed').set(auth).expect(200)).body as {
      id: string;
      incomingInvoiceId: string | null;
    }[];
    expect(notes.find((n) => n.id === byDate.id)?.incomingInvoiceId).toBe(bill.body.id);

    // fremde Firma: weder sehen noch zuordnen
    const other = await createCompany(app, prisma, 'Fremd LS GmbH');
    const foreign = { Authorization: `Bearer ${other.token}` };
    await api().get(`/finance/payables/${bill.body.id}/delivery-notes`).set(foreign).expect(404);
    const foreignBill = await api()
      .post('/finance/payables')
      .set(foreign)
      .send({ supplierName: 'Kieswerk Ost', amount: 5 })
      .expect(201);
    expect(foreignBill.body.supplier).toBeNull();
    await api()
      .put(`/finance/payables/${foreignBill.body.id}/delivery-notes`)
      .set(foreign)
      .send({ deliveryNoteIds: [byNumber.id] })
      .expect(404);
    await expect(
      prisma.deliveryNote.update({
        where: { id: byNumber.id },
        data: { incomingInvoiceId: foreignBill.body.id },
      }),
    ).rejects.toThrow();

    // Rechnung gelöscht → Lieferscheine wieder frei
    await api().delete(`/finance/payables/${bill.body.id}`).set(auth).expect(200);
    expect(
      (await prisma.deliveryNote.findUniqueOrThrow({ where: { id: byDate.id } })).incomingInvoiceId,
    ).toBeNull();
  });

  it('Review-Fixes: Storno gibt Lieferscheine frei, gemischte Projekte, Lieferant bleibt beim Bearbeiten', async () => {
    const cid = company.companyId;
    const supplier = await prisma.supplier.create({ data: { companyId: cid, name: 'Baumschule West' } });
    const customer = await prisma.customer.create({ data: { companyId: cid, name: 'Kunde RF' } });
    const property = await prisma.property.create({
      data: { companyId: cid, customerId: customer.id, label: 'Garten' },
    });
    const project = await prisma.project.create({
      data: { companyId: cid, propertyId: property.id, title: 'Hecke' },
    });
    const note = async (noteNumber: string, projectId: string | null) => {
      const document = await prisma.document.create({
        data: {
          companyId: cid,
          fileName: `${noteNumber}.pdf`,
          storagePath: `x/${noteNumber}.pdf`,
          documentType: 'delivery_note',
        },
      });
      return prisma.deliveryNote.create({
        data: {
          companyId: cid,
          documentId: document.id,
          supplierId: supplier.id,
          projectId,
          noteNumber,
          status: 'confirmed',
        },
      });
    };
    const forProject = await note('BW-1', project.id);
    const stock = await note('BW-2', null); // Lagerware ohne Projekt

    const bill = await api()
      .post('/finance/payables')
      .set(auth)
      .send({ supplierName: 'Baumschule West', invoiceNumber: 'BW-R1', amount: 300 })
      .expect(201);
    expect(bill.body.supplier?.id).toBe(supplier.id);

    // gemischt (mit und ohne Projekt): die Rechnung bekommt KEIN Projekt
    await api()
      .put(`/finance/payables/${bill.body.id}/delivery-notes`)
      .set(auth)
      .send({ deliveryNoteIds: [forProject.id, stock.id] })
      .expect(200);
    expect(
      (await prisma.incomingInvoice.findUniqueOrThrow({ where: { id: bill.body.id } })).projectId,
    ).toBeNull();

    // Bearbeiten ohne Namensänderung: Lieferant bleibt, auch wenn er nicht mehr eindeutig wäre
    await prisma.supplier.create({ data: { companyId: cid, name: 'Baumschule West GmbH' } });
    await api()
      .patch(`/finance/payables/${bill.body.id}`)
      .set(auth)
      .send({ supplierName: 'Baumschule West', notes: 'nur Notiz geändert' })
      .expect(200);
    expect((await prisma.incomingInvoice.findUniqueOrThrow({ where: { id: bill.body.id } })).supplierId).toBe(
      supplier.id,
    );

    // Storno: Lieferscheine wieder frei, die Ersatzrechnung bekommt sie
    await api().post(`/finance/payables/${bill.body.id}/cancel`).set(auth).expect(201);
    expect(
      await prisma.deliveryNote.count({
        where: { id: { in: [forProject.id, stock.id] }, incomingInvoiceId: null },
      }),
    ).toBe(2);
    // die stornierte Rechnung nimmt keine Lieferscheine mehr an
    await api()
      .put(`/finance/payables/${bill.body.id}/delivery-notes`)
      .set(auth)
      .send({ deliveryNoteIds: [stock.id] })
      .expect(409);
    const replacement = await api()
      .post('/finance/payables')
      .set(auth)
      .send({ supplierName: 'Baumschule West', invoiceNumber: 'BW-R2', amount: 300, supplierId: supplier.id })
      .expect(201);
    await api()
      .put(`/finance/payables/${replacement.body.id}/delivery-notes`)
      .set(auth)
      .send({ deliveryNoteIds: [forProject.id] })
      .expect(200);
    // nur Lieferscheine eines Projekts → Projekt übernommen
    expect(
      (await prisma.incomingInvoice.findUniqueOrThrow({ where: { id: replacement.body.id } })).projectId,
    ).toBe(project.id);
  });
});
