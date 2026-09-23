import { Prisma } from '@prisma/client';

// Einheitenkatalog: Dimension, Faktor zur Basiseinheit der Dimension und
// Code für die E-Rechnung (UN/ECE Recommendation 20). Einheiten werden als
// Text gespeichert ("m²", "Stk" …); Schreibweisen wie "qm" oder "m2"
// werden auf den Katalog-Code abgebildet.
export type Dimension = 'length' | 'area' | 'volume' | 'mass' | 'count' | 'time' | 'lump';
export type RoundingMode = 'half_up' | 'up' | 'down';

export interface RoundingRule {
  decimals: number; // 0–3
  mode: RoundingMode;
  step: Prisma.Decimal | null; // z.B. 0,5 statt Nachkommastellen
}

export interface UnitDefinition {
  code: string;
  label: string;
  dimension: Dimension;
  factor: number; // Menge in der Basiseinheit der Dimension (m, m², m³, kg, Stück, h)
  unece: string;
  // Vorgabe für die Rundung, solange die Firma nichts anderes einstellt
  decimals?: number;
  mode?: RoundingMode;
  aliases?: string[];
}

export const STANDARD_UNITS: UnitDefinition[] = [
  { code: 'mm', label: 'Millimeter', dimension: 'length', factor: 0.001, unece: 'MMT', decimals: 0 },
  { code: 'cm', label: 'Zentimeter', dimension: 'length', factor: 0.01, unece: 'CMT', decimals: 1 },
  {
    code: 'm',
    label: 'Meter',
    dimension: 'length',
    factor: 1,
    unece: 'MTR',
    aliases: ['lfm', 'lfdm', 'meter'],
  },
  { code: 'km', label: 'Kilometer', dimension: 'length', factor: 1000, unece: 'KMT', decimals: 3 },
  {
    code: 'cm²',
    label: 'Quadratzentimeter',
    dimension: 'area',
    factor: 0.0001,
    unece: 'CMK',
    aliases: ['cm2', 'qcm'],
  },
  { code: 'm²', label: 'Quadratmeter', dimension: 'area', factor: 1, unece: 'MTK', aliases: ['m2', 'qm'] },
  { code: 'ha', label: 'Hektar', dimension: 'area', factor: 10000, unece: 'HAR', decimals: 3 },
  { code: 'l', label: 'Liter', dimension: 'volume', factor: 0.001, unece: 'LTR', aliases: ['ltr', 'liter'] },
  { code: 'm³', label: 'Kubikmeter', dimension: 'volume', factor: 1, unece: 'MTQ', aliases: ['m3', 'cbm'] },
  { code: 'g', label: 'Gramm', dimension: 'mass', factor: 0.001, unece: 'GRM', decimals: 0 },
  { code: 'kg', label: 'Kilogramm', dimension: 'mass', factor: 1, unece: 'KGM' },
  { code: 't', label: 'Tonne', dimension: 'mass', factor: 1000, unece: 'TNE', aliases: ['to'] },
  {
    code: 'Stk',
    label: 'Stück',
    dimension: 'count',
    factor: 1,
    unece: 'H87',
    decimals: 0,
    aliases: ['stück', 'st', 'stck'],
  },
  {
    code: 'Sack',
    label: 'Sack',
    dimension: 'count',
    factor: 1,
    unece: 'BG',
    decimals: 0,
    mode: 'up',
    aliases: ['sa'],
  },
  {
    code: 'Pal',
    label: 'Palette',
    dimension: 'count',
    factor: 1,
    unece: 'PF',
    decimals: 0,
    mode: 'up',
    aliases: ['palette'],
  },
  {
    code: 'h',
    label: 'Stunde',
    dimension: 'time',
    factor: 1,
    unece: 'HUR',
    aliases: ['std', 'stunde', 'stunden'],
  },
  { code: 'min', label: 'Minute', dimension: 'time', factor: 1 / 60, unece: 'MIN', decimals: 0 },
  {
    code: 'psch',
    label: 'pauschal',
    dimension: 'lump',
    factor: 1,
    unece: 'LS',
    decimals: 0,
    aliases: ['pauschal', 'pausch', 'pau'],
  },
];

const byKey = new Map<string, UnitDefinition>();
for (const unit of STANDARD_UNITS) {
  for (const key of [unit.code, ...(unit.aliases ?? [])]) byKey.set(key.toLowerCase(), unit);
}

// Katalog-Einheit zu einer Schreibweise; unbekannte Einheiten: undefined
export function findUnit(raw: string): UnitDefinition | undefined {
  return byKey.get(raw.trim().toLowerCase());
}

// Einheitliche Schreibweise ("qm" -> "m²"); Unbekanntes bleibt wie eingegeben
export function normalizeUnit(raw: string): string {
  return findUnit(raw)?.code ?? raw.trim();
}

