import { normalizeUnit } from '../common/units';

// Datenarten des Stammdaten-Imports: Felder mit üblichen Spaltennamen,
// Umwandlung der Zellen und der Abgleich mit dem Bestand. Reine Funktionen
// ohne Datenbank – der Service lädt den Bestand und schreibt.

export type EntityType = 'customers' | 'suppliers' | 'articles' | 'machines';
export type FieldKind = 'text' | 'email' | 'money' | 'bool' | 'postalCode' | 'debtor' | 'unit';

export interface FieldDef {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  aliases: string[];
}

export interface EntityDef {
  type: EntityType;
  label: string;
  fields: FieldDef[];
}

const f = (key: string, label: string, kind: FieldKind, aliases: string[], required = false): FieldDef => ({
  key,
  label,
  kind,
  aliases,
  required,
});

export const ENTITIES: Record<EntityType, EntityDef> = {
  customers: {
    type: 'customers',
    label: 'Kunden',
    fields: [
      f(
        'name',
        'Name',
        'text',
        [
          'name',
          'kunde',
          'kundenname',
          'firma',
          'firmenname',
          'name1',
          'nachname',
          'bezeichnung',
          'unternehmen',
          'adressat',
        ],
        true,
      ),
      f('email', 'E-Mail', 'email', ['email', 'e-mail', 'mail', 'emailadresse', 'mailadresse']),
      f('phone', 'Telefon', 'text', [
        'telefon',
        'tel',
        'phone',
        'telefonnummer',
        'mobil',
        'handy',
        'rufnummer',
      ]),
      f('street', 'Straße', 'text', [
        'strasse',
        'straße',
        'street',
        'anschrift',
        'adresse',
        'strassehausnummer',
      ]),
      f('postalCode', 'PLZ', 'postalCode', ['plz', 'postleitzahl', 'zip', 'postalcode']),
      f('city', 'Ort', 'text', ['ort', 'stadt', 'city', 'wohnort']),
      f('vatId', 'USt-IdNr.', 'text', ['ustid', 'ustidnr', 'umsatzsteuerid', 'vatid', 'ustidentnr']),
      f('buyerReference', 'Leitweg-ID / Käuferreferenz', 'text', [
        'leitwegid',
        'kauferreferenz',
        'kaeuferreferenz',
        'buyerreference',
      ]),
      f('isBusiness', 'Unternehmer (ja/nein)', 'bool', [
        'unternehmer',
        'gewerblich',
        'b2b',
        'isbusiness',
        'geschaeftskunde',
      ]),
      f('debtorNumber', 'Debitorennummer', 'debtor', [
        'debitor',
        'debitorennummer',
        'debitorennr',
        'kundennummer',
        'kundennr',
        'konto',
        'kontonummer',
      ]),
    ],
  },
  suppliers: {
    type: 'suppliers',
    label: 'Lieferanten',
    fields: [
      f('name', 'Name', 'text', ['name', 'lieferant', 'firma', 'firmenname', 'bezeichnung', 'name1'], true),
      f('email', 'E-Mail', 'email', ['email', 'e-mail', 'mail']),
      f('phone', 'Telefon', 'text', ['telefon', 'tel', 'phone', 'telefonnummer']),
    ],
  },
  articles: {
    type: 'articles',
    label: 'Artikel',
    fields: [
      f(
        'articleNumber',
        'Artikelnummer',
        'text',
        ['artikelnummer', 'artikelnr', 'artnr', 'nummer', 'articlenumber', 'sku', 'bestellnummer'],
        true,
      ),
      f(
        'name',
        'Bezeichnung',
        'text',
        ['bezeichnung', 'name', 'artikelbezeichnung', 'artikel', 'beschreibung', 'kurztext'],
        true,
      ),
      f('unit', 'Einheit', 'unit', ['einheit', 'me', 'mengeneinheit', 'unit', 'vpe']),
      f('purchasePrice', 'Einkaufspreis', 'money', [
        'einkaufspreis',
        'ek',
        'ekpreis',
        'eknetto',
        'einkauf',
        'purchaseprice',
        'nettopreis',
      ]),
      f('salePrice', 'Verkaufspreis', 'money', [
        'verkaufspreis',
        'vk',
        'vkpreis',
        'vknetto',
        'vkbrutto',
        'verkauf',
        'saleprice',
        'listenpreis',
      ]),
    ],
  },
  machines: {
    type: 'machines',
    label: 'Maschinen',
    fields: [
      f('name', 'Bezeichnung', 'text', ['name', 'bezeichnung', 'maschine', 'geraet', 'gerät'], true),
      f(
        'hourlyRate',
        'Kosten je Stunde',
        'money',
        ['stundensatz', 'kostenjestunde', 'kostenprostunde', 'hourlyrate', 'preisprostunde', 'eurh'],
        true,
      ),
    ],
  },
};

