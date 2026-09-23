import { mkdtempSync, readdirSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { PDFParse } from 'pdf-parse';
import { TesseractOcrEngine } from '../src/ocr/engine/tesseract-ocr.engine';
import { buildTestPdf } from './fixtures/test-pdf';

// Echte Texterkennung ohne Netz: die Sprachdaten kommen aus den npm-Paketen.
// Das Bild ist eine gerenderte PDF-Seite (wie bei gescannten PDFs).
describe('Tesseract-Engine', () => {
  it('erkennt deutschen Text mit den mitgelieferten Sprachdaten', async () => {
    process.env.TESSERACT_CACHE_DIR = mkdtempSync(join(tmpdir(), 'tessdata-test-'));
    const parser = new PDFParse({ data: buildTestPdf('Lieferschein Rasengittersteine') });
    const screenshot = await parser.getScreenshot({ scale: 3 });
    await parser.destroy();

    const text = await new TesseractOcrEngine().recognize(Buffer.from(screenshot.pages[0].data));
    expect(text).toContain('Lieferschein');
    expect(text).toContain('Rasengittersteine');
    expect(readdirSync(process.env.TESSERACT_CACHE_DIR).sort()).toEqual([
      'deu.traineddata',
      'eng.traineddata',
    ]);
    delete process.env.TESSERACT_CACHE_DIR;
  }, 60_000);
});
