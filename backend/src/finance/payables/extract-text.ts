import { EMPTY_DRAFT, PayableDraft } from './einvoice';

// Vorschläge aus dem erkannten Text einer Rechnung (PDF-Textebene oder
// Texterkennung eines Fotos). Heuristisch: jeder Wert ist nur ein Vorschlag,
// den man vor dem Speichern prüft; bei mehreren Treffern gibt es Kandidaten.
export interface TextSuggestion extends PayableDraft {
  candidates: {
    supplierName: string[];
    amount: string[];
    invoiceNumber: string[];
    iban: string[];
  };
}

const AMOUNT = String.raw`(-?\d{1,3}(?:[.\s]\d{3})*,\d{2}|-?\d+,\d{2}|-?\d{1,3}(?:,\d{3})*\.\d{2}|-?\d+\.\d{2})`;
const DATE = String.raw`(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{2,4})`;

// Schlüsselwörter für den zu zahlenden Betrag, stärkste zuerst
const TOTAL_KEYWORDS = [
  'zahlbetrag',
  'zu zahlen',
  'zu zahlender betrag',
  'rechnungsbetrag',
  'gesamtbetrag',
  'endbetrag',
  'bruttobetrag',
  'summe brutto',
  'gesamt brutto',
  'brutto',
  'gesamtsumme',
  'total',
  'summe',
];

// "1.234,56" / "1 234,56" / "1,234.56" / "1234.56" -> "1234.56"
export function parseAmountText(value: string): string | null {
  const v = value.replace(/\s/g, '');
  let normalized: string;
  if (/,\d{2}$/.test(v)) normalized = v.replace(/\./g, '').replace(',', '.');
  else if (/\.\d{2}$/.test(v)) normalized = v.replace(/,/g, '');
  else return null;
  const n = Number(normalized);
  return Number.isFinite(n) ? n.toFixed(2) : null;
}

// "5.10.26" / "05.10.2026" -> "2026-10-05"; ungültig: null
export function parseDateText(d: string, m: string, y: string): string | null {
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const month = Number(m);
  const day = Number(d);
  if (year < 2000 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCMonth() !== month - 1) return null;
  return date.toISOString().slice(0, 10);
}