export type Mapping = Record<string, string | null>; // Feld -> Spaltenname

export const normalizeHeader = (value: string) =>
  value
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');

// Spalten vorschlagen: exakte Übereinstimmung mit einem Alias, sonst ein
// Alias als Wortanfang (z.B. "Telefon privat"); jede Spalte höchstens einmal
export function suggestMapping(entity: EntityType, headers: string[]): Mapping {
  const normalized = headers.map(normalizeHeader);
  const used = new Set<number>();
  const mapping: Mapping = {};
  for (const pass of ['exact', 'prefix'] as const) {
    for (const field of ENTITIES[entity].fields) {
      if (mapping[field.key]) continue;
      const aliases = field.aliases.map(normalizeHeader);
      const index = normalized.findIndex(
        (h, i) =>
          !used.has(i) &&
          (pass === 'exact' ? aliases.includes(h) : aliases.some((a) => a.length >= 3 && h.startsWith(a))),
      );
      if (index >= 0) {
        mapping[field.key] = headers[index];
        used.add(index);
      }
    }
  }
  for (const field of ENTITIES[entity].fields) mapping[field.key] ??= null;
  return mapping;
}

// Welche Datenart passt am besten zu den Spalten?
export function detectEntity(headers: string[]): EntityType {
  const score = (type: EntityType) => {
    const mapping = suggestMapping(type, headers);
    const def = ENTITIES[type];
    const required = def.fields.filter((fd) => fd.required).every((fd) => mapping[fd.key]);
    // Pflichtfelder vorhanden zählt am meisten, dann die Zahl erkannter Spalten
    return (required ? 100 : 0) + Object.values(mapping).filter(Boolean).length;
  };
  return (Object.keys(ENTITIES) as EntityType[]).reduce((best, type) =>
    score(type) > score(best) ? type : best,
  );
}

export type Value = string | number | boolean | null;

// "1.234,56 €" / "1234.56" / "12,5" -> Zahl
export function parseMoney(raw: string): number | null {
  const cleaned = raw.replace(/[€\s]|EUR/gi, '');
  if (!cleaned) return null;
  let normalized = cleaned;
  if (cleaned.includes(',') && cleaned.includes('.')) {
    normalized =
      cleaned.lastIndexOf(',') > cleaned.lastIndexOf('.')
        ? cleaned.replace(/\./g, '').replace(',', '.')
        : cleaned.replace(/,/g, '');
  } else if (cleaned.includes(',')) normalized = cleaned.replace(',', '.');
  const value = Number(normalized);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : NaN;
}

export function parseCell(kind: FieldKind, raw: string): { value: Value; error?: string } {
  const text = raw.trim();
  if (!text) return { value: null };
  switch (kind) {
    case 'email':
      return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(text)
        ? { value: text.toLowerCase() }
        : { value: null, error: `„${text}“ ist keine E-Mail-Adresse` };
    case 'money': {
      const value = parseMoney(text);
      if (value === null || Number.isNaN(value) || value < 0 || value > 99_999_999)
        return { value: null, error: `„${text}“ ist kein Betrag` };
      return { value };
    }
    case 'bool': {
      const t = normalizeHeader(text);
      if (
        ['ja', 'j', 'x', '1', 'true', 'yes', 'wahr', 'unternehmer', 'firma', 'gewerblich', 'b2b'].includes(t)
      )
        return { value: true };
      if (['nein', 'n', '0', 'false', 'no', 'falsch', 'privat', 'verbraucher', 'b2c'].includes(t))
        return { value: false };
      return { value: null, error: `„${text}“ ist weder ja noch nein` };
    }
    case 'unit':
      return { value: normalizeUnit(text) };
    case 'postalCode':
      // Excel entfernt führende Nullen (01067 -> 1067)
      return { value: /^\d{4}$/.test(text) ? `0${text}` : text };
    case 'debtor': {
      const n = Number(text);
      return Number.isInteger(n) && n >= 10000 && n <= 69999
        ? { value: n }
        : { value: null, error: `Debitorennummer „${text}“ muss zwischen 10000 und 69999 liegen` };
    }
    default:
      return { value: text.replace(/\s+/g, ' ') };
  }
}

