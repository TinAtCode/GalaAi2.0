// KI-Aufgaben in GartenAI – anbieterneutral. Jede Aufgabe legt fest, was sie
// vom Anbieter braucht; welcher Anbieter (und welches Modell) sie übernimmt,
// stellt die Firma ein (AiTaskAssignment), sonst gilt der Standard-Anbieter.
// Eigene Agenten bekommen die Kennung als `task` (KI-ANBINDUNG.md).
export type AiCapability = 'text' | 'vision' | 'image';

export const AI_CAPABILITIES: { key: AiCapability; label: string }[] = [
  { key: 'text', label: 'Text' },
  { key: 'vision', label: 'Bilder verstehen' },
  { key: 'image', label: 'Bilder/Zeichnungen erzeugen' },
];

export interface AiTaskDefinition {
  key: string;
  label: string;
  description: string;
  needs: AiCapability;
}

export const AI_TASKS: AiTaskDefinition[] = [
  {
    key: 'frage',
    label: 'Freie Frage',
    description: 'Frage an die KI in den Einstellungen',
    needs: 'text',
  },
  {
    key: 'angebotstext',
    label: 'Angebotstext entwerfen',
    description: 'Anschreiben zum Angebot aus Kunde, Projekt und Positionen (ohne Einkaufspreise)',
    needs: 'text',
  },
  {
    key: 'baustelle_zusammenfassung',
    label: 'Baustellen-Verlauf zusammenfassen',
    description: 'Kurzfassung der Nachrichten einer Baustelle: Stand, offene Punkte, Material',
    needs: 'text',
  },
  {
    key: 'beleg_lesen',
    label: 'Beleg lesen',
    description: 'Eingangsrechnung (Foto oder PDF) lesen: Lieferant, Nummer, Datum, Beträge, IBAN',
    needs: 'vision',
  },
  {
    key: 'foto_beschreiben',
    label: 'Baustellenfoto beschreiben',
    description: 'Was ist auf dem Foto zu sehen: Stand der Arbeiten, Schäden, Material',
    needs: 'vision',
  },
  {
    key: 'lageplan_zeichnen',
    label: 'Lageplan zeichnen',
    description:
      'Flächen, Leitungen und Symbole nach Auftrag in den Lageplan zeichnen (Vorschlag, rückgängig machbar)',
    needs: 'image',
  },
];

export const findTask = (key: string | undefined) => AI_TASKS.find((t) => t.key === key);
