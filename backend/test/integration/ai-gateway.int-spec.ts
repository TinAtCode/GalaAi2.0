import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { createApp, createCompany, resetDatabase, TestCompany } from './helpers';

// Offenes KI-Gateway über die echte API: Anbieter einrichten, Schlüssel nur
// verschlüsselt, Verbindungstest, Nutzen mit Kontextfilter und Protokoll,
// Rechte und Mandanten. Der „Anbieter“ ist ein lokaler HTTP-Server im
// OpenAI- bzw. Agenten-Format (wie Ollama oder ein eigener Agent im LAN).
describe('KI-Gateway', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let other: TestCompany;
  let auth: { Authorization: string };
  let server: Server;
  let base: string;
  const received: { path?: string; authorization?: string; body: any }[] = [];
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body);
        received.push({ path: req.url, authorization: req.headers.authorization, body: parsed });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (req.url === '/agent') res.end(JSON.stringify({ text: `Agent: ${parsed.task}`, data: { ok: 1 } }));
        else res.end(JSON.stringify({ model: parsed.model, choices: [{ message: { content: 'OK' } }] }));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'KI GmbH');
    other = await createCompany(app, prisma, 'Andere KI GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
  });

  afterAll(async () => {
    await app.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  it('ohne Einrichtung: Platzhalter', async () => {
    const status = await api().get('/ai/gateway/status').set(auth).expect(200);
    expect(status.body).toMatchObject({ activeProvider: 'none', configured: false });
    const res = await api().post('/ai/gateway/complete').set(auth).send({ prompt: 'Hallo' }).expect(201);
    expect(res.body.providerName).toBe('none');
  });

  it('Anbieter einrichten, testen und nutzen', async () => {
    const created = await api()
      .post('/ai/providers')
      .set(auth)
      .send({
        name: 'Ollama im Büro',
        kind: 'openai_compatible',
        baseUrl: `${base}/v1`,
        model: 'llama3.1',
        apiKey: 'sk-geheim-123',
        isDefault: true,
      })
      .expect(201);
    expect(created.body).toMatchObject({ name: 'Ollama im Büro', hasApiKey: true, isDefault: true });
    expect(JSON.stringify(created.body)).not.toContain('sk-geheim');
    // in der Datenbank nur verschlüsselt, auch nicht im Audit-Log
    const stored = await prisma.aiProviderConfig.findUniqueOrThrow({ where: { id: created.body.id } });
    expect(stored.apiKeyEncrypted).toMatch(/^v1:/);
    expect(stored.apiKeyEncrypted).not.toContain('sk-geheim');
    const logs = await prisma.auditLog.findMany({ where: { companyId: company.companyId } });
    expect(JSON.stringify(logs)).not.toContain('sk-geheim');

    const listed = await api().get('/ai/providers').set(auth).expect(200);
    expect(JSON.stringify(listed.body)).not.toContain('sk-geheim');
    expect(listed.body[0]).not.toHaveProperty('apiKeyEncrypted');

    const test = await api().post(`/ai/providers/${created.body.id}/test`).set(auth).expect(201);
    expect(test.body).toMatchObject({ ok: true, text: 'OK', model: 'llama3.1' });
    expect(received.at(-1)).toMatchObject({
      path: '/v1/chat/completions',
      authorization: 'Bearer sk-geheim-123',
    });

    // Nutzen: Kontext wird nach Rechten gefiltert (Admin hat alle Rechte -> alles da)
    const res = await api()
      .post('/ai/gateway/complete')
      .set(auth)
      .send({
        prompt: 'Angebotstext',
        task: 'angebotstext',
        context: { artikel: { name: 'Kies', purchasePrice: 20 } },
      })
      .expect(201);
    expect(res.body).toMatchObject({ text: 'OK', providerName: 'Ollama im Büro' });
    expect(received.at(-1)!.body.messages[1].content).toContain('purchasePrice');
    const audit = await prisma.auditLog.findFirst({
      where: { companyId: company.companyId, action: 'ai_completion' },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit).toMatchObject({ source: 'ai', entityId: created.body.id });
    expect(audit!.newData).toMatchObject({
      task: 'angebotstext',
      provider: 'Ollama im Büro',
      kind: 'openai_compatible',
    });
    expect((await api().get('/ai/gateway/status').set(auth).expect(200)).body).toMatchObject({
      activeProvider: 'Ollama im Büro',
      configured: true,
    });
  });

  it('eigener Agent, Standard wechseln, Schlüssel löschen', async () => {
    const agent = await api()
      .post('/ai/providers')
      .set(auth)
      .send({ name: 'Eigener Agent', kind: 'agent', baseUrl: `${base}/agent`, isDefault: true })
      .expect(201);
    const providers = await api().get('/ai/providers').set(auth).expect(200);
    expect(providers.body.filter((p: { isDefault: boolean }) => p.isDefault)).toHaveLength(1);
    const res = await api()
      .post('/ai/gateway/complete')
      .set(auth)
      .send({ prompt: 'Plane', task: 'wochenplan' })
      .expect(201);
    expect(res.body).toMatchObject({ text: 'Agent: wochenplan', data: { ok: 1 } });
    expect(received.at(-1)!.body).toMatchObject({
      version: 1,
      caller: { companyId: company.companyId, userId: company.userId },
    });
    expect(received.at(-1)!.body.caller).not.toHaveProperty('email');

    const ollama = providers.body.find((p: { kind: string }) => p.kind === 'openai_compatible');
    const cleared = await api()
      .patch(`/ai/providers/${ollama.id}`)
      .set(auth)
      .send({ clearApiKey: true })
      .expect(200);
    expect(cleared.body.hasApiKey).toBe(false);
    // ausgeschaltet -> gezielt nicht nutzbar
    await api().patch(`/ai/providers/${ollama.id}`).set(auth).send({ enabled: false }).expect(200);
    await api()
      .post('/ai/gateway/complete')
      .set(auth)
      .send({ prompt: 'x', providerId: ollama.id })
      .expect(400);
    await api().delete(`/ai/providers/${agent.body.id}`).set(auth).expect(200);
    expect((await api().get('/ai/gateway/status').set(auth).expect(200)).body.configured).toBe(false);
  });

  it('Fehler des Anbieters: 502, im Protokoll', async () => {
    const broken = await api()
      .post('/ai/providers')
      .set(auth)
      .send({
        name: 'Weg',
        kind: 'openai_compatible',
        baseUrl: 'http://127.0.0.1:1/v1',
        model: 'x',
        isDefault: true,
      })
      .expect(201);
    const test = await api().post(`/ai/providers/${broken.body.id}/test`).set(auth).expect(201);
    expect(test.body).toMatchObject({ ok: false });
    expect(test.body.error).toContain('Nicht erreichbar');
    await api().post('/ai/gateway/complete').set(auth).send({ prompt: 'x' }).expect(502);
    expect(
      await prisma.auditLog.count({
        where: { companyId: company.companyId, action: 'ai_completion_failed' },
      }),
    ).toBe(2);
    await api().delete(`/ai/providers/${broken.body.id}`).set(auth).expect(200);
  });

  it('Schlüssel nicht mehr lesbar (SECRET_KEY geändert): verständliche Meldung', async () => {
    const created = await api()
      .post('/ai/providers')
      .set(auth)
      .send({ name: 'Alt', kind: 'openai_compatible', baseUrl: `${base}/v1`, model: 'm', apiKey: 'sk-alt' })
      .expect(201);
    await prisma.aiProviderConfig.update({
      where: { id: created.body.id },
      data: { apiKeyEncrypted: 'v1:AAAAAAAAAAAAAAAA:AAAAAAAAAAAAAAAAAAAAAA==:AAAA' },
    });
    const test = await api().post(`/ai/providers/${created.body.id}/test`).set(auth).expect(201);
    expect(test.body).toMatchObject({ ok: false });
    expect(test.body.error).toContain('bitte neu eingeben');
    const res = await api()
      .post('/ai/gateway/complete')
      .set(auth)
      .send({ prompt: 'x', providerId: created.body.id })
      .expect(400);
    expect(res.body.message).toContain('bitte neu eingeben');
    await api().delete(`/ai/providers/${created.body.id}`).set(auth).expect(200);
  });

  it('prüft Eingaben, Rechte und Mandanten', async () => {
    const bad = (body: object) => api().post('/ai/providers').set(auth).send(body).expect(400);
    await bad({ name: 'Meta', kind: 'openai_compatible', baseUrl: 'http://169.254.169.254/v1', model: 'x' });
    await bad({ name: 'Ohne Modell', kind: 'openai_compatible', baseUrl: `${base}/v1` });
    await bad({ name: 'Ohne Adresse', kind: 'agent' });
    await bad({ name: 'Falsch', kind: 'gibtsnicht', baseUrl: base });
    // Anthropic ohne Adresse: offizielle API
    const claude = await api()
      .post('/ai/providers')
      .set(auth)
      .send({ name: 'Claude', kind: 'anthropic', model: 'claude-sonnet', apiKey: 'sk-ant' })
      .expect(201);
    expect(claude.body.baseUrl).toBe('https://api.anthropic.com');

    // andere Firma sieht und ändert nichts
    const otherAuth = { Authorization: `Bearer ${other.token}` };
    expect((await api().get('/ai/providers').set(otherAuth).expect(200)).body).toEqual([]);
    await api().patch(`/ai/providers/${claude.body.id}`).set(otherAuth).send({ name: 'Fremd' }).expect(404);
    await api().delete(`/ai/providers/${claude.body.id}`).set(otherAuth).expect(404);
    await api().post(`/ai/providers/${claude.body.id}/test`).set(otherAuth).expect(404);

    // nur ai.use: nutzen ja, einrichten nein; Kontext ohne Einkaufspreise
    await api()
      .patch(
        `/ai/providers/${(await api().get('/ai/providers').set(auth)).body.find((p: { kind: string }) => p.kind === 'openai_compatible').id}`,
      )
      .set(auth)
      .send({ enabled: true, isDefault: true })
      .expect(200);
    const role = await prisma.role.create({
      data: {
        companyId: company.companyId,
        name: 'KI-Nutzer',
        permissions: {
          create: (await prisma.permission.findMany({ where: { key: { in: ['ai.use'] } } })).map((p) => ({
            permissionId: p.id,
          })),
        },
      },
    });
    await prisma.user.create({
      data: {
        companyId: company.companyId,
        email: 'nutzer@ki.test',
        passwordHash: await bcrypt.hash('test12345', 4),
        firstName: 'Nora',
        lastName: 'Nutzer',
        roles: { create: { roleId: role.id } },
      },
    });
    const login = await api().post('/auth/login').send({ email: 'nutzer@ki.test', password: 'test12345' });
    const userAuth = { Authorization: `Bearer ${login.body.accessToken}` };
    await api().get('/ai/providers').set(userAuth).expect(403);
    await api()
      .post('/ai/providers')
      .set(userAuth)
      .send({ name: 'Agent', kind: 'agent', baseUrl: base })
      .expect(403);
    await api()
      .post('/ai/gateway/complete')
      .set(userAuth)
      .send({ prompt: 'Preis?', context: { artikel: { name: 'Kies', salePrice: 30, purchasePrice: 20 } } })
      .expect(201);
    const sent = received.at(-1)!.body.messages[1].content as string;
    expect(sent).toContain('salePrice');
    expect(sent).not.toContain('purchasePrice');
  });
});
