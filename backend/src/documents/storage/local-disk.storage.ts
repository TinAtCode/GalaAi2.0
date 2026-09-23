import { Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { dirname, join, extname, basename, resolve, sep } from 'path';
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

  // Path-Traversal-Schutz: der aufgelöste Pfad muss im Verzeichnis der
  // Firma liegen – sonst wären über "../" fremde Firmen oder beliebige
  // Serverdateien lesbar. Bewusst dieselbe Antwort wie bei fehlender Datei.
  private pathInCompany(companyId: string, storagePath: string) {
    const companyDir = resolve(this.rootDir, companyId);
    const absolutePath = resolve(this.rootDir, storagePath);
    if (!absolutePath.startsWith(companyDir + sep)) {
      throw new NotFoundException('Datei nicht gefunden.');
    }
    return absolutePath;
  }

  async remove(companyId: string, storagePath: string): Promise<void> {
    await rm(this.pathInCompany(companyId, storagePath), { force: true });
  }

  async read(companyId: string, storagePath: string): Promise<Buffer> {
    const absolutePath = this.pathInCompany(companyId, storagePath);
    try {
      return await readFile(absolutePath);
    } catch {
      throw new NotFoundException('Datei nicht gefunden.');
    }
  }
}
