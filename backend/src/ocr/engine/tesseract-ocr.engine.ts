import { Injectable } from '@nestjs/common';
import { createWorker } from 'tesseract.js';
import { ImageOcrEngine } from './image-ocr-engine.interface';

@Injectable()
export class TesseractOcrEngine implements ImageOcrEngine {
  readonly name = 'tesseract';

  async recognize(imageBuffer: Buffer): Promise<string> {
    const worker = await createWorker(['eng', 'deu']);
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
