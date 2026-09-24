import { NotFoundException } from '@nestjs/common';
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  NoSuchKey,
  PutObjectCommand,
  S3Client,
  ServerSideEncryption,
} from '@aws-sdk/client-s3';
import { randomUUID } from 'crypto';
import { basename, extname, posix } from 'path';
import { FileStorage, StoredFile } from './file-storage.interface';

export interface S3Settings {
  bucket: string;
  endpoint?: string;
  region: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  forcePathStyle: boolean;
  // Präfix vor allen Schlüsseln, z.B. "gartenai/" bei geteiltem Bucket
  prefix: string;
  serverSideEncryption?: ServerSideEncryption;
}

export function s3SettingsFromEnv(env: NodeJS.ProcessEnv = process.env): S3Settings {
  const bucket = env.S3_BUCKET;
  if (!bucket) throw new Error('STORAGE=s3 braucht S3_BUCKET.');
  const prefix = (env.S3_PREFIX ?? '').replace(/^\/+/, '');
  return {
    bucket,
    endpoint: env.S3_ENDPOINT || undefined,
    region: env.S3_REGION || 'eu-central-1',
    accessKeyId: env.S3_ACCESS_KEY_ID || undefined,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY || undefined,
    // MinIO, Ceph und die meisten deutschen Anbieter brauchen Pfad-Adressierung
    forcePathStyle: env.S3_FORCE_PATH_STYLE ? env.S3_FORCE_PATH_STYLE !== 'false' : !!env.S3_ENDPOINT,
    prefix: prefix && !prefix.endsWith('/') ? `${prefix}/` : prefix,
    serverSideEncryption: (env.S3_SSE || undefined) as ServerSideEncryption | undefined,
  };
}

// S3-kompatibler Objektspeicher (AWS, Hetzner, IONOS, Wasabi, MinIO, Ceph …).
// Schlüssel wie beim lokalen Speicher: <companyId>/<uuid>-<name>, damit ein
// Umzug (dist/cli/migrate-storage.js) die gespeicherten Pfade nicht ändert.
export class S3Storage implements FileStorage {
  readonly name = 's3';
  private readonly client: S3Client;

  constructor(private readonly settings: S3Settings = s3SettingsFromEnv()) {
    this.client = new S3Client({
      region: settings.region,
      endpoint: settings.endpoint,
      forcePathStyle: settings.forcePathStyle,
      credentials:
        settings.accessKeyId && settings.secretAccessKey
          ? { accessKeyId: settings.accessKeyId, secretAccessKey: settings.secretAccessKey }
          : undefined,
    });
  }

  // Wie der Pfad-Traversal-Schutz beim lokalen Speicher: der Schlüssel muss
  // im Bereich der Firma liegen (storagePath kann vom Client stammen)
  private keyInCompany(companyId: string, storagePath: string) {
    const normalized = posix.normalize(storagePath.replace(/\\/g, '/'));
    if (!normalized.startsWith(`${companyId}/`) || normalized.split('/').includes('..')) {
      throw new NotFoundException('Datei nicht gefunden.');
    }
    return `${this.settings.prefix}${normalized}`;
  }

  async save(companyId: string, originalName: string, content: Buffer): Promise<StoredFile> {
    const safeName = basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const storagePath = `${companyId}/${randomUUID()}${extname(safeName) || ''}-${safeName}`;
    await this.put(companyId, storagePath, content);
    return { storagePath };
  }

  // auch für den Umzug vom lokalen Speicher (gleicher Schlüssel)
  async put(companyId: string, storagePath: string, content: Buffer) {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.settings.bucket,
        Key: this.keyInCompany(companyId, storagePath),
        Body: content,
        ContentLength: content.length,
        ServerSideEncryption: this.settings.serverSideEncryption,
      }),
    );
  }

  async read(companyId: string, storagePath: string): Promise<Buffer> {
    try {
      const result = await this.client.send(
        new GetObjectCommand({
          Bucket: this.settings.bucket,
          Key: this.keyInCompany(companyId, storagePath),
        }),
      );
      return Buffer.from(await result.Body!.transformToByteArray());
    } catch (error) {
      if (error instanceof NoSuchKey || (error as { name?: string }).name === 'NoSuchKey') {
        throw new NotFoundException('Datei nicht gefunden.');
      }
      throw error;
    }
  }

  async exists(companyId: string, storagePath: string) {
    return this.read(companyId, storagePath).then(
      () => true,
      (error) => {
        if (error instanceof NotFoundException) return false;
        throw error;
      },
    );
  }

  async remove(companyId: string, storagePath: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({
        Bucket: this.settings.bucket,
        Key: this.keyInCompany(companyId, storagePath),
      }),
    );
  }

  // Erreichbarkeit und Zugangsdaten prüfen (Start, Health-Check)
  async check() {
    await this.client.send(new HeadBucketCommand({ Bucket: this.settings.bucket }));
  }
}
