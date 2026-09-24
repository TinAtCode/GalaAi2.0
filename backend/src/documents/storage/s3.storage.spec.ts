import { S3Storage, s3SettingsFromEnv } from './s3.storage';
import { createFileStorage } from './file-storage.factory';

describe('S3-Objektspeicher: Einstellungen und Schlüssel', () => {
  it('liest die Einstellungen aus der Umgebung', () => {
    expect(() => s3SettingsFromEnv({})).toThrow('S3_BUCKET');
    expect(
      s3SettingsFromEnv({ S3_BUCKET: 'docs', S3_ENDPOINT: 'https://s3.example', S3_PREFIX: '/gartenai' }),
    ).toMatchObject({
      bucket: 'docs',
      region: 'eu-central-1',
      forcePathStyle: true,
      prefix: 'gartenai/',
    });
    // AWS ohne eigenen Endpunkt: virtuelle Hosts
    expect(s3SettingsFromEnv({ S3_BUCKET: 'docs' })).toMatchObject({ forcePathStyle: false, prefix: '' });
    expect(
      s3SettingsFromEnv({
        S3_BUCKET: 'docs',
        S3_ENDPOINT: 'x',
        S3_FORCE_PATH_STYLE: 'false',
        S3_SSE: 'AES256',
      }),
    ).toMatchObject({ forcePathStyle: false, serverSideEncryption: 'AES256' });
  });

  it('wählt den Speicher über STORAGE', () => {
    expect(createFileStorage({}).name).toBe('local-disk');
    const previous = process.env.S3_BUCKET;
    process.env.S3_BUCKET = 'docs';
    try {
      expect(createFileStorage({ STORAGE: 's3' }).name).toBe('s3');
    } finally {
      if (previous === undefined) delete process.env.S3_BUCKET;
      else process.env.S3_BUCKET = previous;
    }
  });

  it('lässt nur Schlüssel im Bereich der Firma zu (ohne Netz)', async () => {
    const storage = new S3Storage({
      bucket: 'docs',
      region: 'eu-central-1',
      forcePathStyle: true,
      prefix: '',
    });
    for (const path of [
      'firma-b/datei.pdf',
      'firma-a/../firma-b/datei.pdf',
      '../firma-a/datei.pdf',
      'datei.pdf',
    ]) {
      await expect(storage.read('firma-a', path)).rejects.toThrow('Datei nicht gefunden');
      await expect(storage.remove('firma-a', path)).rejects.toThrow('Datei nicht gefunden');
    }
  });
});
