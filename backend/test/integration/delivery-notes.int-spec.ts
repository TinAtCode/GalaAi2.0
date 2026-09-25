import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { buildTestPdf } from '../fixtures/test-pdf';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';

// Projektnummer, Lieferschein erkennen und zuordnen, Mail-Entwurf an den Lieferanten
describe('Lieferscheine', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let other: TestCompany;
  let projectId: string;
  const uploadsDir = mkdtempSync(join(tmpdir(), 'gartenai-ls-'));
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${company.token}` });

  async function waitForNote(documentId: string) {
    for (let i = 0; i < 60; i++) {
      const note = await prisma.deliveryNote.findUnique({ where: { documentId } });
      if (note) return note;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Lieferschein wurde nicht erkannt');
  }

  beforeAll(async () => {
    process.env.UPLOADS_DIR = uploadsDir;
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Liefer GmbH');
    other = await createCompany(app, prisma, 'Andere GmbH');
    ({ projectId } = await createProject(app, company.token));
  });

  afterAll(async () => {
    await app.close();
    delete process.env.UPLOADS_DIR;
  });

  it('vergibt fortlaufende Projektnummern je Jahr', async () => {
    const project = (await api().get(`/projects/${projectId}`).set(auth()).expect(200)).body;
    const year = new Date().getFullYear();
    expect(project.number).toBe(`P-${year}-0001`);
    const { projectId: second } = await createProject(app, company.token);
    expect((await api().get(`/projects/${second}`).set(auth()).expect(200)).body.number).toBe(
      `P-${year}-0002`,
    );
    // andere Firma zählt eigenständig
    const { projectId: foreign } = await createProject(app, other.token);
    const foreignProject = await prisma.project.findUniqueOrThrow({ where: { id: foreign } });
    expect(foreignProject.number).toBe(`P-${year}-0001`);
    // nach Nummer suchen
    const found = (await api().get(`/projects?q=P-${year}-0002`).set(auth()).expect(200)).body;
    expect(found.map((p: { id: string }) => p.id)).toEqual([second]);
  });

  it('erkennt Lieferant und Projekt aus dem Lieferschein; das Büro bestätigt', async () => {
    const project = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
    const supplier = (
      await api()
        .post('/suppliers')
        .set(auth())
        .send({ name: 'Baustoffe Meyer GmbH', email: 'info@meyer-baustoffe.de', customerNumber: 'K-778' })
        .expect(201)
    ).body;

    // ohne Projekt hochgeladen: GartenAI findet es an der Projektnummer
    // kurz halten: die Test-PDF ist nur 400 pt breit
    const pdf = buildTestPdf(`Baustoffe Meyer LS-4711 24.09.2026 ${project.number}`);
    const uploaded = await api()
      .post('/documents/upload?ocr=1&documentType=delivery_note')
      .set(auth())
      .attach('file', pdf, { filename: 'scan.pdf', contentType: 'application/pdf' })
      .expect(201);
    await waitForNote(uploaded.body.id);

    const inbox = (await api().get('/delivery-notes?status=open').set(auth()).expect(200)).body;
    expect(inbox).toHaveLength(1);
    expect(inbox[0]).toMatchObject({
      status: 'open',
      noteNumber: '4711',
      noteDate: '2026-09-24',
      supplier: { id: supplier.id },
      project: { id: projectId, number: project.number },
    });
    expect(inbox[0].hints.project).toContain('Projektnummer');
    const doc = await prisma.document.findUniqueOrThrow({ where: { id: uploaded.body.id } });
    expect(doc.projectId).toBeNull();

    const confirmed = (
      await api()
        .put(`/delivery-notes/${inbox[0].id}`)
        .set(auth())
        .send({ noteNumber: 'LS-4711' })
        .expect(200)
    ).body;
    expect(confirmed).toMatchObject({ status: 'confirmed', noteNumber: 'LS-4711' });
    expect((await prisma.document.findUniqueOrThrow({ where: { id: uploaded.body.id } })).projectId).toBe(
      projectId,
    );
    const atProject = (await api().get(`/projects/${projectId}/delivery-notes`).set(auth()).expect(200)).body;
    expect(atProject.map((n: { id: string }) => n.id)).toEqual([inbox[0].id]);
    // bestätigte Lieferscheine ändert eine erneute Erkennung nicht
    const again = (
      await api().post('/delivery-notes').set(auth()).send({ documentId: uploaded.body.id }).expect(201)
    ).body;
    expect(again.noteNumber).toBe('LS-4711');

    // Mail-Entwurf mit Projektnummer und Kundennummer
    const mail = (
      await api()
        .get(`/projects/${projectId}/supplier-mail?supplierId=${supplier.id}`)
        .set(auth())
        .expect(200)
    ).body;
    expect(mail.to).toBe('info@meyer-baustoffe.de');
    expect(mail.subject).toContain(project.number);
    expect(mail.body).toContain(`Projektnummer: ${project.number}`);
    expect(mail.body).toContain('Unsere Kundennummer bei Ihnen: K-778');
    expect(mail.mailto.startsWith('mailto:info%40meyer-baustoffe.de?subject=')).toBe(true);

    // andere Firma: nichts
    const foreign = { Authorization: `Bearer ${other.token}` };
    expect((await api().get('/delivery-notes').set(foreign).expect(200)).body).toEqual([]);
    await api().put(`/delivery-notes/${inbox[0].id}`).set(foreign).send({}).expect(404);
    await api()
      .get(`/projects/${projectId}/supplier-mail?supplierId=${supplier.id}`)
      .set(foreign)
      .expect(404);
  });
});
