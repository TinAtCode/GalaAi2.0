import { Logger } from '@nestjs/common';
import { FileStorage } from './file-storage.interface';
import { LocalDiskStorage } from './local-disk.storage';
import { S3Storage } from './s3.storage';

// STORAGE=s3 legt Dokumente in einem S3-kompatiblen Objektspeicher ab
// (S3_BUCKET, S3_ENDPOINT, S3_REGION, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY,
// S3_FORCE_PATH_STYLE, S3_PREFIX, S3_SSE), sonst im Dateisystem (UPLOADS_DIR).
export function createFileStorage(env: NodeJS.ProcessEnv = process.env): FileStorage {
  return env.STORAGE === 's3' ? new S3Storage() : new LocalDiskStorage();
}

// Beim Start einmal prüfen: ein falscher Bucket oder falsche Zugangsdaten
// stehen so sofort im Log und nicht erst beim ersten Upload
export async function fileStorageProvider(): Promise<FileStorage> {
  const storage = createFileStorage();
  await storage.check?.().then(
    () => new Logger('FileStorage').log(`Dokumente im Speicher „${storage.name}“`),
    (error: Error) =>
      new Logger('FileStorage').error({ msg: 'Objektspeicher nicht erreichbar', error: error.message }),
  );
  return storage;
}
