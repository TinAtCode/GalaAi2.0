import { BadRequestException, Injectable } from '@nestjs/common';
import * as Papa from 'papaparse';
import { readSheet } from 'read-excel-file/node';
import { PrismaService } from '../prisma/prisma.service';
import { diffPriceList, PriceListRow } from './price-list-diff';

// Akzeptierte Spaltennamen je Feld – bewusst tolerant gegenüber deutschen
// UND englischen Kopfzeilen, da Lieferanten-Preislisten in der Praxis
// uneinheitlich beschriftet sind (Punkt 17: "Zuordnung vorschlagen").
const COLUMN_ALIASES: Record<keyof PriceListRow, string[]> = {
  articleNumber: ['articlenumber', 'artikelnummer', 'artikelnr', 'nummer', 'artnr'],
  name: ['name', 'bezeichnung', 'artikelbezeichnung', 'beschreibung'],
  unit: ['unit', 'einheit', 'me', 'mengeneinheit'],
  purchasePrice: ['purchaseprice', 'einkaufspreis', 'ek', 'ekpreis', 'einkauf'],
  salePrice: ['saleprice', 'verkaufspreis', 'vk', 'vkpreis', 'verkauf'],
};

function normalizeHeader(header: string): string {
  return header
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

// Deutsches Zahlenformat ("1.234,56") ODER einfaches Komma-Dezimal ("5,50")
// ODER Standard-Punkt-Dezimal ("5.50") – bewusste Vereinfachung, siehe
// STATUS.md: kein vollständiger Locale-Parser, aber die gängigsten Fälle.
function parseGermanOrPlainNumber(raw: string): number {
  const trimmed = String(raw).trim();
  let normalized = trimmed;
  if (trimmed.includes(',') && trimmed.includes('.')) {
    normalized = trimmed.replace(/\./g, '').replace(',', '.');
  } else if (trimmed.includes(',')) {
    normalized = trimmed.replace(',', '.');
  }
  const value = Number(normalized);
  if (Number.isNaN(value)) {
    throw new BadRequestException(`Zahl konnte nicht gelesen werden: "${raw}"`);
  }
  return value;
}

// Erste Tabelle einer XLSX-Datei als Zeilen-Objekte (Kopfzeile = Schlüssel).
async function readXlsxRows(file: {
  originalname: string;
  buffer: Buffer;
}): Promise<Record<string, unknown>[]> {
  // Altes Excel-Format (OLE-Container) an der Dateisignatur erkennen.
  const isLegacyXls =
    file.buffer.subarray(0, 4).equals(Buffer.from([0xd0, 0xcf, 0x11, 0xe0])) ||
    file.originalname.toLowerCase().endsWith('.xls');
  if (isLegacyXls) {
    throw new BadRequestException(
      'Das alte Excel-Format (.xls) wird nicht unterstützt. Bitte die Datei in Excel als .xlsx oder .csv speichern.',
    );
  }

  let sheet: unknown[][];
  try {
    sheet = await readSheet(file.buffer);
  } catch {
    throw new BadRequestException('Die Excel-Datei konnte nicht gelesen werden (erwartet: .xlsx oder .csv).');
  }

  const [header, ...rows] = sheet;
  if (!header) return [];
  const keys = header.map((cell) => String(cell ?? '').trim());
  return rows
    .filter((row) => row.some((cell) => cell !== null && cell !== ''))
    .map((row) => Object.fromEntries(keys.map((key, i) => [key, row[i] ?? ''])));
}

@Injectable()
export class DataGuardianService {
  constructor(private prisma: PrismaService) {}

  // Datei -> normalisierte PriceListRow[] (Punkt 17: Format erkennen ->
  // Daten erkennen -> Zuordnung vorschlagen). Unterstützt CSV und XLSX.
  // Das alte Excel-Format .xls wird bewusst nicht mehr gelesen: die einzige
  // Bibliothek dafür auf npm (xlsx 0.18) hat ungefixte Sicherheitslücken,
  // und hier werden Dateien von Nutzern verarbeitet.
  // Wirft eine klare Fehlermeldung, wenn Pflichtspalten fehlen, statt still
  // unvollständige Daten zu übernehmen.
  async parsePriceListFile(file: {
    originalname: string;
    buffer: Buffer;
    mimetype: string;
  }): Promise<PriceListRow[]> {
    const isCsv = file.mimetype === 'text/csv' || file.originalname.toLowerCase().endsWith('.csv');

    let rawRows: Record<string, unknown>[];
    if (isCsv) {
      const parsed = Papa.parse<Record<string, unknown>>(file.buffer.toString('utf-8'), {
        header: true,
        skipEmptyLines: true,
      });
      if (parsed.errors.length > 0) {
        throw new BadRequestException(`CSV konnte nicht gelesen werden: ${parsed.errors[0].message}`);
      }
      rawRows = parsed.data;
    } else {
      rawRows = await readXlsxRows(file);
    }

    if (rawRows.length === 0) {
      throw new BadRequestException('Die Datei enthält keine Datenzeilen.');
    }

    // Spalten der ersten Zeile auf unsere kanonischen Feldnamen abbilden.
    const sourceHeaders = Object.keys(rawRows[0]);
    const headerMap: Partial<Record<keyof PriceListRow, string>> = {};
    for (const [field, aliases] of Object.entries(COLUMN_ALIASES) as [keyof PriceListRow, string[]][]) {
      const match = sourceHeaders.find((h) => aliases.includes(normalizeHeader(h)));
      if (match) headerMap[field] = match;
    }

    const missingFields = (Object.keys(COLUMN_ALIASES) as (keyof PriceListRow)[]).filter(
      (field) => !headerMap[field],
    );
    if (missingFields.length > 0) {
      throw new BadRequestException(
        `Folgende Spalten konnten in der Datei nicht zugeordnet werden: ${missingFields.join(', ')}. ` +
          `Erkannte Spalten: ${sourceHeaders.join(', ')}.`,
      );
    }

    return rawRows.map((row, index) => {
      const get = (field: keyof PriceListRow) => row[headerMap[field]!];
      try {
        return {
          articleNumber: String(get('articleNumber')).trim(),
          name: String(get('name')).trim(),
          unit: String(get('unit')).trim(),
          purchasePrice: parseGermanOrPlainNumber(String(get('purchasePrice'))),
          salePrice: parseGermanOrPlainNumber(String(get('salePrice'))),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Unbekannter Fehler';
        throw new BadRequestException(`Zeile ${index + 2} der Datei ist fehlerhaft: ${message}`);
      }
    });
  }

  // Nur Lesen/Vergleichen, NICHTS wird geschrieben – das entspricht dem
  // "zur Prüfung vorlegen" aus Punkt 16, bevor irgendetwas übernommen wird.
  async analyzePriceList(companyId: string, rows: PriceListRow[]) {
    const existingArticles = await this.prisma.article.findMany({ where: { companyId } });
    const existingForDiff = existingArticles.map((a: any) => ({
      articleNumber: a.articleNumber,
      name: a.name,
      unit: a.unit,
      purchasePrice: Number(a.purchasePrice),
      salePrice: Number(a.salePrice),
    }));
    return diffPriceList(existingForDiff, rows);
  }

  // Übernimmt die erkannten Änderungen – standardmäßig ALLE, oder nur eine
  // Teilmenge, wenn `acceptedArticleNumbers` übergeben wird (Punkt 16 nennt
  // "automatisch übernehmen / zur Prüfung vorlegen / ablehnen / teilweise
  // übernehmen" als Optionen – das deckt jetzt auch "teilweise" ab, ohne
  // eine zusätzliche Staging-Tabelle: der Client ruft zuerst `analyze` auf,
  // entscheidet clientseitig, welche Artikelnummern er übernehmen will, und
  // schickt genau diese Liste an `apply`).
  async applyPriceList(
    companyId: string,
    userId: string,
    rows: PriceListRow[],
    acceptedArticleNumbers?: string[],
  ) {
    const diff = await this.analyzePriceList(companyId, rows);
    const accepted = acceptedArticleNumbers ? new Set(acceptedArticleNumbers) : null;
    const isAccepted = (articleNumber: string) => !accepted || accepted.has(articleNumber);

    const newArticlesToCreate = diff.newArticles.filter((row) => isAccepted(row.articleNumber));
    const skippedNewArticles = diff.newArticles.filter((row) => !isAccepted(row.articleNumber));

    const created = await this.prisma.$transaction(
      newArticlesToCreate.map((row) =>
        this.prisma.article.create({
          data: {
            companyId,
            articleNumber: row.articleNumber,
            name: row.name,
            unit: row.unit,
            purchasePrice: row.purchasePrice,
            salePrice: row.salePrice,
          },
        }),
      ),
    );

    // Änderungen pro Artikelnummer bündeln (ein Artikel kann sowohl
    // Preis- als auch Einheiten-Änderung gleichzeitig haben).
    const changedArticleNumbers = new Set(
      [
        ...diff.priceChanges.map((c) => c.articleNumber),
        ...diff.unitChanges.map((c) => c.articleNumber),
      ].filter(isAccepted),
    );
    const skippedChangedCount = new Set(
      [
        ...diff.priceChanges.map((c) => c.articleNumber),
        ...diff.unitChanges.map((c) => c.articleNumber),
      ].filter((n) => !isAccepted(n)),
    ).size;

    const updated = [];
    for (const articleNumber of changedArticleNumbers) {
      const matchingRow = rows.find((r) => r.articleNumber === articleNumber);
      if (!matchingRow) continue;

      const existing = await this.prisma.article.findFirst({ where: { companyId, articleNumber } });
      if (!existing) continue;

      const before = {
        purchasePrice: Number(existing.purchasePrice),
        salePrice: Number(existing.salePrice),
        unit: existing.unit,
      };

      const article = await this.prisma.article.update({
        where: { id: existing.id },
        data: {
          purchasePrice: matchingRow.purchasePrice,
          salePrice: matchingRow.salePrice,
          unit: matchingRow.unit,
        },
      });

      await this.prisma.auditLog.create({
        data: {
          companyId,
          userId,
          action: 'price_list_import_update',
          entity: 'Article',
          entityId: article.id,
          oldData: before,
          newData: {
            purchasePrice: matchingRow.purchasePrice,
            salePrice: matchingRow.salePrice,
            unit: matchingRow.unit,
          },
          source: 'import',
        },
      });

      updated.push(article);
    }

    if (created.length > 0) {
      await this.prisma.auditLog.create({
        data: {
          companyId,
          userId,
          action: 'price_list_import_create',
          entity: 'Article',
          newData: { count: created.length, articleNumbers: created.map((a: any) => a.articleNumber) },
          source: 'import',
        },
      });
    }

    return {
      createdCount: created.length,
      updatedCount: updated.length,
      skippedCount: skippedNewArticles.length + skippedChangedCount,
      diff,
    };
  }
}
