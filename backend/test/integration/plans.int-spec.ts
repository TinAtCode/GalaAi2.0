import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import PDFDocument from 'pdfkit';
import request from 'supertest';
import { EMPLOYEE_PERMISSIONS } from '../../src/common/permissions';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';

// kleinstes gültiges PNG-Gerüst genügt für die Größenerkennung
function png(width: number, height: number) {
  const buffer = Buffer.alloc(33);
  buffer.writeUInt32BE(0x89504e47, 0);
  buffer.writeUInt32BE(0x0d0a1a0a, 4);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'ascii');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  return buffer;
}

const lawn = {
  id: 'l1',
  type: 'lawn',
  points: [
    [0, 0],
    [500, 0],
    [500, 200],
    [0, 200],
  ],
  props: { mowingEdge: true },
};
const pipe = {
  id: 'r1',
  type: 'rainwater',
  points: [
    [0, 0],
    [250, 0],
  ],
};

// Lagepläne am Projekt: anlegen, zeichnen (mit Versionsschutz), Mengen,
// Hintergrund und Maßstab, Rechte und Mandantentrennung
describe('Lagepläne', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let auth: { Authorization: string };
  let projectId: string;
  const api = () => request(app.getHttpServer());

  beforeAll(async () => {
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Plan GmbH');
    auth = { Authorization: `Bearer ${company.token}` };
    ({ projectId } = await createProject(app, company.token));
  });

  afterAll(async () => {
    await app.close();
  });

  it('anlegen, zeichnen, Mengen; gleichzeitiges Speichern wird erkannt', async () => {
    const created = await api()
      .post(`/projects/${projectId}/plans`)
      .set(auth)
      .send({ name: 'Garten Süd' })
      .expect(201);
    expect(created.body).toMatchObject({
      name: 'Garten Süd',
      unitsPerMeter: 50,
      objects: [],
      version: 1,
      background: null,
    });

    const saved = await api()
      .put(`/plans/${created.body.id}`)
      .set(auth)
      .send({ version: 1, objects: [lawn, pipe] })
      .expect(200);
    expect(saved.body.version).toBe(2);
    expect(saved.body.quantities).toEqual([
      { key: 'lawn', label: 'Rasenfläche', unit: 'm²', quantity: 40 },
      { key: 'lawn:mowingEdge', label: 'Mähkante', unit: 'm', quantity: 28 },
      { key: 'rainwater', label: 'Regenwasserleitung', unit: 'm', quantity: 5 },
    ]);
    // zweites Fenster mit altem Stand
    await api().put(`/plans/${created.body.id}`).set(auth).send({ version: 1, objects: [] }).expect(409);
    // Maßstab ändern: Mengen passen sich an, Zeichnung bleibt
    const scaled = await api()
      .put(`/plans/${created.body.id}`)
      .set(auth)
      .send({ version: 2, unitsPerMeter: 25 })
      .expect(200);
    expect(scaled.body.quantities.find((q: { key: string }) => q.key === 'rainwater').quantity).toBe(10);
    expect(scaled.body.objects).toHaveLength(2);

    await api()
      .put(`/plans/${created.body.id}`)
      .set(auth)
      .send({ version: 3, objects: [{ id: 'x', type: 'lawn', points: [[0, 0]] }] })
      .expect(400);
    // großer Plan (über der Standardgrenze von 100 kB) lässt sich speichern
    const many = Array.from({ length: 400 }, (_, i) => ({
      id: `z${i}`,
      type: 'fence',
      points: Array.from({ length: 20 }, (_, j) => [i * 10.12345, j * 10.54321]),
    }));
    const big = await api()
      .put(`/plans/${created.body.id}`)
      .set(auth)
      .send({ version: 3, objects: many })
      .expect(200);
    await api()
      .put(`/plans/${created.body.id}`)
      .set(auth)
      .send({ version: big.body.version, objects: [lawn, pipe] })
      .expect(200);
    const list = await api().get(`/projects/${projectId}/plans`).set(auth).expect(200);
    expect(list.body).toEqual([
      expect.objectContaining({ name: 'Garten Süd', objectCount: 2, hasBackground: false }),
    ]);
  });

  it('Hintergrund: Bild oder PDF (erste Seite), liegt als Dokument am Projekt', async () => {
    const plan = (
      await api().post(`/projects/${projectId}/plans`).set(auth).send({ name: 'Mit Luftbild' }).expect(201)
    ).body;
    const withImage = await api()
      .post(`/plans/${plan.id}/background`)
      .set(auth)
      .attach('file', png(1600, 900), { filename: 'luftbild.png', contentType: 'image/png' })
      .expect(201);
    expect(withImage.body.background).toMatchObject({ width: 1600, height: 900 });
    expect(withImage.body.version).toBe(2);
    const image = await api().get(`/plans/${plan.id}/background`).set(auth).expect(200);
    expect(image.headers['content-type']).toBe('image/png');
    const doc = await prisma.document.findUniqueOrThrow({
      where: { id: withImage.body.background.documentId },
    });
    expect(doc).toMatchObject({ projectId, documentType: 'floor_plan' });

    const pdf = await new Promise<Buffer>((resolve) => {
      const d = new PDFDocument({ size: 'A4' });
      const chunks: Buffer[] = [];
      d.on('data', (c: Buffer) => chunks.push(c));
      d.on('end', () => resolve(Buffer.concat(chunks)));
      d.text('Lageplan M 1:200');
      d.end();
    });
    const withPdf = await api()
      .post(`/plans/${plan.id}/background`)
      .set(auth)
      .attach('file', pdf, { filename: 'plan.pdf', contentType: 'application/pdf' })
      .expect(201);
    // A4 hoch, auf 2400 Pixel Breite gerendert
    expect(withPdf.body.background.width).toBe(2400);
    expect(withPdf.body.background.height).toBeGreaterThan(3300);
    await api()
      .post(`/plans/${plan.id}/background`)
      .set(auth)
      .attach('file', Buffer.from('text'), { filename: 'a.txt', contentType: 'text/plain' })
      .expect(400);

    const cleared = await api().delete(`/plans/${plan.id}/background`).set(auth).expect(200);
    expect(cleared.body.background).toBeNull();
    await api().get(`/plans/${plan.id}/background`).set(auth).expect(404);
    await api().delete(`/plans/${plan.id}`).set(auth).expect(200);
    await api().get(`/plans/${plan.id}`).set(auth).expect(404);
  });

  it('Mengen ins Angebot: passende Leistungen, Umrechnung, gemerkte Zuordnung, Rundung der Leistung', async () => {
    const plan = (
      await api().post(`/projects/${projectId}/plans`).set(auth).send({ name: 'Angebot' }).expect(201)
    ).body;
    // Rasen 10 × 4,01 m mit Mähkante, Leitung 5 m, Tor
    const lawnOdd = {
      ...lawn,
      points: [
        [0, 0],
        [500, 0],
        [500, 200.5],
        [0, 200.5],
      ],
    };
    await api()
      .put(`/plans/${plan.id}`)
      .set(auth)
      .send({
        version: 1,
        objects: [
          lawnOdd,
          pipe,
          {
            id: 'g1',
            type: 'gate',
            points: [
              [0, 0],
              [175, 0],
            ],
          },
        ],
      })
      .expect(200);
    const service = async (name: string, unit: string, extra: object = {}) => {
      const id = (
        await api()
          .post('/services')
          .set(auth)
          .send({ name, unit, ...extra })
          .expect(201)
      ).body.id;
      await api().post(`/services/${id}/components`).set(auth).send({ laborMinutes: 6 }).expect(201);
      return id;
    };
    const turf = await service('Rollrasen verlegen', 'qm', { quantityDecimals: 0, quantityRounding: 'up' });
    const edge = await service('Mähkante setzen', 'm');
    const edgeCm = await service('Mähkante (cm)', 'cm');
    const gateService = await service('Tor montieren', 'Stk');

    const draft = (await api().get(`/plans/${plan.id}/quote-draft`).set(auth).expect(200)).body;
    const row = (key: string) => draft.rows.find((r: { key: string }) => r.key === key);
    expect(row('lawn')).toMatchObject({ quantity: 40.1, unit: 'm²', serviceId: null });
    // nur Leistungen derselben Dimension, umgerechnet
    expect(row('lawn').candidates.map((c: { id: string }) => c.id)).toEqual([turf]);
    expect(row('lawn:mowingEdge').candidates).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: edge, quantity: 28.02 }),
        expect.objectContaining({ id: edgeCm, quantity: 2802 }),
      ]),
    );
    expect(row('gate').candidates.map((c: { id: string }) => c.id)).toEqual([gateService]);

    // Zuordnung merken
    await api().put('/plan-mappings/lawn').set(auth).send({ serviceId: turf }).expect(200);
    await api().put('/plan-mappings/lawn:mowingEdge').set(auth).send({ serviceId: edge }).expect(200);
    await api().put('/plan-mappings/pool').set(auth).send({ serviceId: turf }).expect(400);
    await api().put('/plan-mappings/pictogram:toString').set(auth).send({ serviceId: turf }).expect(400);
    const again = (await api().get(`/plans/${plan.id}/quote-draft`).set(auth).expect(200)).body;
    expect(again.rows.find((r: { key: string }) => r.key === 'lawn').serviceId).toBe(turf);

    // Angebot über die normale Angebots-API: Rasen auf ganze m² aufgerundet
    const quote = await api()
      .post('/quotes')
      .set(auth)
      .send({
        projectId,
        lineItems: [
          { serviceId: turf, quantity: 40.1 },
          { serviceId: edge, quantity: 28.02 },
        ],
      })
      .expect(201);
    expect(quote.body.lineItems.map((l: { quantity: string }) => Number(l.quantity))).toEqual([41, 28.02]);

    // Zuordnung entfernen; gelöschte Leistung fällt aus der Zuordnung
    await api().put('/plan-mappings/lawn:mowingEdge').set(auth).send({ serviceId: null }).expect(200);
    const cleared = (await api().get(`/plans/${plan.id}/quote-draft`).set(auth).expect(200)).body;
    expect(cleared.rows.find((r: { key: string }) => r.key === 'lawn:mowingEdge').serviceId).toBeNull();
  });

  it('Mitarbeiter sehen Pläne, zeichnen nicht; fremde Firmen sehen nichts', async () => {
    const plan = (
      await api().post(`/projects/${projectId}/plans`).set(auth).send({ name: 'Baustelle' }).expect(201)
    ).body;
    const role = await prisma.role.create({
      data: {
        companyId: company.companyId,
        name: 'Mitarbeiter Test',
        permissions: { create: EMPLOYEE_PERMISSIONS.map((key) => ({ permission: { connect: { key } } })) },
      },
    });
    await prisma.user.create({
      data: {
        companyId: company.companyId,
        email: 'baustelle@plan.example',
        passwordHash: await bcrypt.hash('test12345', 4),
        firstName: 'B',
        lastName: 'B',
        roles: { create: { roleId: role.id } },
      },
    });
    const login = await api()
      .post('/auth/login')
      .send({ email: 'baustelle@plan.example', password: 'test12345' })
      .expect(201);
    const staff = { Authorization: `Bearer ${login.body.accessToken}` };
    await api().get(`/plans/${plan.id}`).set(staff).expect(200);
    await api().get(`/projects/${projectId}/plans`).set(staff).expect(200);
    await api().put(`/plans/${plan.id}`).set(staff).send({ version: 1, objects: [] }).expect(403);
    await api().post(`/projects/${projectId}/plans`).set(staff).send({ name: 'Neu' }).expect(403);

    const other = await createCompany(app, prisma, 'Fremd Plan GmbH');
    const foreign = { Authorization: `Bearer ${other.token}` };
    await api().get(`/plans/${plan.id}`).set(foreign).expect(404);
    await api().put(`/plans/${plan.id}`).set(foreign).send({ version: 1, objects: [] }).expect(404);
    await api().get(`/projects/${projectId}/plans`).set(foreign).expect(404);
    await api().post(`/projects/${projectId}/plans`).set(foreign).send({ name: 'Fremd' }).expect(404);
    await api().delete(`/plans/${plan.id}`).set(foreign).expect(404);
    await api().get(`/plans/${plan.id}/quote-draft`).set(foreign).expect(404);
    await api().get(`/plans/${plan.id}/quote-draft`).set(staff).expect(403);
    // fremde Leistung zuordnen
    const ownService = (
      await api().post('/services').set(auth).send({ name: 'Zaun setzen', unit: 'm' }).expect(201)
    ).body.id;
    await api().put('/plan-mappings/fence').set(foreign).send({ serviceId: ownService }).expect(404);
  });
});
