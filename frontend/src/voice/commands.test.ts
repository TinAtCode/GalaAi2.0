import { describe, expect, it } from 'vitest';
import { parseCommand, spokenProjectNumber } from './commands';

const targets = [
  { to: '/', label: 'Mein Tag' },
  { to: '/plantafel', label: 'Plantafel' },
  { to: '/geraete', label: 'Geräte' },
  { to: '/offene-posten', label: 'Offene Posten' },
  { to: '/kunden', label: 'Kunden' },
];

describe('Sprachbefehle', () => {
  it('öffnet Bereiche über Menünamen und weitere Wörter', () => {
    expect(parseCommand('Öffne die Plantafel', targets)).toEqual({
      kind: 'navigate',
      to: '/plantafel',
      label: 'Plantafel',
    });
    expect(parseCommand('zeig mir die Fahrzeuge', targets)).toMatchObject({ to: '/geraete' });
    expect(parseCommand('Einsatzplan', targets)).toMatchObject({ to: '/plantafel' });
    expect(parseCommand('offene Posten', targets)).toMatchObject({ to: '/offene-posten' });
    expect(parseCommand('heute', targets)).toMatchObject({ to: '/' });
  });

  it('nur Bereiche, die der Nutzer sieht', () => {
    expect(parseCommand('Finanzen', targets)).toEqual({ kind: 'unknown', text: 'Finanzen' });
  });

  it('Suche, Projektnummer, zurück', () => {
    expect(parseCommand('Suche nach Familie Müller', targets)).toEqual({
      kind: 'search',
      query: 'familie müller',
    });
    expect(parseCommand('Projekt P 2026 12', targets)).toEqual({ kind: 'search', query: 'P-2026-0012' });
    expect(parseCommand('zurück', targets)).toEqual({ kind: 'back' });
    expect(spokenProjectNumber('p-2026-0007')).toBe('P-2026-0007');
  });
});
