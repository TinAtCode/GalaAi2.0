// Rundung der Mengen: Anzeige und Auswahl (Logik im Backend, common/units.ts)
export type RoundingMode = 'half_up' | 'up' | 'down';

export interface Rounding {
  quantityDecimals?: number | null;
  quantityRounding?: RoundingMode | null;
  quantityStep?: number | string | null;
}

export const MODE_LABELS: Record<RoundingMode, string> = {
  half_up: 'kaufmännisch',
  up: 'aufrunden',
  down: 'abrunden',
};

export const DECIMALS_LABELS: Record<number, string> = {
  0: 'ganze',
  1: '1 Nachkommastelle',
  2: '2 Nachkommastellen',
  3: '3 Nachkommastellen',
};

const num = (v: number | string) => Number(v).toLocaleString('de-DE', { maximumFractionDigits: 3 });

// "ganze, aufrunden" · "Schritt 0,5" · null = keine eigene Regel
export function roundingText(r: {
  decimals?: number | null;
  mode?: RoundingMode | null;
  step?: number | string | null;
}): string | null {
  const parts = [
    r.step != null && r.step !== ''
      ? `Schritt ${num(r.step)}`
      : r.decimals != null
        ? DECIMALS_LABELS[r.decimals]
        : null,
    r.mode ? MODE_LABELS[r.mode] : null,
  ].filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

export const SOURCE_LABELS: Record<string, string> = {
  position: 'an der Position',
  master: 'aus der Leistung',
  unit: 'aus der Einheit',
  company: 'Standard der Firma',
};

// Menge mit bis zu 3 Nachkommastellen, deutsch
export const quantityText = (v: number | string) => num(v);