export function unitCodeForInvoice(raw: string): string {
  return findUnit(raw)?.unece ?? 'C62'; // C62 = "Einheit"
}

// Umrechnung innerhalb einer Dimension (cm -> m, t -> kg); über Dimensionen
// hinweg (m³ -> t) braucht es eine Angabe am Artikel und gibt hier null.
export function convertQuantity(
  value: Prisma.Decimal.Value,
  from: string,
  to: string,
): Prisma.Decimal | null {
  const a = findUnit(from);
  const b = findUnit(to);
  if (!a || !b || a.dimension !== b.dimension || a.dimension === 'lump') return null;
  return new Prisma.Decimal(value).times(a.factor).dividedBy(b.factor);
}

// Teilregel einer Stufe: fehlende Angaben kommen von der nächsten Stufe
export interface PartialRule {
  decimals?: number | null;
  mode?: RoundingMode | null;
  step?: Prisma.Decimal.Value | null;
}

export type RuleSource = 'position' | 'master' | 'unit' | 'company';

// Stufen in dieser Reihenfolge: Position, Leistung/Artikel, Einheit, Firma.
// Die Genauigkeit (Nachkommastellen oder Schritt) kommt als Ganzes von der
// ersten Stufe, die eine festlegt – setzt die Position 1 Nachkommastelle,
// gilt ein Schritt am Artikel nicht mehr. Die Rundungsart kommt unabhängig
// davon von der ersten Stufe, die eine festlegt. Die Firma setzt immer beides.
export function resolveRounding(levels: {
  position?: PartialRule | null;
  master?: PartialRule | null;
  unit?: PartialRule | null;
  company: { decimals: number; mode: RoundingMode };
}): RoundingRule & { source: RuleSource } {
  const order: [RuleSource, PartialRule | null | undefined][] = [
    ['position', levels.position],
    ['master', levels.master],
    ['unit', levels.unit],
    ['company', levels.company],
  ];
  const has = (v: unknown) => v !== undefined && v !== null;
  const [precisionSource, precision] = order.find(([, r]) => has(r?.decimals) || has(r?.step)) as [
    RuleSource,
    PartialRule,
  ];
  const [modeSource, modeRule] = order.find(([, r]) => has(r?.mode)) as [RuleSource, PartialRule];
  const rank: RuleSource[] = ['position', 'master', 'unit', 'company'];
  const step = has(precision.step) ? new Prisma.Decimal(precision.step as Prisma.Decimal.Value) : null;
  return {
    decimals: has(precision.decimals) ? (precision.decimals as number) : step ? step.decimalPlaces() : 0,
    mode: modeRule.mode as RoundingMode,
    step,
    // Quelle = die genaueste Stufe, die etwas festlegt (für die Anzeige)
    source: rank[Math.min(rank.indexOf(precisionSource), rank.indexOf(modeSource))],
  };
}

// Regel einer Katalog-Einheit (Vorgabe), überschrieben durch die Firma
export function unitRule(raw: string, companyOverride?: PartialRule | null): PartialRule | null {
  const unit = findUnit(raw);
  const base: PartialRule = { decimals: unit?.decimals ?? null, mode: unit?.mode ?? null };
  if (!unit && !companyOverride) return null;
  return {
    decimals: companyOverride?.decimals ?? base.decimals,
    mode: companyOverride?.mode ?? base.mode,
    step: companyOverride?.step ?? null,
  };
}

const MODES: Record<RoundingMode, Prisma.Decimal.Rounding> = {
  half_up: Prisma.Decimal.ROUND_HALF_UP,
  up: Prisma.Decimal.ROUND_UP,
  down: Prisma.Decimal.ROUND_DOWN,
};

// Menge runden: mit Schritt auf ein Vielfaches davon, sonst auf die
// Nachkommastellen. Nie auf 0 – eine Position mit Menge bleibt eine.
export function roundQuantity(value: Prisma.Decimal.Value, rule: RoundingRule): Prisma.Decimal {
  const exact = new Prisma.Decimal(value);
  let rounded: Prisma.Decimal;
  if (rule.step && rule.step.greaterThan(0)) {
    rounded = exact.dividedBy(rule.step).toDecimalPlaces(0, MODES[rule.mode]).times(rule.step);
  } else {
    rounded = exact.toDecimalPlaces(rule.decimals, MODES[rule.mode]);
  }
  if (rounded.isZero() && exact.greaterThan(0)) {
    rounded =
      rule.step && rule.step.greaterThan(0)
        ? rule.step
        : new Prisma.Decimal(1).dividedBy(10 ** rule.decimals);
  }
  return rounded.toDecimalPlaces(3, Prisma.Decimal.ROUND_HALF_UP);
}
