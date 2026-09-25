// Lieferschein erkennen: aus dem Text (Texterkennung) Lieferant, Projekt,
// Lieferscheinnummer und Datum ermitteln. Nur Vorschläge – das Büro bestätigt.

export interface SupplierCandidate {
  id: string;
  name: string;
  email: string | null;
  matchTerms: string[];
}

export interface ProjectCandidate {
  id: string;
  number: string | null;
  title: string;
  customerName: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
}

export interface Recognition {
  supplierId: string | null;
  projectId: string | null;
  noteNumber: string | null;
  noteDate: string | null; // JJJJ-MM-TT
  hints: { supplier?: string; project?: string };
}

// Rechtsformen und Füllwörter zählen beim Namensvergleich nicht
const LEGAL = /\b(gmbh|mbh|ag|kg|ohg|gbr|ug|e\s?k|e\s?v|co|und|&|inh|haftungsbeschränkt)\b/g;

export const normalize = (value: string) =>
  value
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .replace(/str\.|strasse/g, 'str')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

const coreName = (value: string) => normalize(value).replace(LEGAL, ' ').replace(/\s+/g, ' ').trim();
const hasPhrase = (text: string, phrase: string) => !!phrase && ` ${text} `.includes(` ${phrase} `);

function pickBest<T>(scored: { item: T; score: number; hint: string }[]) {
  const sorted = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score);
  // nur eindeutige Treffer vorschlagen
  if (!sorted.length || (sorted[1] && sorted[1].score === sorted[0].score)) return null;
  return sorted[0];
}

export function recognizeSupplier(text: string, suppliers: SupplierCandidate[]) {
  const norm = normalize(text);
  const lower = text.toLowerCase();
  return pickBest(
    suppliers.map((s) => {
      let score = 0;
      const hints: string[] = [];
      const name = coreName(s.name);
      if (name.length >= 3 && hasPhrase(norm, name)) {
        score += 3;
        hints.push(`Name „${s.name}“`);
      }
      for (const term of s.matchTerms) {
        const t = normalize(term);
        if (t.length >= 3 && hasPhrase(norm, t)) {
          score += 2;
          hints.push(`„${term}“`);
        }
      }
      const domain = s.email?.split('@')[1]?.toLowerCase();
      if (domain && domain.length > 4 && lower.includes(domain)) {
        score += 2;
        hints.push(`Adresse ${domain}`);
      }
      return { item: s, score, hint: hints.join(', ') };
    }),
  );
}

const PROJECT_NUMBER = /\bP\s*-\s*(\d{4})\s*-\s*(\d{3,5})\b/i;
// "Kommission: Müller", "Bauvorhaben Gartenweg 1", "BV: ..."
const REFERENCE =
  /(?:kommission|komm\.?|bauvorhaben|bv|baustelle|objekt|projekt|ihr zeichen)\s*[:.]?\s*([^\n]{3,80})/gi;

export function recognizeProject(text: string, projects: ProjectCandidate[]) {
  const numberMatch = text.match(PROJECT_NUMBER);
  if (numberMatch) {
    const number = `P-${numberMatch[1]}-${numberMatch[2].padStart(4, '0')}`;
    const project = projects.find((p) => p.number?.toUpperCase() === number.toUpperCase());
    if (project) return { item: project, score: 10, hint: `Projektnummer ${project.number}` };
  }
  const norm = normalize(text);
  const references = [...text.matchAll(REFERENCE)].map((m) => normalize(m[1]));
  return pickBest(
    projects.map((p) => {
      let score = 0;
      const hints: string[] = [];
      const street = p.street ? normalize(p.street) : '';
      if (street.length >= 5 && hasPhrase(norm, street)) {
        score += 3;
        hints.push(`Lieferadresse ${p.street}`);
        if (p.postalCode && norm.includes(p.postalCode)) score += 1;
      }
      const customer = coreName(p.customerName);
      const title = coreName(p.title);
      for (const ref of references) {
        if (customer.length >= 3 && hasPhrase(ref, customer)) {
          score += 2;
          hints.push(`Kommission „${p.customerName}“`);
        } else if (title.length >= 5 && hasPhrase(ref, title)) {
          score += 2;
          hints.push(`Bauvorhaben „${p.title}“`);
        }
      }
      return { item: p, score, hint: hints.join(', ') };
    }),
  );
}

const NOTE_NUMBER =
  /(?:lieferschein|lieferscheinnummer|ls)[\s-]*(?:nr\.?|nummer|no\.?)?\s*[:#.]?\s*([a-z0-9][a-z0-9\-/]{2,24})/i;
const LABELED_DATE = /(?:lieferdatum|lieferschein\s*datum|datum)\s*[:.]?\s*(\d{1,2})\.(\d{1,2})\.(\d{2,4})/i;
const ANY_DATE = /\b(\d{1,2})\.(\d{1,2})\.(\d{4})\b/;

function toDay(d: string, m: string, y: string) {
  const year = y.length === 2 ? 2000 + Number(y) : Number(y);
  const day = Number(d);
  const month = Number(m);
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function recognizeDeliveryNote(
  text: string,
  suppliers: SupplierCandidate[],
  projects: ProjectCandidate[],
): Recognition {
  const supplier = recognizeSupplier(text, suppliers);
  const project = recognizeProject(text, projects);
  const numberMatch = text.match(NOTE_NUMBER);
  // "Lieferschein" allein ohne Ziffer ist keine Nummer
  const noteNumber = numberMatch && /\d/.test(numberMatch[1]) ? numberMatch[1].toUpperCase() : null;
  const dateMatch = text.match(LABELED_DATE) ?? text.match(ANY_DATE);
  return {
    supplierId: supplier?.item.id ?? null,
    projectId: project?.item.id ?? null,
    noteNumber,
    noteDate: dateMatch ? toDay(dateMatch[1], dateMatch[2], dateMatch[3]) : null,
    hints: {
      ...(supplier ? { supplier: supplier.hint } : {}),
      ...(project ? { project: project.hint } : {}),
    },
  };
}
