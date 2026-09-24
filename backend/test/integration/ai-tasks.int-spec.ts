import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp, createCompany, createProject, fetchPdfText, resetDatabase, TestCompany } from './helpers';

// KI-Aufgaben: jede Aufgabe kann einen eigenen Anbieter (und ein eigenes
// Modell) haben, sonst übernimmt der Standard-Anbieter – aber nur, wenn er
// kann, was die Aufgabe braucht. Dazu die ersten Funktionen der App:
// Anschreiben zum Angebot und Zusammenfassung der Baustelle.
describe('KI-Aufgaben', () => {
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

  beforeAll(async () => {
    // OpenAI-Format antwortet mit dem Modell, der Agent mit der Aufgabe
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body);
        received.push({ path: req.url, body: parsed });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (req.url === '/agent') res.end(JSON.stringify({ text: `Agent: ${parsed.task}` }));
        else
          res.end(
            JSON.stringify({
              model: parsed.model,
              choices: [{ message: { content: `Modell ${parsed.model}` } }],
            }),
          );
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Aufgaben GmbH');
    other = await createCompany(app, prisma, 'Andere GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    ({ projectId } = await createProject(app, company.token));
  });

  afterAll(async () => {
    await app.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('ohne Anbieter: Aufgaben nicht verfügbar, klare Meldung', async () => {
    const status = await api().get('/ai/gateway/status').set(auth).expect(200);
    expect(status.body.tasks).toEqual({
      frage: false,
      angebotstext: false,
      baustelle_zusammenfassung: false,
      beleg_lesen: false,
      foto_beschreiben: false,
      lageplan_zeichnen: false,
    });
    const res = await api()
      .post('/ai/assist/quote-text')
      .set(auth)
      .send({ projectId, lines: [{ description: 'Pflaster verlegen', quantity: 20, unit: 'm²' }] })
      .expect(400);
    expect(res.body.message).toContain('kein KI-Anbieter');
  });

  it('Standard-Anbieter, eigener Anbieter je Aufgabe mit eigenem Modell', async () => {
    const ollama = await api()
      .post('/ai/providers')
      .set(auth)
      .send({
        name: 'Ollama',
        kind: 'openai_compatible',
        baseUrl: `${base}/v1`,
        model: 'gross',
        isDefault: true,
      })
      .expect(201);
    expect(ollama.body.capabilities).toEqual(['text']);
    const agent = await api()
      .post('/ai/providers')
      .set(auth)
      .send({ name: 'Agent', kind: 'agent', baseUrl: `${base}/agent`, capabilities: ['text', 'image'] })
      .expect(201);

    // Anschreiben: Kunde, Projekt und Positionen gehen mit, keine Preise
    const text = await api()
      .post('/ai/assist/quote-text')
      .set(auth)
      .send({
        projectId,
        lines: [{ description: 'Pflaster verlegen', quantity: 20, unit: 'm²' }],
        hint: 'kurz',
      })
      .expect(201);
    expect(text.body).toMatchObject({ text: 'Modell gross', providerName: 'Ollama' });
    const sent = JSON.stringify(received.at(-1)!.body);
    expect(sent).toContain('Familie Muster');
    expect(sent).toContain('Pflaster verlegen');
    expect(sent).toContain('Wunsch: kurz');

    // Zusammenfassung an ein kleines Modell desselben Anbieters
    const tasks = await api()
      .put('/ai/tasks/baustelle_zusammenfassung')
      .set(auth)
      .send({ providerId: ollama.body.id, model: 'klein' })
      .expect(200);
    expect(
      tasks.body.tasks.find((t: { key: string }) => t.key === 'baustelle_zusammenfassung'),
    ).toMatchObject({
      providerId: ollama.body.id,
      model: 'klein',
      needs: 'text',
    });
    const empty = await api().post('/ai/assist/site-summary').set(auth).send({ projectId }).expect(201);
    expect(empty.body.text).toContain('noch keine Nachrichten');
    await api()
      .post(`/site/projects/${projectId}/messages`)
      .set(auth)
      .send({ text: 'Randsteine fehlen noch' })
      .expect(201);
    const summary = await api().post('/ai/assist/site-summary').set(auth).send({ projectId }).expect(201);
    expect(summary.body).toMatchObject({ text: 'Modell klein', model: 'klein' });
    expect(JSON.stringify(received.at(-1)!.body)).toContain('Randsteine fehlen noch');
    const audit = await prisma.auditLog.findFirst({
      where: { companyId: company.companyId, action: 'ai_completion' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit!.newData).toMatchObject({ task: 'baustelle_zusammenfassung', model: 'klein' });

    // Anschreiben an den eigenen Agenten; der Agent erfährt die Aufgabe
    await api().put('/ai/tasks/angebotstext').set(auth).send({ providerId: agent.body.id }).expect(200);
    const byAgent = await api()
      .post('/ai/assist/quote-text')
      .set(auth)
      .send({ projectId, lines: [{ description: 'Hecke schneiden' }] })
      .expect(201);
    expect(byAgent.body.text).toBe('Agent: angebotstext');

    // ausgeschaltet -> zurück zum Standard-Anbieter
    await api().patch(`/ai/providers/${agent.body.id}`).set(auth).send({ enabled: false }).expect(200);
    const fallback = await api()
      .post('/ai/assist/quote-text')
      .set(auth)
      .send({ projectId, lines: [{ description: 'Hecke schneiden' }] })
      .expect(201);
    expect(fallback.body.providerName).toBe('Ollama');

    // Zuordnung aufheben -> Standard-Anbieter mit seinem Modell
    await api().put('/ai/tasks/baustelle_zusammenfassung').set(auth).send({ providerId: null }).expect(200);
    const again = await api().post('/ai/assist/site-summary').set(auth).send({ projectId }).expect(201);
    expect(again.body.text).toBe('Modell gross');
    expect((await api().get('/ai/gateway/status').set(auth).expect(200)).body.tasks).toEqual({
      frage: true,
      angebotstext: true,
      baustelle_zusammenfassung: true,
      // nur Text: Aufgaben mit Bildern bleiben aus
      beleg_lesen: false,
      foto_beschreiben: false,
      lageplan_zeichnen: false,
    });
  });

  it('Fähigkeiten: Aufgabe nur an einen Anbieter, der sie kann', async () => {
    const painter = await api()
      .post('/ai/providers')
      .set(auth)
      .send({ name: 'Nur Bilder', kind: 'agent', baseUrl: `${base}/agent`, capabilities: ['image'] })
      .expect(201);
    const res = await api()
      .put('/ai/tasks/angebotstext')
      .set(auth)
      .send({ providerId: painter.body.id })
      .expect(400);
    expect(res.body.message).toContain('kann nicht: Text');
    await api().put('/ai/tasks/gibtsnicht').set(auth).send({}).expect(404);
    await api()
      .post('/ai/providers')
      .set(auth)
      .send({ name: 'Falsch', kind: 'agent', baseUrl: base, capabilities: ['fliegen'] })
      .expect(400);
    // Fähigkeit später entzogen -> Zuordnung greift nicht mehr, Standard übernimmt
    const helper = await api()
      .post('/ai/providers')
      .set(auth)
      .send({ name: 'Helfer', kind: 'agent', baseUrl: `${base}/agent` })
      .expect(201);
    await api().put('/ai/tasks/angebotstext').set(auth).send({ providerId: helper.body.id }).expect(200);
    await api()
      .patch(`/ai/providers/${helper.body.id}`)
      .set(auth)
      .send({ capabilities: ['image'] })
      .expect(200);
    const fallback = await api()
      .post('/ai/assist/quote-text')
      .set(auth)
      .send({ projectId, lines: [{ description: 'Rasen' }] })
      .expect(201);
    expect(fallback.body.providerName).toBe('Ollama');
    // Anbieter gelöscht -> Zuordnung weg
    await api().delete(`/ai/providers/${helper.body.id}`).set(auth).expect(200);
    const tasks = await api().get('/ai/tasks').set(auth).expect(200);
    expect(tasks.body.tasks.find((t: { key: string }) => t.key === 'angebotstext').providerId).toBeNull();
  });

  it('Anschreiben steht im Angebot und im PDF', async () => {
    const quote = await api()
      .post('/quotes')
      .set(auth)
      .send({
        projectId,
        introText: 'Sehr geehrte Familie Muster,\nvielen Dank für Ihre Anfrage.',
        lineItems: [{ description: 'Pflaster verlegen', unit: 'm²', unitPrice: 50, quantity: 20 }],
      })
      .expect(201);
    expect(quote.body.introText).toContain('vielen Dank');
    const pdf = await fetchPdfText(app, `/quotes/${quote.body.id}/pdf`, company.token);
    expect(pdf.text).toContain('vielen Dank für Ihre Anfrage');
    const updated = await api()
      .put(`/quotes/${quote.body.id}`)
      .set(auth)
      .send({
        introText: '',
        lineItems: [{ description: 'Pflaster verlegen', unit: 'm²', unitPrice: 50, quantity: 20 }],
      })
      .expect(200);
    expect(updated.body.introText).toBeNull();
  });

  it('Rechte und Mandanten', async () => {
    const otherAuth = { Authorization: `Bearer ${other.token}` };
    // fremdes Projekt: nicht gefunden
    await api().post('/ai/assist/site-summary').set(otherAuth).send({ projectId }).expect(404);
    expect(
      (await api().get('/ai/tasks').set(otherAuth).expect(200)).body.tasks.every(
        (t: { providerId: null }) => !t.providerId,
      ),
    ).toBe(true);
    const ollama = (await api().get('/ai/providers').set(auth)).body.find(
      (p: { name: string }) => p.name === 'Ollama',
    );
    await api().put('/ai/tasks/angebotstext').set(otherAuth).send({ providerId: ollama.id }).expect(404);
  });
});
