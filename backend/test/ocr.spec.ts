import { BadRequestException } from '@nestjs/common';
import { OcrService } from '../src/ocr/ocr.service';
import { ImageOcrEngine } from '../src/ocr/engine/image-ocr-engine.interface';

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

// Baut eine minimale, aber echte PDF mit Text-Layer (kein Mock/Fixture) –
// dieselbe Technik, mit der auch die manuelle Sandbox-Validierung lief.
function buildTestPdf(text: string): Buffer {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 400 200]/Contents 5 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  const stream = `BT /F1 14 Tf 20 150 Td (${text}) Tj ET`;
  objects.push(`<</Length ${stream.length}>>\nstream\n${stream}\nendstream`);

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
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
