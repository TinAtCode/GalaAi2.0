import { NotFoundException } from '@nestjs/common';
import { mkdtempSync, rmSync, writeFileSync } from 'fs';
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

    const readBack = await storage.read('company-a', stored.storagePath);
    expect(readBack.toString('utf-8')).toBe(content.toString('utf-8'));
  });

  it('trennt Dateien verschiedener Firmen in getrennten Verzeichnissen', async () => {
    const storage = new LocalDiskStorage();

    const fileA = await storage.save('company-a', 'test.pdf', Buffer.from('A'));
    const fileB = await storage.save('company-b', 'test.pdf', Buffer.from('B'));

    expect(fileA.storagePath).not.toBe(fileB.storagePath);
    expect((await storage.read('company-a', fileA.storagePath)).toString()).toBe('A');
    expect((await storage.read('company-b', fileB.storagePath)).toString()).toBe('B');
  });

  it('bereinigt gefährliche Zeichen im Dateinamen (kein Path-Traversal)', async () => {
    const storage = new LocalDiskStorage();
    const stored = await storage.save('company-a', '../../etc/passwd', Buffer.from('x'));
    // Der bereinigte Pfad darf das Speicher-Root-Verzeichnis nicht verlassen.
    expect(stored.storagePath.includes('..')).toBe(false);
  });

  it('wirft NotFoundException bei nicht existierender Datei', async () => {
    const storage = new LocalDiskStorage();
    await expect(storage.read('company-a', 'company-a/does-not-exist.pdf')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('liest keine Dateien einer anderen Firma (auch nicht mit gültigem Pfad)', async () => {
    const storage = new LocalDiskStorage();
    const fileB = await storage.save('company-b', 'geheim.pdf', Buffer.from('B'));

    await expect(storage.read('company-a', fileB.storagePath)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('blockiert Path-Traversal über einen manipulierten storagePath', async () => {
    const storage = new LocalDiskStorage();
    await storage.save('company-b', 'geheim.pdf', Buffer.from('B'));
    writeFileSync(join(tempDir, 'ausserhalb.txt'), 'nicht lesbar');

    for (const path of [
      '../company-b',
      'company-a/../company-b/x',
      '../ausserhalb.txt',
      'ausserhalb.txt',
      '/etc/passwd',
      '../../../../etc/passwd',
    ]) {
      await expect(storage.read('company-a', path)).rejects.toBeInstanceOf(NotFoundException);
    }
  });
});