export interface ParsedRow {
  index: number;
  values: Record<string, Value>;
  errors: string[];
}

export function parseRows(
  entity: EntityType,
  headers: string[],
  rows: string[][],
  mapping: Mapping,
): ParsedRow[] {
  const def = ENTITIES[entity];
  const columns = Object.fromEntries(
    def.fields.map((field) => [field.key, mapping[field.key] ? headers.indexOf(mapping[field.key]!) : -1]),
  );
  return rows.map((row, index) => {
    const values: Record<string, Value> = {};
    const errors: string[] = [];
    for (const field of def.fields) {
      const column = columns[field.key];
      if (column < 0) continue;
      const { value, error } = parseCell(field.kind, row[column] ?? '');
      if (error) errors.push(`${field.label}: ${error}`);
      if (value !== null) values[field.key] = value;
      else if (field.required && !error) errors.push(`${field.label} fehlt`);
    }
    return { index, values, errors };
  });
}

// ── Abgleich ────────────────────────────────────────────────────────────

export interface Existing {
  id: string;
  [field: string]: Value;
}

export type RowStatus = 'new' | 'update' | 'unchanged' | 'duplicate' | 'invalid';

export interface Change {
  field: string;
  label: string;
  old: Value;
  new: Value;
}

export interface MatchedRow extends ParsedRow {
  status: RowStatus;
  matchId: string | null;
  matchLabel: string | null;
  // wodurch der Bestand gefunden wurde, z.B. "Debitorennummer"
  matchedBy: string | null;
  changes: Change[];
  // mögliche Dublette: ähnlicher Name im Bestand (neu anlegen oder nicht?)
  similar: { id: string; label: string }[];
  // Standard in der Auswahl: neu und geändert ja, mögliche Dubletten nein
  preselected: boolean;
}

export const normalizeName = (value: string) =>
  normalizeHeader(
    value.replace(/\b(gmbh|mbh|ag|kg|ohg|gbr|ug|e\.?\s?k|e\.?\s?v|co|und|&|haftungsbeschränkt)\b\.?/gi, ' '),
  );

// Ähnlichkeit zweier Namen (Bigramme, Dice-Koeffizient, 0–1)
export function similarity(a: string, b: string) {
  const x = normalizeName(a);
  const y = normalizeName(b);
  if (!x || !y) return 0;
  if (x === y) return 1;
  const grams = (s: string) => {
    const list: string[] = [];
    for (let i = 0; i < s.length - 1; i++) list.push(s.slice(i, i + 2));
    return list;
  };
  const gx = grams(x);
  const gy = grams(y);
  const pool = [...gy];
  let hits = 0;
  for (const g of gx) {
    const at = pool.indexOf(g);
    if (at >= 0) {
      hits++;
      pool.splice(at, 1);
    }
  }
  return (2 * hits) / (gx.length + gy.length || 1);
}

const SIMILAR = 0.82;

// Schlüssel je Datenart in Reihenfolge der Verlässlichkeit
const KEYS: Record<EntityType, { label: string; key: (v: Record<string, Value>) => string | null }[]> = {
  customers: [
    { label: 'Debitorennummer', key: (v) => (v.debtorNumber != null ? String(v.debtorNumber) : null) },
    { label: 'E-Mail', key: (v) => (v.email ? String(v.email).toLowerCase() : null) },
    {
      label: 'Name und PLZ',
      key: (v) => (v.name && v.postalCode ? `${normalizeName(String(v.name))}|${v.postalCode}` : null),
    },
    { label: 'Name', key: (v) => (v.name ? normalizeName(String(v.name)) : null) },
  ],
  suppliers: [
    { label: 'Name', key: (v) => (v.name ? normalizeName(String(v.name)) : null) },
    { label: 'E-Mail', key: (v) => (v.email ? String(v.email).toLowerCase() : null) },
  ],
  articles: [{ label: 'Artikelnummer', key: (v) => (v.articleNumber ? String(v.articleNumber) : null) }],
  machines: [{ label: 'Bezeichnung', key: (v) => (v.name ? normalizeName(String(v.name)) : null) }],
};

