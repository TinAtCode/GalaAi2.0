import { createServer, Server } from 'http';
import { AddressInfo } from 'net';
import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import request from 'supertest';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';

// Lageplan zeichnen mit KI: Vorschlag in Metern, umgerechnet und geprüft,
// nicht gespeichert. Ein eigener Agent kann zusätzlich ein Bild liefern.
describe('Lageplan zeichnen mit KI', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let other: TestCompany;
  let auth: { Authorization: string };
  let server: Server;
  let base: string;
  let planId: string;
  const received: { path?: string; body: any }[] = [];
  const api = () => request(app.getHttpServer());
  const png = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  );
  const drawing = {
    objects: [
      {
        type: 'paving',
        points: [
          [2, 2],
          [7, 2],
          [7, 6],
          [2, 6],
        ],
        label: 'Terrasse',
      },
      {
        type: 'lawn',
        points: [
          [8, 2],
          [20, 2],
          [20, 12],
          [8, 12],
        ],
        props: { mowingEdge: true },
      },
      { type: 'pictogram', points: [[15, 7]], props: { icon: 'drache' } }, // gibt es nicht
    ],
  };

  beforeAll(async () => {
    server = createServer((req, res) => {
      let body = '';
      req.on('data', (c) => (body += c));
      req.on('end', () => {
        const parsed = JSON.parse(body);
        received.push({ path: req.url, body: parsed });
        res.writeHead(200, { 'Content-Type': 'application/json' });
        if (req.url === '/agent') {
          res.end(
            JSON.stringify({
              text: 'Skizze fertig',
              data: {
                objects: [
                  {
                    type: 'fence',
                    points: [
                      [0, 0],
                      [10, 0],
                    ],
                  },
                ],
                image: { mediaType: 'image/png', data: png.toString('base64') },
              },
            }),
          );
        } else {
          res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(drawing) } }] }));
        }
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Zeichen GmbH');
    other = await createCompany(app, prisma, 'Andere GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    const { projectId } = await createProject(app, company.token);
    planId = (await api().post(`/projects/${projectId}/plans`).set(auth).send({ name: 'Garten' }).expect(201))
      .body.id;
  });

  afterAll(async () => {
    await app.close();
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  });

  const draw = (body: object, headers = auth) =>
    api().post(`/ai/assist/plans/${planId}/drawing`).set(headers).send(body);

  it('nur mit einem Anbieter, der zeichnen kann', async () => {
    // Text-Anbieter als Standard reicht nicht
    await api()
      .post('/ai/providers')
      .set(auth)
      .send({
        name: 'Text',
        kind: 'openai_compatible',
        baseUrl: `${base}/v1`,
        model: 'text',
        isDefault: true,
      })
      .expect(201);
    const res = await draw({ instruction: 'Terrasse und Rasen' }).expect(400);
    expect(res.body.message).toContain('kein KI-Anbieter');
  });

  it('Vorschlag in Metern, umgerechnet, geprüft, nicht gespeichert', async () => {
    const painter = await api()
      .post('/ai/providers')
      .set(auth)
      .send({
        name: 'Zeichner',
        kind: 'openai_compatible',
        baseUrl: `${base}/v1`,
        model: 'zeichnen',
        capabilities: ['text', 'image'],
      })
      .expect(201);
    await api()
      .put('/ai/tasks/lageplan_zeichnen')
      .set(auth)
      .send({ providerId: painter.body.id })
      .expect(200);

    const res = await draw({
      instruction: 'Terrasse 5 × 4 m links, Rasen rechts mit Mähkante',
      unitsPerMeter: 10,
      objects: [
        {
          id: 'haus',
          type: 'fence',
          points: [
            [0, 0],
            [100, 0],
          ],
        },
      ],
    }).expect(201);
    expect(res.body.dropped).toBe(1);
    expect(res.body.objects).toHaveLength(2);
    expect(res.body.objects[0]).toMatchObject({
      type: 'paving',
      label: 'Terrasse',
      points: [
        [20, 20],
        [70, 20],
        [70, 60],
        [20, 60],
      ],
    });
    expect(res.body.image).toBeNull();

    // die KI sieht den aktuellen Stand in Metern und die erlaubten Arten
    const sent = received.at(-1)!.body.messages[1].content as string;
    expect(sent).toContain('Terrasse 5 × 4 m links');
    const context = JSON.parse(sent.split('Daten aus GartenAI (JSON):\n')[1]);
    expect(context.flaecheInMetern).toEqual({ breite: 200, hoehe: 150 });
    expect(context.vorhandeneObjekte).toEqual([
      {
        type: 'fence',
        points: [
          [0, 0],
          [10, 0],
        ],
      },
    ]);
    expect(context.objektarten.lawn).toBe('Rasenfläche (area)');

    // nichts gespeichert
    const plan = await api().get(`/plans/${planId}`).set(auth).expect(200);
    expect(plan.body.objects).toEqual([]);

    // ungültiger aktueller Stand: 400
    await draw({ instruction: 'mehr', objects: [{ id: 'x', type: 'lawn', points: [] }] }).expect(400);
  });

  it('eigener Agent: Objekte strukturiert und Bild als Hintergrund-Vorschlag', async () => {
    const agent = await api()
      .post('/ai/providers')
      .set(auth)
      .send({ name: 'Zeichen-Agent', kind: 'agent', baseUrl: `${base}/agent`, capabilities: ['image'] })
      .expect(201);
    await api().put('/ai/tasks/lageplan_zeichnen').set(auth).send({ providerId: agent.body.id }).expect(200);
    const res = await draw({ instruction: 'Zaun oben' }).expect(201);
    expect(res.body).toMatchObject({
      providerName: 'Zeichen-Agent',
      note: 'Skizze fertig',
      image: { mediaType: 'image/png', data: png.toString('base64') },
    });
    // gespeicherter Maßstab: 50 Einheiten je Meter
    expect(res.body.objects[0].points).toEqual([
      [0, 0],
      [500, 0],
    ]);
    expect(received.at(-1)!.body.task).toBe('lageplan_zeichnen');
  });

  it('Rechte und Mandanten', async () => {
    await draw({ instruction: 'Zaun oben' }, { Authorization: `Bearer ${other.token}` }).expect(404);
    await draw({ instruction: 'x' }).expect(400); // zu kurz
  });
});
