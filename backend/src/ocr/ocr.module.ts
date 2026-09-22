import { Module } from '@nestjs/common';
import { OcrController } from './ocr.controller';
import { OcrService } from './ocr.service';
import { IMAGE_OCR_ENGINE } from './engine/image-ocr-engine.interface';
import { TesseractOcrEngine } from './engine/tesseract-ocr.engine';

@Module({
  controllers: [OcrController],
  providers: [OcrService, { provide: IMAGE_OCR_ENGINE, useClass: TesseractOcrEngine }],
})
export class OcrModule {}
