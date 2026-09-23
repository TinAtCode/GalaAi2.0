import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { PDFParse } from 'pdf-parse';
import { DOCUMENT_TYPES } from '../documents/dto/create-document.dto';
import { IMAGE_OCR_ENGINE, ImageOcrEngine } from './engine/image-ocr-engine.interface';

export interface OcrResult {
  text: string;
  method: 'pdf-text-layer' | 'image-ocr' | 'pdf-rasterized-ocr';
  pageCount?: number;
  guessedDocumentType: (typeof DOCUMENT_TYPES)[number];
  warning?: string;
}

// Schlüsselwörter je Dokumenttyp (Punkt 15: "Dokumenttyp erkennen"). Reihen-
// folge ist Priorität: spezifischere Begriffe zuerst, damit z.B.
// "Auftragsbestätigung" nicht fälschlich als generische "Bestellung" erkannt wird.
const TYPE_KEYWORDS: [string[], (typeof DOCUMENT_TYPES)[number]][] = [
  [['auftragsbestätigung', 'order confirmation'], 'order_confirmation'],
  [['lieferschein', 'delivery note'], 'delivery_note'],
  [['gutschrift', 'credit note'], 'credit_note'],
  [['mahnung', 'zahlungserinnerung', 'reminder'], 'reminder'],
  [['angebot', 'kostenvoranschlag', 'quotation'], 'quote'],
  [['rechnung', 'invoice'], 'invoice'],
  [['preisliste', 'price list'], 'price_list'],
  [['katalog', 'catalog'], 'catalog'],
  [['bestellung', 'purchase order'], 'purchase_order'],
  [['aufmaß', 'aufmass', 'survey'], 'survey'],
  [['grundriss', 'lageplan', 'floor plan'], 'floor_plan'],
];

function classifyDocumentType(text: string): (typeof DOCUMENT_TYPES)[number] {
  const lower = text.toLowerCase();
  for (const [keywords, type] of TYPE_KEYWORDS) {
    if (keywords.some((k) => lower.includes(k))) return type;
  }
  return 'other';
}

const MIN_TEXT_LAYER_LENGTH = 20; // darunter gilt eine PDF praktisch als textleer (vermutlich gescannt)
const MAX_OCR_PAGES = 10; // Deckel gegen sehr lange Scans (Kosten/Zeit) – siehe STATUS.md

@Injectable()
export class OcrService {
  private readonly logger = new Logger(OcrService.name);

  constructor(@Inject(IMAGE_OCR_ENGINE) private ocrEngine: ImageOcrEngine) {}

  private isPdf(file: { originalname: string; mimetype: string }) {
    return file.mimetype === 'application/pdf' || file.originalname.toLowerCase().endsWith('.pdf');
  }

  // Vor dem Einreihen prüfen, damit ein falscher Dateityp sofort 400 ergibt.
  assertSupported(file: { originalname: string; mimetype: string }) {
    if (!this.isPdf(file) && !file.mimetype.startsWith('image/')) {
      throw new BadRequestException('Nur PDF- oder Bilddateien (JPG/PNG) werden unterstützt.');
    }
  }

  async extractFromFile(file: {
    originalname: string;
    buffer: Buffer;
    mimetype: string;
  }): Promise<OcrResult> {
    this.assertSupported(file);
    if (this.isPdf(file)) {
      return this.extractFromPdf(file.buffer);
    }
    const text = await this.runImageOcr(file.buffer);
    return { text, method: 'image-ocr', guessedDocumentType: classifyDocumentType(text) };
  }

  // Schritt 1 der Pipeline (Punkt 15): PDFs, die digital erzeugt wurden
  // (die meisten Rechnungen/Angebote von Lieferanten), haben bereits eine
  // Textebene – die lässt sich ohne Bild-OCR direkt und zuverlässig auslesen.
  // Hat die PDF keine (nennenswerte) Textebene, wird stattdessen jede Seite
  // gerendert (pdf-parse kann das bereits eingebaut über getScreenshot()
  // liefern – kein zusätzliches PDF-Rasterisierungs-Paket nötig) und per
  // Bild-OCR gelesen.
  private async extractFromPdf(buffer: Buffer): Promise<OcrResult> {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      const text = result.text.trim();

      if (text.length >= MIN_TEXT_LAYER_LENGTH) {
        return { text, method: 'pdf-text-layer', guessedDocumentType: classifyDocumentType(text) };
      }

      // Vermutlich ein eingescanntes Dokument ohne Textebene -> Seiten
      // rendern und per Bild-OCR lesen.
      const screenshots = await parser.getScreenshot();
      const pagesToProcess = screenshots.pages.slice(0, MAX_OCR_PAGES);

      const pageTexts: string[] = [];
      for (const page of pagesToProcess) {
        const pageText = await this.runImageOcr(Buffer.from(page.data));
        pageTexts.push(pageText);
      }
      const combinedText = pageTexts.join('\n\n').trim();

      const truncated = screenshots.pages.length > MAX_OCR_PAGES;
      return {
        text: combinedText,
        method: 'pdf-rasterized-ocr',
        pageCount: screenshots.pages.length,
        guessedDocumentType: classifyDocumentType(combinedText),
        warning: truncated
          ? `Nur die ersten ${MAX_OCR_PAGES} von ${screenshots.pages.length} Seiten wurden per Bild-OCR gelesen.`
          : undefined,
      };
    } finally {
      await parser.destroy();
    }
  }

  // Gemeinsame Bild-OCR-Funktion – genutzt sowohl für direkt hochgeladene
  // Fotos/Scans (Punkt 27) als auch für gerenderte PDF-Seiten. Delegiert an
  // die injizierte Engine (Standard: Tesseract), damit die Orchestrierung
  // hier ohne echte OCR-Engine testbar bleibt.
  private runImageOcr(imageBuffer: Buffer): Promise<string> {
    return this.ocrEngine.recognize(imageBuffer);
  }
}
