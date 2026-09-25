import { describe, expect, it } from 'vitest';
import { pipeFittings } from './fittings';

// gleiche Rechnung wie im Backend (dort ausführlich getestet): hier nur die Einbindung
describe('Formstücke im Editor', () => {
  it('Ecke, Fallrohr mit Abzweig und Anschlussrohr', () => {
    const rows = pipeFittings(
      [
        {
          id: 'l',
          type: 'rainwater',
          points: [
            [0, 0],
            [100, 0],
            [100, 80],
          ],
          props: { dn: 110 },
        },
        { id: 'f', type: 'downpipe', points: [[50, 1]] },
      ],
      10,
    );
    expect(rows.map((r) => [r.key, r.quantity])).toEqual([
      ['rainwater:bogen87-dn110', 2],
      ['rainwater:anschluss-dn110', 0.5],
      ['rainwater:abzweig-dn110', 1],
    ]);
  });
});
