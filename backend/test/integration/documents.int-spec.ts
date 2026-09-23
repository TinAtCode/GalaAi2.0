import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { existsSync, mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import * as bcrypt from 'bcrypt';
import request from 'supertest';
import { buildTestPdf } from '../fixtures/test-pdf';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';

type ListedDocument = {
  id: string;
  fileName: string;
  documentType: string;
  ocrStatus: string | null;
  ocrSnippet: string | null;
  ocrText?: string;
};

// Dokumente am Projekt: hochladen (optional mit Texterkennung), suchen, löschen.
describe('Dokumente mit Texterkennung', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let projectId: string;
  const uploadsDir = mkdtempSync(join(tmpdir(), 'gartenai-docs-'));
  const api = () => request(app.getHttpServer());
  const auth = () => ({ Authorization: `Bearer ${company.token}` });
  const list = async (q = '') =>
    (
      await api()
        .get(`/documents/by-project/${projectId}${q ? `?q=${encodeURIComponent(q)}` : ''}`)
        .set(auth())
        .expect(200)
    ).body as ListedDocument[];
  const upload = (file: Buffer, name: string, type: string, query: string) =>
    api()
      .post(`/documents/upload?projectId=${projectId}${query}`)
      .set(auth())
      .attach('file', file, { filename: name, contentType: type });

  async function waitForOcr(id: string) {
    for (let i = 0; i < 50; i++) {
      const doc = await prisma.document.findUniqueOrThrow({ where: { id } });
      if (doc.ocrStatus === 'done' || doc.ocrStatus === 'failed') return doc;
      await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('Texterkennung wurde nicht fertig');
  }

  beforeAll(async () => {
    process.env.UPLOADS_DIR = uploadsDir;
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Dokument GmbH');
    ({ projectId } = await createProject(app, company.token));
  });

  afterAll(async () => {
    await app.close();
    delete process.env.UPLOADS_DIR;
  });

  it('lädt mit Texterkennung hoch; der Text ist am Dokument durchsuchbar', async () => {
    const pdf = buildTestPdf('Lieferschein 8812 Rasengittersteine 40 Stück');
    const res = await upload(
      pdf,
      'lieferschein.pdf',
      'application/pdf',
      '&documentType=delivery_note&ocr=1',
    ).expect(201);
    expect(res.body).toMatchObject({ fileName: 'lieferschein.pdf', ocrStatus: 'queued' });
    const done = await waitForOcr(res.body.id);
    expect(done.ocrStatus).toBe('done');
    expect(done.ocrText).toContain('Rasengittersteine');
    const job = await prisma.ocrJob.findFirstOrThrow({ where: { documentId: res.body.id } });
    expect(job.status).toBe('done');

    // ohne Texterkennung
    await upload(Buffer.from('Foto'), 'baustelle.jpg', 'image/jpeg', '&documentType=site_document').expect(
      201,
    );

    const all = await list();
    expect(all.map((d) => d.fileName)).toEqual(['baustelle.jpg', 'lieferschein.pdf']);
    const listed = all.find((d) => d.fileName === 'lieferschein.pdf')!;
    expect(listed.ocrText).toBeUndefined(); // Liste nur mit Ausschnitt
    expect(listed.ocrSnippet).toContain('Rasengittersteine');
    expect(all.find((d) => d.fileName === 'baustelle.jpg')!.ocrStatus).toBeNull();

    expect((await list('rasengitter')).map((d) => d.fileName)).toEqual(['lieferschein.pdf']);
    expect((await list('BAUSTELLE')).map((d) => d.fileName)).toEqual(['baustelle.jpg']);
    expect(await list('Pflaster')).toEqual([]);
    // Leerraum im Suchbegriff wie im Text vereinheitlicht
    expect((await list('Rasengittersteine   40')).map((d) => d.fileName)).toEqual(['lieferschein.pdf']);

    // auch die firmenweite Liste nur mit Ausschnitt
    const company = (await api().get('/documents').set(auth()).expect(200)).body as ListedDocument[];
    expect(company.every((d) => d.ocrText === undefined)).toBe(true);
  });

  it('Texterkennung nur für PDF und Bilder – sonst 400, nichts gespeichert', async () => {
    await upload(Buffer.from('hallo'), 'notiz.txt', 'text/plain', '&ocr=1').expect(400);
    expect(await prisma.document.count({ where: { fileName: 'notiz.txt' } })).toBe(0);
    // ohne Texterkennung sind andere Dateien erlaubt
    await upload(Buffer.from('hallo'), 'notiz.txt', 'text/plain', '').expect(201);
  });

  it('Löschen braucht das Recht document.delete, Lesen allein reicht nicht', async () => {
    const doc = await prisma.document.findFirstOrThrow({ where: { fileName: 'lieferschein.pdf' } });
    const readOnly = await prisma.role.create({
      data: {
        companyId: company.companyId,
        name: 'Nur lesen',
        permissions: {
          create: {
            permission: { connect: { key: 'document.read' } },
          },
        },
      },
    });
    await prisma.user.create({
      data: {
        companyId: company.companyId,
        email: 'leser@dokument.test',
        passwordHash: await bcrypt.hash('test12345', 4),
        firstName: 'Lea',
        lastName: 'Leser',
        roles: { create: { roleId: readOnly.id } },
      },
    });
    const login = await api()
      .post('/auth/login')
      .send({ email: 'leser@dokument.test', password: 'test12345' })
      .expect(201);
    const reader = { Authorization: `Bearer ${login.body.accessToken}` };
    await api().get(`/documents/by-project/${projectId}`).set(reader).expect(200);
    await api().delete(`/documents/${doc.id}`).set(reader).expect(403);
    expect(await prisma.document.count({ where: { id: doc.id } })).toBe(1);
  });

  it('löscht Eintrag, Datei und OCR-Aufträge (mit dem erkannten Text), mit Audit-Log', async () => {
    const doc = await prisma.document.findFirstOrThrow({ where: { fileName: 'lieferschein.pdf' } });
    const path = join(uploadsDir, doc.storagePath);
    expect(existsSync(path)).toBe(true);
    await api().delete(`/documents/${doc.id}`).set(auth()).expect(200);
    expect(existsSync(path)).toBe(false);
    expect(await prisma.document.count({ where: { id: doc.id } })).toBe(0);
    expect(await prisma.ocrJob.count({ where: { fileName: 'lieferschein.pdf' } })).toBe(0);
    const audit = await prisma.auditLog.findFirstOrThrow({
      where: { action: 'document_delete', entityId: doc.id },
    });
    expect(audit.oldData).toMatchObject({ fileName: 'lieferschein.pdf', documentType: 'delivery_note' });
    await api().delete(`/documents/${doc.id}`).set(auth()).expect(404);
  });

  it('eine Datei, auf die ein weiteres Dokument verweist, bleibt erhalten', async () => {
    const doc = await prisma.document.findFirstOrThrow({ where: { fileName: 'baustelle.jpg' } });
    // zweiter Eintrag auf dieselbe Datei (POST /documents nimmt storagePath
    // entgegen) – in anderer Schreibweise desselben Pfads
    const [dir, file] = doc.storagePath.split('/');
    const copy = await api()
      .post('/documents')
      .set(auth())
      .send({ fileName: 'kopie.jpg', storagePath: `./${dir}//./${file}`, projectId })
      .expect(201);
    expect(copy.body.storagePath).toBe(doc.storagePath);
    await api().delete(`/documents/${doc.id}`).set(auth()).expect(200);
    expect(existsSync(join(uploadsDir, doc.storagePath))).toBe(true);
    await api().get(`/documents/${copy.body.id}/download`).set(auth()).expect(200);
  });

  it('fremde Firma kann Dokumente weder löschen noch durchsuchen', async () => {
    const doc = await prisma.document.findFirstOrThrow({ where: { companyId: company.companyId } });
    const other = await createCompany(app, prisma, 'Fremd Dokument GmbH');
    const otherAuth = { Authorization: `Bearer ${other.token}` };
    await api().delete(`/documents/${doc.id}`).set(otherAuth).expect(404);
    await api().get(`/documents/by-project/${projectId}?q=a`).set(otherAuth).expect(404);
    expect(await prisma.document.count({ where: { id: doc.id } })).toBe(1);
  });

  it('nach einem Neustart gilt eine unterbrochene Texterkennung als fehlgeschlagen', async () => {
    const doc = await prisma.document.findFirstOrThrow({ where: { companyId: company.companyId } });
    await prisma.document.update({ where: { id: doc.id }, data: { ocrStatus: 'running' } });
    const { OcrJobsService } = await import('../../src/ocr/ocr-jobs.service');
    await app.get(OcrJobsService).onModuleInit();
    expect((await prisma.document.findUniqueOrThrow({ where: { id: doc.id } })).ocrStatus).toBe('failed');
  });
});
