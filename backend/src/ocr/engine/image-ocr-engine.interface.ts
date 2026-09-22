// Austauschbare Bild-OCR-Engine – dasselbe Muster wie AiProvider/FileStorage.
// Macht die Orchestrierung (PDF rendern -> jede Seite lesen -> Text
// zusammenführen) in OcrService testbar, ohne dass Tests echte Tesseract-
// Sprachdaten aus dem Internet laden müssen.
export interface ImageOcrEngine {
  readonly name: string;
  recognize(imageBuffer: Buffer): Promise<string>;
}

export const IMAGE_OCR_ENGINE = Symbol('IMAGE_OCR_ENGINE');