function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// IBAN mit gültiger Prüfsumme (ISO 13616, mod 97)
export function validIban(iban: string) {
  if (!/^[A-Z]{2}\d{2}[A-Z0-9]{11,30}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  const digits = rearranged.replace(/[A-Z]/g, (c) => String(c.charCodeAt(0) - 55));
  let rest = 0;
  for (const ch of digits) rest = (rest * 10 + Number(ch)) % 97;
  return rest === 1;
}

const unique = <T>(list: T[]) => [...new Set(list)];
const LEGAL_FORM = /\b(gmbh|ag|kg|ohg|ug|e\.\s?k\.?|gbr|mbh|co\.?\s?kg|ltd|inc|se)\b/i;
const NOT_A_NAME =
  /^(rechnung|invoice|seite|page|datum|kunden|lieferschein|telefon|tel\.|fax|e-?mail|www\.|ust|steuer|iban|bic|bank)/i;

export function extractFromText(
  text: string,
  options: { knownSuppliers?: string[]; ownIbans?: string[]; ownName?: string } = {},
): TextSuggestion {
  const lines = text
    .split(/\r?\n/)
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  const lower = lines.map((l) => l.toLowerCase());
  const flat = lower.join('\n');

  // Betrag: Zeilen mit Schlüsselwort, der letzte Betrag der Zeile (oder der
  // nächsten, wenn die Zeile keinen hat); Reihenfolge nach Schlüsselwort
  const amountHits: { value: string; rank: number; index: number }[] = [];
  lower.forEach((line, index) => {
    const rank = TOTAL_KEYWORDS.findIndex((k) => line.includes(k));
    if (rank < 0 || /netto|zwischensumme|mwst|ust\.?\s|steuer/.test(line.replace(/brutto/, ''))) return;
    const inLine = [...lines[index].matchAll(new RegExp(AMOUNT, 'g'))].map((m) => m[1]);
    const next =
      index + 1 < lines.length
        ? [...lines[index + 1].matchAll(new RegExp(AMOUNT, 'g'))].map((m) => m[1])
        : [];
    const raw = inLine.length ? inLine[inLine.length - 1] : next[0];
    const value = raw ? parseAmountText(raw) : null;
    if (value && Number(value) > 0) amountHits.push({ value, rank, index });
  });
  amountHits.sort((a, b) => a.rank - b.rank || b.index - a.index);
  let amounts = unique(amountHits.map((h) => h.value));
  if (amounts.length === 0) {
    // ohne Schlüsselwort: die größten Beträge im Text
    const all = [...text.matchAll(new RegExp(AMOUNT, 'g'))]
      .map((m) => parseAmountText(m[1]))
      .filter((v): v is string => !!v && Number(v) > 0);
    amounts = unique(all.sort((a, b) => Number(b) - Number(a))).slice(0, 3);
  }

  // Rechnungsnummer
  const numbers = unique(
    [
      ...flat.matchAll(
        /(?:rechnungs-?\s?(?:nr|nummer|no)\.?|rechnung\s+(?:nr|no)\.?|re\.?-?nr\.?|invoice\s+(?:no|number|#))\s*[:#]?\s*([a-z0-9][a-z0-9\-/.]{2,24})/g,
      ),
    ]
      .map((m) => m[1].replace(/[.\-/]$/, ''))
      .filter((n) => /\d/.test(n))
      .map((n) => text.match(new RegExp(n.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&'), 'i'))?.[0] ?? n),
  );

  // Daten: Rechnungsdatum, Fälligkeit, Skonto
  const dateNear = (pattern: RegExp) => {
    for (const line of lower) {
      if (!pattern.test(line)) continue;
      const m = line.match(new RegExp(DATE));
      if (m) {
        const day = parseDateText(m[1], m[2], m[3]);
        if (day) return day;
      }
    }
    return null;
  };
  const allDates = [...flat.matchAll(new RegExp(DATE, 'g'))]
    .map((m) => parseDateText(m[1], m[2], m[3]))
    .filter((d): d is string => !!d);
  const invoiceDate =
    dateNear(/rechnungsdatum|datum der rechnung|invoice date|^datum|\bdatum:/) ?? allDates[0] ?? null;
  let dueDate = dateNear(/fällig|zahlbar bis|zahlungsziel|due date|spätestens/);
  if (!dueDate && invoiceDate) {
    const days = flat.match(
      /(?:zahlbar|zahlungsziel|zahlung)\s+(?:innerhalb\s+)?(?:von\s+)?(\d{1,3})\s+tage/,
    );
    if (days) dueDate = addDays(invoiceDate, Number(days[1]));
  }
  let discountPercent: string | null = null;
  let discountUntil: string | null = null;
  // nur der Satz mit "Skonto" (die Zeile kann auch das Zahlungsziel enthalten)
  const skontoLine = lower.flatMap((l) => l.split(/[.;]\s+/)).find((sentence) => sentence.includes('skonto'));
  if (skontoLine) {
    const percent = skontoLine.match(/(\d{1,2}(?:[.,]\d{1,2})?)\s*%/);
    if (percent) discountPercent = Number(percent[1].replace(',', '.')).toFixed(2);
    const until = skontoLine.match(new RegExp(DATE));
    if (until) discountUntil = parseDateText(until[1], until[2], until[3]);
    const days = skontoLine.match(/(\d{1,3})\s+tage/);
    if (!discountUntil && days && invoiceDate) discountUntil = addDays(invoiceDate, Number(days[1]));
    if (!discountPercent) discountUntil = null;
  }

  // IBAN des Lieferanten: gültige Prüfsumme, nicht die eigene
  const own = new Set((options.ownIbans ?? []).map((i) => i.replace(/\s/g, '').toUpperCase()));
  const ibans = unique(
    [...text.toUpperCase().matchAll(/\b([A-Z]{2}\d{2}(?:\s?[A-Z0-9]{4}){3,7}(?:\s?[A-Z0-9]{1,4})?)\b/g)]
      .map((m) => m[1].replace(/\s/g, ''))
      .filter((iban) => validIban(iban) && !own.has(iban)),
  );

  // Lieferant: bekannte Lieferanten im Text, dann Zeilen mit Rechtsform, dann
  // die erste Zeile, die wie ein Name aussieht (Briefkopf)
  const known = (options.knownSuppliers ?? []).filter(
    (name) => name.trim().length >= 3 && flat.includes(name.toLowerCase()),
  );
  const ownName = options.ownName?.toLowerCase();
  const legal = lines
    .filter((l) => LEGAL_FORM.test(l) && l.length <= 80 && !NOT_A_NAME.test(l))
    .map((l) => l.replace(/\s*[·|,]\s.*$/, '').trim())
    .filter((l) => !ownName || !l.toLowerCase().includes(ownName));
  const header = lines
    .slice(0, 6)
    .filter((l) => /[a-zäöü]{3}/i.test(l) && !NOT_A_NAME.test(l) && !/\d{5}/.test(l) && l.length <= 60)
    .filter((l) => !ownName || !l.toLowerCase().includes(ownName));
  const suppliers = unique([...known, ...legal, ...header]).slice(0, 5);

  return {
    ...EMPTY_DRAFT,
    supplierName: suppliers[0] ?? null,
    supplierIban: ibans[0] ?? null,
    invoiceNumber: numbers[0] ?? null,
    invoiceDate,
    dueDate,
    amount: amounts[0] ?? null,
    discountPercent,
    discountUntil,
    candidates: {
      supplierName: suppliers,
      amount: amounts.slice(0, 5),
      invoiceNumber: numbers.slice(0, 5),
      iban: ibans,
    },
  };
}
