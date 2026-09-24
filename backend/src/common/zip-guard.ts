import { BadRequestException } from '@nestjs/common';

// Schutz vor „ZIP-Bomben“ (.xlsx ist ein ZIP-Archiv): 5 MB gepackt können
// beim Einlesen auf Gigabytes anwachsen. Vor dem Entpacken die Größen aus dem
// Inhaltsverzeichnis des Archivs zusammenzählen. Gefälschte Angaben hält das
// nicht sicher ab, die üblichen Bomben (echte Größen, sehr hoch gepackt) aber schon.
export const MAX_UNZIPPED_BYTES = 100 * 1024 * 1024;
const MAX_ENTRIES = 2000;

export function assertZipWithinLimits(buffer: Buffer, maxBytes = MAX_UNZIPPED_BYTES) {
  const invalid = () => new BadRequestException('Die Datei ist kein gültiges Excel-Dokument (.xlsx).');
  // Ende des Inhaltsverzeichnisses: in den letzten 64 KB (+22 Byte) suchen
  let eocd = -1;
  for (let i = buffer.length - 22; i >= Math.max(0, buffer.length - 65_557); i--) {
    if (buffer.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw invalid();
  const entries = buffer.readUInt16LE(eocd + 10);
  let offset = buffer.readUInt32LE(eocd + 16);
  // ZIP64 (Werte auf Maximum) braucht keine Tabelle
  if (entries === 0xffff || offset === 0xffffffff || entries > MAX_ENTRIES) throw invalid();
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== 0x02014b50) throw invalid();
    const size = buffer.readUInt32LE(offset + 24);
    if (size === 0xffffffff) throw invalid();
    total += size;
    if (total > maxBytes) {
      throw new BadRequestException(
        `Die Datei ist entpackt zu groß (über ${Math.round(maxBytes / 1024 / 1024)} MB).`,
      );
    }
    offset +=
      46 +
      buffer.readUInt16LE(offset + 28) +
      buffer.readUInt16LE(offset + 30) +
      buffer.readUInt16LE(offset + 32);
  }
}
