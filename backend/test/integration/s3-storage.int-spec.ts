import { INestApplication } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { CreateBucketCommand, GetObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { mkdtempSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import request from 'supertest';
import { migrateStorage } from '../../src/cli/migrate-storage';
import { LocalDiskStorage } from '../../src/documents/storage/local-disk.storage';
import { S3Storage, s3SettingsFromEnv } from '../../src/documents/storage/s3.storage';
import { createApp, createCompany, createProject, resetDatabase, TestCompany } from './helpers';

// Dokumente im S3-kompatiblen Objektspeicher. Braucht einen S3-Server unter
// S3_TEST_ENDPOINT (in der CI: moto_server, lokal z.B. MinIO oder moto).
const endpoint = process.env.S3_TEST_ENDPOINT;
const describeS3 = endpoint ? describe : describe.skip;

describeS3('Dokumente im Objektspeicher (S3)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;
  let company: TestCompany;
  let other: TestCompany;
  let projectId: string;
  const bucket = `gartenai-test-${Date.now()}`;
  const uploadsDir = mkdtempSync(join(tmpdir(), 'gartenai-s3-local-'));
  const saved: Record<string, string | undefined> = {};
  const env = {
    STORAGE: 's3',
    S3_ENDPOINT: endpoint,
    S3_BUCKET: bucket,
    S3_REGION: 'eu-central-1',
    S3_ACCESS_KEY_ID: 'test',
    S3_SECRET_ACCESS_KEY: 'test',
    S3_PREFIX: 'gartenai',
    UPLOADS_DIR: uploadsDir,
  };
  const api = () => request(app.getHttpServer());
  const raw = new S3Client({
    endpoint,
    region: 'eu-central-1',
    forcePathStyle: true,
    credentials: { accessKeyId: 'test', secretAccessKey: 'test' },
  });

  beforeAll(async () => {
    for (const [key, value] of Object.entries(env)) {
      saved[key] = process.env[key];
      process.env[key] = value;
    }
    await raw.send(new CreateBucketCommand({ Bucket: bucket }));
    ({ app, prisma } = await createApp());
    await resetDatabase(prisma);
    company = await createCompany(app, prisma, 'Speicher GmbH');
    other = await createCompany(app, prisma, 'Fremd Speicher GmbH');
    ({ projectId } = await createProject(app, company.token));
  });

  afterAll(async () => {
    await app.close();
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('lädt hoch, liest und löscht über den Objektspeicher', async () => {
    const auth = { Authorization: `Bearer ${company.token}` };
    const content = Buffer.from('Lieferschein Nr. 4711 – Rindenmulch 3 m³');
    const uploaded = await api()
      .post(`/documents/upload?projectId=${projectId}&documentType=delivery_note&ocr=false`)
      .set(auth)
      .attach('file', content, { filename: 'Lieferschein 4711.txt', contentType: 'text/plain' })
      .expect(201);
    const document = await prisma.document.findUniqueOrThrow({ where: { id: uploaded.body.id } });
    expect(document.storagePath.startsWith(`${company.companyId}/`)).toBe(true);

    // liegt im Bucket unter dem Präfix, nicht im lokalen Verzeichnis
    const object = await raw.send(
      new GetObjectCommand({ Bucket: bucket, Key: `gartenai/${document.storagePath}` }),
    );
    expect(Buffer.from(await object.Body!.transformToByteArray()).equals(content)).toBe(true);
    await expect(new LocalDiskStorage().read(company.companyId, document.storagePath)).rejects.toThrow();

    const download = await api()
      .get(`/documents/${document.id}/download`)
      .set(auth)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      })
      .expect(200);
    expect((download.body as Buffer).equals(content)).toBe(true);

    // fremde Firma: kein Zugriff, auch nicht mit dem Pfad
    await api()
      .get(`/documents/${document.id}/download`)
      .set({ Authorization: `Bearer ${other.token}` })
      .expect(404);
    const storage = new S3Storage(s3SettingsFromEnv());
    await expect(storage.read(other.companyId, document.storagePath)).rejects.toThrow('nicht gefunden');
    await expect(
      storage.read(other.companyId, `${other.companyId}/../${document.storagePath}`),
    ).rejects.toThrow('nicht gefunden');

    await api().delete(`/documents/${document.id}`).set(auth).expect(200);
    await expect(storage.read(company.companyId, document.storagePath)).rejects.toThrow('nicht gefunden');
  });

  it('zieht vorhandene Dateien vom Dateisystem um', async () => {
    const local = new LocalDiskStorage();
    const files = await Promise.all(
      ['Aufmaß.pdf', 'Foto.jpg'].map(async (name, i) => {
        const stored = await local.save(company.companyId, name, Buffer.from(`Inhalt ${i}`));
        await prisma.document.create({
          data: {
            companyId: company.companyId,
            projectId,
            fileName: name,
            documentType: 'other',
            storagePath: stored.storagePath,
          },
        });
        return stored.storagePath;
      }),
    );
    await prisma.document.create({
      data: {
        companyId: company.companyId,
        projectId,
        fileName: 'weg.pdf',
        documentType: 'other',
        storagePath: `${company.companyId}/gibt-es-nicht.pdf`,
      },
    });
    const target = new S3Storage(s3SettingsFromEnv());

    const dry = await migrateStorage(prisma, local, target, { dryRun: true });
    expect(dry).toMatchObject({ total: 3, copied: 2, skipped: 0 });
    expect(await target.exists(company.companyId, files[0])).toBe(false);

    const result = await migrateStorage(prisma, local, target);
    expect(result).toMatchObject({ total: 3, copied: 2, skipped: 0, failed: [] });
    expect(result.missing).toEqual([`${company.companyId}/gibt-es-nicht.pdf`]);
    expect((await target.read(company.companyId, files[1])).toString()).toBe('Inhalt 1');
    // zweiter Lauf: nichts mehr zu tun
    expect(await migrateStorage(prisma, local, target)).toMatchObject({ copied: 0, skipped: 2 });
  });
});
