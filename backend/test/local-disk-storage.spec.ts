import { NotFoundException } from '@nestjs/common';
import { mkdtempSync, rmSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { LocalDiskStorage } from '../src/documents/storage/local-disk.storage';

describe('LocalDiskStorage – echter Dateisystem-Roundtrip', () => {
  let tempDir: string;
  let originalEnv: string | undefined;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'gartenai-storage-test-'));
    originalEnv = process.env.UPLOADS_DIR;
    process.env.UPLOADS_DIR = tempDir;
  });

  afterEach(() => {
    process.env.UPLOADS_DIR = originalEnv;
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('speichert eine Datei und liest denselben Inhalt zurück', async () => {
    const storage = new LocalDiskStorage();
    const content = Buffer.from('Testinhalt der Datei – äöü');

    const stored = await storage.save('company-a', 'Rechnung 4711.pdf', content);
    expect(stored.storagePath).toContain('company-a');

    const readBack = await storage.read(stored.storagePath);
    expect(readBack.toString('utf-8')).toBe(content.toString('utf-8'));
  });

  it('trennt Dateien verschiedener Firmen in getrennten Verzeichnissen', async () => {
    const storage = new LocalDiskStorage();

    const fileA = await storage.save('company-a', 'test.pdf', Buffer.from('A'));
    const fileB = await storage.save('company-b', 'test.pdf', Buffer.from('B'));

    expect(fileA.storagePath).not.toBe(fileB.storagePath);
    expect((await storage.read(fileA.storagePath)).toString()).toBe('A');
    expect((await storage.read(fileB.storagePath)).toString()).toBe('B');
  });

  it('bereinigt gefährliche Zeichen im Dateinamen (kein Path-Traversal)', async () => {
    const storage = new LocalDiskStorage();
    const stored = await storage.save('company-a', '../../etc/passwd', Buffer.from('x'));
    // Der bereinigte Pfad darf das Speicher-Root-Verzeichnis nicht verlassen.
    expect(stored.storagePath.includes('..')).toBe(false);
  });

  it('wirft NotFoundException bei nicht existierender Datei', async () => {
    const storage = new LocalDiskStorage();
    await expect(storage.read('company-a/does-not-exist.pdf')).rejects.toBeInstanceOf(NotFoundException);
  });
});
