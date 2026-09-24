import { BadRequestException } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import { AiImage } from './ai-provider.interface';

// Grenze der Anbieter (Anthropic: 5 MB je Bild); größere Fotos lehnt die App ab,
// statt sie ungefragt zu verkleinern
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
// so viele Seiten einer PDF sieht die KI (Rechnungen stehen fast immer auf Seite 1–2)
const MAX_PDF_PAGES = 2;

// Bildformat an den ersten Bytes erkennen (Dateiname und Mimetype können lügen)
export function imageMediaType(buffer: Buffer): AiImage['mediaType'] | null {
  if (buffer.length > 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff)
    return 'image/jpeg';
  if (buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])))
    return 'image/png';
  if (
    buffer.subarray(0, 4).toString('latin1') === 'RIFF' &&
    buffer.subarray(8, 12).toString('latin1') === 'WEBP'
  )
    return 'image/webp';
  if (buffer.subarray(0, 6).toString('latin1').startsWith('GIF8')) return 'image/gif';
  return null;
}

export const isPdfBuffer = (buffer: Buffer) => buffer.subarray(0, 5).toString('latin1') === '%PDF-';

function asImage(buffer: Buffer): AiImage {
  const mediaType = imageMediaType(buffer);
  if (!mediaType)
    throw new BadRequestException('Die Datei ist kein Bild (JPG, PNG, WebP, GIF) und keine PDF.');
  if (buffer.length > MAX_IMAGE_BYTES) {
    throw new BadRequestException('Das Bild ist zu groß für die KI (höchstens 5 MB).');
  }
  return { mediaType, data: buffer.toString('base64') };
}

// Foto direkt, PDF als Bilder der ersten Seiten
export async function imagesForAi(buffer: Buffer): Promise<AiImage[]> {
  if (!isPdfBuffer(buffer)) return [asImage(buffer)];
  const parser = new PDFParse({ data: buffer });
  try {
    const shots = await parser.getScreenshot({
      first: MAX_PDF_PAGES,
      desiredWidth: 1400,
      imageBuffer: true,
      imageDataUrl: false,
    });
    const pages = shots.pages.slice(0, MAX_PDF_PAGES).map((page) => asImage(Buffer.from(page.data)));
    if (!pages.length) throw new BadRequestException('Die PDF hat keine Seiten.');
    return pages;
  } finally {
    await parser.destroy();
  }
}
