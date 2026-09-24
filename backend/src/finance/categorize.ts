// Kategorien für Ausgaben: Standardliste für den GaLaBau und Stichwort-Regeln
// zum Start. Firmen passen beides an; die Migration 20260924110000 legt
// dieselben Werte für bestehende Firmen an.
export const DEFAULT_CATEGORIES = [
  'Material',
  'Fahrzeuge',
  'Maschinen',
  'Miete',
  'Personal',
  'Versicherungen',
  'Büro',
  'Steuern',
  'Sonstiges',
] as const;

// Stichwort -> Kategorie (Suche in Empfänger und Verwendungszweck, ohne
// Groß-/Kleinschreibung)
export const DEFAULT_RULES: [string, (typeof DEFAULT_CATEGORIES)[number]][] = [
  ['tankstelle', 'Fahrzeuge'],
  ['aral', 'Fahrzeuge'],
  ['shell', 'Fahrzeuge'],
  ['esso', 'Fahrzeuge'],
  ['totalenergies', 'Fahrzeuge'],
  ['kfz-steuer', 'Fahrzeuge'],
  ['baustoff', 'Material'],
  ['baywa', 'Material'],
  ['raiffeisen', 'Material'],
  ['hornbach', 'Material'],
  ['bauhaus', 'Material'],
  ['obi ', 'Material'],
  ['baumschule', 'Material'],
  ['miete', 'Miete'],
  ['pacht', 'Miete'],
  ['lohn', 'Personal'],
  ['gehalt', 'Personal'],
  ['krankenkasse', 'Personal'],
  ['aok', 'Personal'],
  ['berufsgenossenschaft', 'Personal'],
  ['versicherung', 'Versicherungen'],
  ['allianz', 'Versicherungen'],
  ['telekom', 'Büro'],
  ['vodafone', 'Büro'],
  ['finanzamt', 'Steuern'],
  ['steuerberat', 'Büro'],
];

export interface CategorizableEntry {
  counterpartyName: string | null;
  counterpartyIban: string | null;
  remittance: string | null;
}

export interface CategoryRuleInput {
  categoryId: string;
  pattern: string;
  field: 'any' | 'counterparty' | 'remittance' | 'iban';
}

// Gelernte Zuordnungen: Kategorie je IBAN bzw. je Empfängername aus früheren
// Zuordnungen von Hand
export interface Learned {
  byIban: Map<string, string>;
  byName: Map<string, string>;
}

export const normalizeName = (name: string | null) =>
  (name ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9äöüß]+/g, ' ')
    .trim();
// Stichwort wie der Text normalisieren; Leerzeichen am Rand bleiben als
// Wortgrenze erhalten ("obi " trifft nicht "Obitec")
export const normalizePattern = (pattern: string) => pattern.toLowerCase().replace(/[^a-z0-9äöüß]+/g, ' ');
export const normalizeIban = (iban: string | null) => (iban ?? '').replace(/\s+/g, '').toUpperCase();

// Vorschlag für eine Abbuchung: zuerst was von Hand schon einmal so
// zugeordnet wurde (gleiche IBAN, sonst gleicher Name), dann die Regeln in
// der gegebenen Reihenfolge. Nichts passt: null.
export function suggestCategory(
  entry: CategorizableEntry,
  rules: CategoryRuleInput[],
  learned: Learned,
): { categoryId: string; source: 'learned' | 'rule' } | null {
  const iban = normalizeIban(entry.counterpartyIban);
  const name = normalizeName(entry.counterpartyName);
  const fromIban = iban ? learned.byIban.get(iban) : undefined;
  if (fromIban) return { categoryId: fromIban, source: 'learned' };
  const fromName = name ? learned.byName.get(name) : undefined;
  if (fromName) return { categoryId: fromName, source: 'learned' };

  // Satzzeichen wie Leerzeichen: "Müller GmbH & Co. KG" -> " müller gmbh co kg "
  const texts = {
    counterparty: ` ${name} `,
    remittance: ` ${normalizeName(entry.remittance)} `,
    iban,
  };
  for (const rule of rules) {
    const pattern = normalizePattern(rule.pattern);
    if (!pattern.trim()) continue;
    const hit =
      rule.field === 'iban'
        ? texts.iban === normalizeIban(rule.pattern)
        : rule.field === 'counterparty'
          ? texts.counterparty.includes(pattern)
          : rule.field === 'remittance'
            ? texts.remittance.includes(pattern)
            : texts.counterparty.includes(pattern) || texts.remittance.includes(pattern);
    if (hit) return { categoryId: rule.categoryId, source: 'rule' };
  }
  return null;
}
