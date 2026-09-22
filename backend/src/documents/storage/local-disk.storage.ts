import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname, join, extname, basename } from 'path';
import { FileStorage, StoredFile } from './file-storage.interface';

// Standard-Implementierung für Version 1 (Punkt 40: "eigener Server bzw.
// kleiner Firmenserver, kein Hochleistungsserver erforderlich"). Speichert
// Dateien unter UPLOADS_DIR/<companyId>/<uuid>-<originalname>. Verzeichnis
// pro Firma trennt Mandanten schon auf Dateisystem-Ebene zusätzlich zur
// DB-seitigen Mandantenprüfung.
@Injectable()
export class LocalDiskStorage implements FileStorage {
  readonly name = 'local-disk';
  private readonly rootDir = process.env.UPLOADS_DIR ?? join(process.cwd(), 'uploads');

  async save(companyId: string, originalName: string, content: Buffer): Promise<StoredFile> {
    const safeName = basename(originalName).replace(/[^a-zA-Z0-9._-]/g, '_');
    const fileName = `${randomUUID()}${extname(safeName) || ''}-${safeName}`;
    const relativePath = join(companyId, fileName);
    const absolutePath = join(this.rootDir, relativePath);

    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, content);

    return { storagePath: relativePath };
  }

  async read(storagePath: string): Promise<Buffer> {
    try {
      return await readFile(join(this.rootDir, storagePath));
    } catch {
      throw new NotFoundException('Datei nicht gefunden.');
    }
  }
}
