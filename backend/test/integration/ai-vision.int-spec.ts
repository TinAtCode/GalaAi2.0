import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';
import { buildTestPdf } from '../fixtures/test-pdf';

// KI mit Bildern: Beleg lesen (Foto oder PDF) und Baustellenfoto beschreiben.
// Die „Anbieter“ sind ein lokaler Server im OpenAI-, Anthropic- und
// Agenten-Format; geprüft wird, dass das Bild im Format des jeweiligen
// Anbieters ankommt und die Antwort nur geprüft übernommen wird.
describe('KI mit Bildern', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let other: TestCompany;
  let auth: { Authorization: string };
  let server: Server;
  let base: string;
  let projectId: string;
  const received: { path?: string; body: any }[] = [];
  const api = () => request(app.getHttpServer());
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const invoiceJson = JSON.stringify({
    supplierName: 'Baustoff Nord GmbH',
    invoiceNumber: 'RE-4711',
    invoiceDate: '2026-09-20',
    amount: 1190,
    netAmount: 1000,
    vatAmount: 190,
    supplierIban: 'DE89370400440532013000',
  });

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body);
        received.push({ path: req.url, body: parsed });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (req.url === '/agent') {
          res.end(JSON.stringify({ text: 'gelesen', data: { supplierName: 'Agent AG', amount: 50 } }));
        } else if (req.url === '/v1/messages') {
          res.end(
            JSON.stringify({ model: parsed.model, content: [{ type: 'text', text: 'Hecke geschnitten.' }] }),
          );
        } else {
          res.end(
            JSON.stringify({
              model: parsed.model,
              choices: [
                { message: { content: `Das habe ich gelesen:\n\`\`\`json\n${invoiceJson}\n\`\`\`` } },
              ],
            }),
          );
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Bilder GmbH');
    other = await createCompany(app, prisma, 'Andere GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    ({ projectId } = await createProject(app, company.token));
    // Standard-Anbieter kann nur Text
    await api()
      .post('/ai/providers')
      .set(auth)
      .send({
        name: 'Nur Text',
        kind: 'openai_compatible',
        baseUrl: `${base}/v1`,
        model: 'text',
        isDefault: true,
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const uploadInvoice = async (buffer: Buffer, filename: string, contentType: string) =>
    (
      await api()
        .post('/finance/payables/extract')
        .set(auth)
        .attach('file', buffer, { filename, contentType })
        .expect(201)
    ).body.documentId as string;

  it('Beleg lesen: nur mit einem Anbieter, der Bilder versteht', async () => {
    const documentId = await uploadInvoice(buildTestPdf('Rechnung RE-4711'), 're.pdf', 'application/pdf');
    expect((await api().get('/ai/gateway/status').set(auth).expect(200)).body.tasks.beleg_lesen).toBe(false);
    const none = await api().post(`/finance/payables/documents/${documentId}/ai-read`).set(auth).expect(400);
    expect(none.body.message).toContain('kein KI-Anbieter');

    const vision = await api()
      .post('/ai/providers')
      .set(auth)
      .send({
        name: 'Sehend',
        kind: 'openai_compatible',
        baseUrl: `${base}/v1`,
        model: 'vision-gross',
        capabilities: ['text', 'vision'],
      })
      .expect(201);
    await api().put('/ai/tasks/beleg_lesen').set(auth).send({ providerId: vision.body.id }).expect(200);
    expect((await api().get('/ai/gateway/status').set(auth).expect(200)).body.tasks.beleg_lesen).toBe(true);

    // PDF: erste Seite als PNG an die KI
    const read = await api().post(`/finance/payables/documents/${documentId}/ai-read`).set(auth).expect(201);
    expect(read.body).toMatchObject({
      readable: true,
      providerName: 'Sehend',
      draft: {
        supplierName: 'Baustoff Nord GmbH',
        invoiceNumber: 'RE-4711',
        invoiceDate: '2026-09-20',
        amount: '1190.00',
        supplierIban: 'DE89370400440532013000',
      },
    });
    const sent = received.at(-1)!.body;
    expect(sent.model).toBe('vision-gross');
    const content = sent.messages[1].content;
    expect(content[0]).toMatchObject({ type: 'text' });
    expect(content[1].type).toBe('image_url');
    expect(content[1].image_url.url).toMatch(/^data:image\/png;base64,iVBORw0KGgo/);

    // Protokoll: Bilder gezählt, nicht gespeichert
    const audit = await prisma.auditLog.findFirst({
      where: { companyId: company.companyId, action: 'ai_completion' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit!.newData).toMatchObject({ task: 'beleg_lesen', images: 1 });
    expect(JSON.stringify(audit!.newData)).not.toContain('iVBORw0KGgo');

    // Foto eines Belegs geht direkt
    const photoId = await uploadInvoice(png, 'beleg.png', 'image/png');
    await api().post(`/finance/payables/documents/${photoId}/ai-read`).set(auth).expect(201);
    expect(received.at(-1)!.body.messages[1].content[1].image_url.url).toBe(
      `data:image/png;base64,${png.toString('base64')}`,
    );

    // eigener Agent: Bild als Anhang, Felder strukturiert in `data`
    const agent = await api()
      .post('/ai/providers')
      .set(auth)
      .send({ name: 'Beleg-Agent', kind: 'agent', baseUrl: `${base}/agent`, capabilities: ['vision'] })
      .expect(201);
    await api().put('/ai/tasks/beleg_lesen').set(auth).send({ providerId: agent.body.id }).expect(200);
    const byAgent = await api().post(`/finance/payables/documents/${photoId}/ai-read`).set(auth).expect(201);
    expect(byAgent.body.draft).toMatchObject({
      supplierName: 'Agent AG',
      amount: '50.00',
      invoiceNumber: null,
    });
    expect(received.at(-1)!.body).toMatchObject({
      task: 'beleg_lesen',
      attachments: [{ mediaType: 'image/png', data: png.toString('base64') }],
    });

    // fremde Firma: Beleg nicht gefunden
    await api()
      .post(`/finance/payables/documents/${photoId}/ai-read`)
      .set({ Authorization: `Bearer ${other.token}` })
      .expect(404);
  });

  it('Baustellenfoto beschreiben (Anthropic-Format)', async () => {
    const photo = await api()
      .post(`/site/projects/${projectId}/photos`)
      .set(auth)
      .field('caption', 'Hecke hinten')
      .attach('file', png, { filename: 'hecke.png', contentType: 'image/png' })
      .expect(201);
    const documentId = photo.body.documentId as string;

    const claude = await api()
      .post('/ai/providers')
      .set(auth)
      .send({
        name: 'Claude',
        kind: 'anthropic',
        baseUrl: base,
        model: 'sehend',
        apiKey: 'sk-test',
        capabilities: ['text', 'vision'],
      })
      .expect(201);
    await api().put('/ai/tasks/foto_beschreiben').set(auth).send({ providerId: claude.body.id }).expect(200);
    const res = await api().post('/ai/assist/photo-description').set(auth).send({ documentId }).expect(201);
    expect(res.body).toMatchObject({ text: 'Hecke geschnitten.', providerName: 'Claude' });
    const content = received.at(-1)!.body.messages[0].content;
    expect(content[0]).toEqual({
      type: 'image',
      source: { type: 'base64', media_type: 'image/png', data: png.toString('base64') },
    });
    expect(content[1].text).toContain('Hecke hinten');

    // nur Fotos aus Baustellen-Nachrichten, nur der eigenen Firma
    const invoiceDoc = await uploadInvoice(png, 'beleg2.png', 'image/png');
    await api().post('/ai/assist/photo-description').set(auth).send({ documentId: invoiceDoc }).expect(404);
    await api()
      .post('/ai/assist/photo-description')
      .set({ Authorization: `Bearer ${other.token}` })
      .send({ documentId })
      .expect(404);
  });
});
