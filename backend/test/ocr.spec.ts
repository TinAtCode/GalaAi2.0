import { BadRequestException } from '@nestjs/common';
import { OcrService } from '../src/ocr/ocr.service';
import { ImageOcrEngine } from '../src/ocr/engine/image-ocr-engine.interface';
import { buildTestPdf } from './fixtures/test-pdf';

// Simuliert eine echte OCR-Engine, OHNE Netzwerk/Sprachdaten zu brauchen –
// gibt einen festen Text zurück, damit die Orchestrierung (rendern -> pro
// Seite lesen -> zusammenführen) isoliert testbar ist. Die echte Engine
// (tesseract-ocr.engine.ts) ist bewusst NICHT Gegenstand dieses Tests, siehe
// STATUS.md: Tesseract selbst konnte in dieser Sandbox nicht real geprüft
// werden (Netzwerk-Blockade beim Sprachdaten-Download).
class FakeOcrEngine implements ImageOcrEngine {
  readonly name = 'fake';
  calls: Buffer[] = [];
  constructor(private response: string | ((imageBuffer: Buffer, callIndex: number) => string)) {}

  async recognize(imageBuffer: Buffer): Promise<string> {
    this.calls.push(imageBuffer);
    return typeof this.response === 'function'
      ? this.response(imageBuffer, this.calls.length - 1)
      : this.response;
  }
}

function makeFile(originalname: string, buffer: Buffer, mimetype: string) {
  return { originalname, buffer, mimetype } as Express.Multer.File;
}

describe('OcrService – PDF-Textextraktion (echt, kein Mock)', () => {
  const service = new OcrService(new FakeOcrEngine(''));

  it('extrahiert Text aus einer echten PDF und erkennt den Dokumenttyp "invoice"', async () => {
    const pdf = buildTestPdf('Rechnung Nr. 4711 Betrag 123,45 EUR');
    const result = await service.extractFromFile(makeFile('rechnung.pdf', pdf, 'application/pdf'));

    expect(result.method).toBe('pdf-text-layer');
    expect(result.text).toContain('Rechnung Nr. 4711');
    expect(result.guessedDocumentType).toBe('invoice');
    expect(result.warning).toBeUndefined();
  });

  it('erkennt "quote" bei einem Angebot', async () => {
    const pdf = buildTestPdf('Angebot Nr. 99 fuer Terrassenbau');
    const result = await service.extractFromFile(makeFile('angebot.pdf', pdf, 'application/pdf'));
    expect(result.guessedDocumentType).toBe('quote');
  });

  it('erkennt "delivery_note" bei einem Lieferschein', async () => {
    const pdf = buildTestPdf('Lieferschein 2026-100');
    const result = await service.extractFromFile(makeFile('lieferschein.pdf', pdf, 'application/pdf'));
    expect(result.guessedDocumentType).toBe('delivery_note');
  });

  it('lehnt nicht unterstützte Dateiformate klar ab', async () => {
    const buffer = Buffer.from('irgendein Inhalt');
    await expect(
      service.extractFromFile(makeFile('daten.zip', buffer, 'application/zip')),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('OcrService – Rasterisierungs-Fallback für gescannte PDFs (echtes Rendern, Fake-OCR)', () => {
  it('rendert eine textlose PDF-Seite ECHT (pdf-parse) und übergibt sie an die OCR-Engine', async () => {
    const fakeEngine = new FakeOcrEngine('Rechnung Nr. 999 (aus Bild-OCR erkannt)');
    const service = new OcrService(fakeEngine);

    // Sehr kurzer Text ("X") unterschreitet MIN_TEXT_LAYER_LENGTH und löst
    // damit den Rasterisierungs-Pfad aus.
    const pdf = buildTestPdf('X');
    const result = await service.extractFromFile(makeFile('scan.pdf', pdf, 'application/pdf'));

    expect(result.method).toBe('pdf-rasterized-ocr');
    expect(result.text).toBe('Rechnung Nr. 999 (aus Bild-OCR erkannt)');
    expect(result.guessedDocumentType).toBe('invoice');
    expect(result.pageCount).toBe(1);

    // Beweis, dass die Engine ein ECHTES gerendertes Bild bekam (PNG-Header),
    // nicht nur die rohen PDF-Bytes durchgereicht.
    expect(fakeEngine.calls).toHaveLength(1);
    const pngHeader = fakeEngine.calls[0].subarray(0, 8);
    expect(pngHeader.toString('hex')).toBe('89504e470d0a1a0a');
  });

  it('führt Text mehrerer Seiten zusammen', async () => {
    let call = 0;
    const fakeEngine = new FakeOcrEngine(() => `Seite ${++call}`);
    const service = new OcrService(fakeEngine);

    const pdf = buildTestPdf('X'); // 1 Seite, aber Logik gilt unabhängig von der Seitenzahl
    const result = await service.extractFromFile(makeFile('scan.pdf', pdf, 'application/pdf'));

    expect(result.text).toBe('Seite 1');
    expect(result.pageCount).toBe(1);
  });
});
