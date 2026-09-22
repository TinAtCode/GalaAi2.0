export interface ExistingArticleForDiff {
  articleNumber: string;
  name: string;
  unit: string;
  purchasePrice: number;
  salePrice: number;
}

export interface PriceListRow {
  articleNumber: string;
  name: string;
  unit: string;
  purchasePrice: number;
  salePrice: number;
}

export interface PriceChange {
  articleNumber: string;
  name: string;
  field: 'purchasePrice' | 'salePrice';
  oldValue: number;
  newValue: number;
}

export interface UnitChange {
  articleNumber: string;
  name: string;
  oldUnit: string;
  newUnit: string;
}

export interface PriceListDiff {
  newArticles: PriceListRow[];
  priceChanges: PriceChange[];
  unitChanges: UnitChange[];
  unchangedCount: number;
}

const EPSILON = 0.001; // Toleranz gegen Floating-Point-Rundungsrauschen

// Reine, deterministische Vergleichsfunktion (siehe Punkt 14: KI
// interpretiert/liest die Preisliste ggf. per OCR ein, aber der eigentliche
// VERGLEICH ist nachvollziehbare, testbare Software-Logik). Direkt
// unit-testbar ohne DB-Mock.
export function diffPriceList(
  existingArticles: ExistingArticleForDiff[],
  incomingRows: PriceListRow[],
): PriceListDiff {
  const existingByNumber = new Map(existingArticles.map((a) => [a.articleNumber, a]));

  const newArticles: PriceListRow[] = [];
  const priceChanges: PriceChange[] = [];
  const unitChanges: UnitChange[] = [];
  let unchangedCount = 0;

  for (const row of incomingRows) {
    const existing = existingByNumber.get(row.articleNumber);
    if (!existing) {
      newArticles.push(row);
      continue;
    }

    let changed = false;
    if (Math.abs(existing.purchasePrice - row.purchasePrice) > EPSILON) {
      priceChanges.push({
        articleNumber: row.articleNumber,
        name: row.name,
        field: 'purchasePrice',
        oldValue: existing.purchasePrice,
        newValue: row.purchasePrice,
      });
      changed = true;
    }
    if (Math.abs(existing.salePrice - row.salePrice) > EPSILON) {
      priceChanges.push({
        articleNumber: row.articleNumber,
        name: row.name,
        field: 'salePrice',
        oldValue: existing.salePrice,
        newValue: row.salePrice,
      });
      changed = true;
    }
    if (existing.unit !== row.unit) {
      unitChanges.push({
        articleNumber: row.articleNumber,
        name: row.name,
        oldUnit: existing.unit,
        newUnit: row.unit,
      });
      changed = true;
    }
    if (!changed) unchangedCount += 1;
  }

  return { newArticles, priceChanges, unitChanges, unchangedCount };
}