const same = (a: Value, b: Value) =>
  typeof a === 'number' || typeof b === 'number'
    ? Math.abs(Number(a) - Number(b)) < 0.005
    : (a ?? '') === (b ?? '');

export function matchRows(entity: EntityType, rows: ParsedRow[], existing: Existing[]): MatchedRow[] {
  const def = ENTITIES[entity];
  const keys = KEYS[entity];
  // Index je Schlüssel; mehrdeutige Schlüssel (zwei Bestandseinträge) zählen nicht
  const indexes = keys.map(({ key }) => {
    const map = new Map<string, Existing | 'ambiguous'>();
    for (const item of existing) {
      const k = key(item);
      if (!k) continue;
      map.set(k, map.has(k) ? 'ambiguous' : item);
    }
    return map;
  });
  const labelOf = (item: Existing) =>
    [item.articleNumber, item.name, item.city]
      .filter((v) => v !== null && v !== undefined && v !== '')
      .join(' · ');

  // doppelte Zeilen in der Quelle (gleicher erster verfügbarer Schlüssel)
  const firstKeyOf = (values: Record<string, Value>) => {
    for (const { key } of keys) {
      const k = key(values);
      if (k) return k;
    }
    return null;
  };
  const seen = new Map<string, number>();
  const matchedBy = new Map<string, number>(); // Bestandseintrag -> erste Zeile

  return rows.map((row): MatchedRow => {
    const base = { ...row, matchId: null, matchLabel: null, matchedBy: null, changes: [], similar: [] };
    if (row.errors.length) return { ...base, status: 'invalid', preselected: false };
    const own = firstKeyOf(row.values);
    if (own) {
      const earlier = seen.get(own);
      if (earlier !== undefined) {
        return {
          ...base,
          status: 'invalid',
          errors: [`kommt in der Quelle doppelt vor (wie Zeile ${earlier + 2})`],
          preselected: false,
        };
      }
      seen.set(own, row.index);
    }

    for (let i = 0; i < keys.length; i++) {
      const k = keys[i].key(row.values);
      const found = k ? indexes[i].get(k) : undefined;
      if (!found || found === 'ambiguous') continue;
      // gleicher Name, aber andere PLZ: ein anderer Kunde (höchstens Dublette)
      if (
        keys[i].label === 'Name' &&
        entity === 'customers' &&
        row.values.postalCode &&
        found.postalCode &&
        row.values.postalCode !== found.postalCode
      )
        continue;
      const changes = def.fields
        .filter(
          (field) =>
            field.key in row.values &&
            !same(row.values[field.key], found[field.key] ?? null) &&
            // nur andere Schreibweise der Rechtsform o.ä.: Name bleibt
            !(
              field.key === 'name' &&
              normalizeName(String(row.values.name)) === normalizeName(String(found.name ?? ''))
            ),
        )
        .map((field) => ({
          field: field.key,
          label: field.label,
          old: found[field.key] ?? null,
          new: row.values[field.key],
        }));
      const earlierMatch = matchedBy.get(found.id);
      if (earlierMatch !== undefined) {
        return {
          ...base,
          status: 'invalid',
          errors: [`betrifft denselben Eintrag wie Zeile ${earlierMatch + 2} (${labelOf(found)})`],
          preselected: false,
        };
      }
      matchedBy.set(found.id, row.index);
      return {
        ...base,
        matchId: found.id,
        matchLabel: labelOf(found),
        matchedBy: keys[i].label,
        changes,
        status: changes.length ? 'update' : 'unchanged',
        preselected: changes.length > 0,
      };
    }

    const name = row.values.name ? String(row.values.name) : null;
    const similar =
      name && entity !== 'articles'
        ? existing
            .filter((item) => item.name && similarity(name, String(item.name)) >= SIMILAR)
            .slice(0, 3)
            .map((item) => ({ id: item.id, label: labelOf(item) }))
        : [];
    return similar.length
      ? { ...base, similar, status: 'duplicate', preselected: false }
      : { ...base, status: 'new', preselected: true };
  });
}
