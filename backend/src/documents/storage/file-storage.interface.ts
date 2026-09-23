// Wie beim KI-Gateway (ai-provider.interface.ts): eine schmale Schnittstelle,
// gegen die der Rest der Anwendung programmiert. Ein Wechsel von lokalem
// Dateisystem auf S3-kompatiblen Objektspeicher (Punkt 6: "geeignetes
// Datei-/Objektspeicherkonzept") bedeutet später NUR eine neue Klasse, die
// dieses Interface implementiert, plus eine Zeile im Modul (FILE_STORAGE-Token).
export interface StoredFile {
  storagePath: string; // interner Verweis, wird in Document.storagePath abgelegt
}

export interface FileStorage {
  readonly name: string;
  save(companyId: string, originalName: string, content: Buffer): Promise<StoredFile>;
  // companyId begrenzt den Zugriff auf den Speicherbereich der Firma –
  // storagePath stammt aus der DB und kann über POST /documents vom Client
  // gesetzt worden sein, darf also nie ungeprüft verwendet werden.
  read(companyId: string, storagePath: string): Promise<Buffer>;
  // Löschen; eine bereits fehlende Datei ist kein Fehler
  remove(companyId: string, storagePath: string): Promise<void>;
}

export const FILE_STORAGE = Symbol('FILE_STORAGE');
