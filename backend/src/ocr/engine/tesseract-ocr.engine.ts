import { Injectable } from '@nestjs/common';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { dirname, join } from 'path';
import { gunzipSync } from 'zlib';
import { createWorker } from 'tesseract.js';
import { ImageOcrEngine } from './image-ocr-engine.interface';

const LANGUAGES = ['eng', 'deu'] as const;

// Sprachdaten kommen als npm-Pakete mit (@tesseract.js-data/*, Modell
// "best_int") statt zur Laufzeit vom CDN – der Server braucht dafür kein
// Internet. tesseract.js liest sie entpackt aus seinem Cache-Verzeichnis;
// das wird beim ersten Aufruf befüllt (TESSERACT_CACHE_DIR, Standard: /tmp).
function prepareLanguageData(): string {
  const dir = process.env.TESSERACT_CACHE_DIR || join(tmpdir(), 'gartenai-tessdata');
  mkdirSync(dir, { recursive: true });
  for (const lang of LANGUAGES) {
    const target = join(dir, `${lang}.traineddata`);
    if (existsSync(target)) continue;
    const pkg = dirname(require.resolve(`@tesseract.js-data/${lang}/package.json`));
    const packed = readFileSync(join(pkg, '4.0.0_best_int', `${lang}.traineddata.gz`));
    // erst vollständig schreiben, dann umbenennen: eine gleichzeitige
    // Erkennung sieht nie eine halbe Datei
    const partial = `${target}.${process.pid}.${Date.now()}.part`;
    writeFileSync(partial, gunzipSync(packed));
    renameSync(partial, target);
  }
  return dir;
}

@Injectable()
export class TesseractOcrEngine implements ImageOcrEngine {
  readonly name = 'tesseract';
  private cacheDir?: string;

  async recognize(imageBuffer: Buffer): Promise<string> {
    this.cacheDir ??= prepareLanguageData();
    const worker = await createWorker([...LANGUAGES], undefined, {
      cachePath: this.cacheDir,
      // nur lesen: nie aus dem Netz nachladen oder überschreiben
      cacheMethod: 'readOnly',
    });
    try {
      const {
        data: { text },
      } = await worker.recognize(imageBuffer);
      return text.trim();
    } finally {
      await worker.terminate();
    }
  }
}
