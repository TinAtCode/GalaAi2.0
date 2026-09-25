// Sprachbefehle ohne KI: feste Wörter werden festen Befehlen zugeordnet.
// Die Erkennung (Sprache → Text) macht der Browser; hier wird nur der Text
// ausgewertet – nachvollziehbar und ohne Sprachmodell.

export type VoiceCommand =
  | { kind: 'navigate'; to: string; label: string }
  | { kind: 'search'; query: string }
  | { kind: 'back' }
  | { kind: 'unknown'; text: string };

export interface VoiceTarget {
  to: string;
  label: string;
}

// weitere Wörter je Bereich (zusätzlich zur Beschriftung im Menü)
export const ALIASES: Record<string, string[]> = {
  '/': ['mein tag', 'start', 'startseite', 'heute', 'übersicht'],
  '/baustelle': ['baustelle', 'baustellen'],
  '/projekte': ['projekte', 'projektliste', 'aufträge'],
  '/kunden': ['kunden', 'kundenliste'],
  '/kalender': ['kalender', 'termine'],
  '/plantafel': ['plantafel', 'einsatzplan', 'wochenplan', 'einsatzplanung'],
  '/vertraege': ['pflegeverträge', 'wartungsverträge', 'verträge'],
  '/geraete': ['geräte', 'fahrzeuge', 'maschinen', 'fuhrpark'],
  '/checklisten': ['checklisten', 'checkliste', 'vorlagen'],
  '/lieferscheine': ['lieferscheine', 'lieferschein'],
  '/kalkulation': ['kalkulation', 'rechner'],
  '/stammdaten': ['stammdaten', 'artikel', 'leistungen', 'lieferanten'],
  '/offene-posten': ['offene posten', 'rechnungen', 'mahnungen'],
  '/bankabgleich': ['bankabgleich', 'bank', 'kontoauszug'],
  '/finanzen': ['finanzen', 'liquidität', 'fixkosten'],
  '/team': ['team', 'mitarbeiter', 'abwesenheiten'],
  '/einstellungen': ['einstellungen', 'firma'],
  '/offline': ['offline pläne', 'offline'],
};

const FILLERS =
  /^(bitte\s+)?(öffne|öffnen|zeige|zeig|zeigen|gehe zu|geh zu|geh auf|gehe auf|wechsel zu|wechsle zu|zu|nach|auf)\s+(die |den |das |der |mir )?/;

export const normalizeSpeech = (text: string) =>
  text
    .toLowerCase()
    .replace(/[.,!?;:„“"]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

// "p 2026 12", "P-2026-12", "projekt p 2026 0012" → "P-2026-0012"
export function spokenProjectNumber(text: string): string | null {
  const match = normalizeSpeech(text).match(/\bp\s*-?\s*(\d{4})\s*-?\s*(\d{1,5})\b/);
  return match ? `P-${match[1]}-${match[2].padStart(4, '0')}` : null;
}

export function parseCommand(input: string, targets: VoiceTarget[]): VoiceCommand {
  const text = normalizeSpeech(input);
  if (!text) return { kind: 'unknown', text: input };
  if (/^(zurück|zurueck|geh zurück|gehe zurück)$/.test(text)) return { kind: 'back' };

  const number = spokenProjectNumber(text);
  if (number) return { kind: 'search', query: number };

  const search = text.match(/^(suche|such|suchen|finde|finden)( nach)? (.+)$/);
  if (search) return { kind: 'search', query: search[3].trim() };

  const phrase = text.replace(FILLERS, '').trim();
  // längste Übereinstimmung gewinnt ("offene posten" vor "posten")
  let best: { target: VoiceTarget; length: number } | null = null;
  for (const target of targets) {
    const words = [target.label.toLowerCase(), ...(ALIASES[target.to] ?? [])];
    for (const word of words)
      if (
        (phrase === word || phrase.startsWith(`${word} `) || phrase.endsWith(` ${word}`)) &&
        (!best || word.length > best.length)
      )
        best = { target, length: word.length };
  }
  if (best) return { kind: 'navigate', to: best.target.to, label: best.target.label };
  return { kind: 'unknown', text: input };
}
