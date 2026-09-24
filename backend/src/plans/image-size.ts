// Breite und Höhe eines PNG oder JPEG aus dem Dateikopf (ohne Bildbibliothek);
// null: kein unterstütztes Bild
export function imageSize(buffer: Buffer): { width: number; height: number; type: 'png' | 'jpeg' } | null {
  // PNG: Signatur, dann IHDR mit Breite/Höhe (je 4 Byte, big-endian)
  if (
    buffer.length >= 24 &&
    buffer.readUInt32BE(0) === 0x89504e47 &&
    buffer.toString('ascii', 12, 16) === 'IHDR'
  ) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), type: 'png' };
  }
  // JPEG: Segmente bis zum Start-of-Frame (SOF0–SOF15 außer DHT/JPG/DAC)
  if (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    let rotated = false;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset++;
        continue;
      }
      const marker = buffer[offset + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        offset += 2;
        continue;
      }
      const length = buffer.readUInt16BE(offset + 2);
      // APP1/Exif: Ausrichtung 5–8 heißt "um 90° gedreht" – der Browser zeigt
      // das Bild hochkant, also Breite und Höhe tauschen
      if (marker === 0xe1 && buffer.toString('ascii', offset + 4, offset + 8) === 'Exif') {
        rotated = exifRotated(buffer, offset + 10, offset + 2 + length);
      }
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
        const height = buffer.readUInt16BE(offset + 5);
        const width = buffer.readUInt16BE(offset + 7);
        return rotated ? { width: height, height: width, type: 'jpeg' } : { width, height, type: 'jpeg' };
      }
      offset += 2 + length;
    }
  }
  return null;
}

// Exif-Ausrichtung (Tag 0x0112) im ersten IFD; true bei 5–8 (90°/270°)
function exifRotated(buffer: Buffer, tiff: number, end: number): boolean {
  if (tiff + 8 > end || end > buffer.length) return false;
  const little = buffer.toString('ascii', tiff, tiff + 2) === 'II';
  const u16 = (at: number) => (little ? buffer.readUInt16LE(at) : buffer.readUInt16BE(at));
  const u32 = (at: number) => (little ? buffer.readUInt32LE(at) : buffer.readUInt32BE(at));
  const ifd = tiff + u32(tiff + 4);
  if (ifd + 2 > end) return false;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const entry = ifd + 2 + i * 12;
    if (entry + 12 > end) return false;
    if (u16(entry) === 0x0112) {
      const orientation = u16(entry + 8);
      return orientation >= 5 && orientation <= 8;
    }
  }
  return false;
}
