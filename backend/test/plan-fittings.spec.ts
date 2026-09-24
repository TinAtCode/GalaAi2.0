import { bendsFor, pipeFittings } from '../src/plans/plan-fittings';
import { isQuantityKey, planQuantities, validateObjects } from '../src/plans/plan-geometry';
import { PlanObject } from '../src/plans/plan-catalog';

// Formstücke aus der Zeichnung: 1 m = 10 Planeinheiten
const U = 10;
const at = (x: number, y: number): [number, number] => [x * U, y * U];
const q = (rows: { key: string; quantity: number }[], key: string) =>
  rows.find((r) => r.key === key)?.quantity;

describe('Formstücke der Entwässerung', () => {
  it('Knicke werden zu Normbögen', () => {
    expect(bendsFor(3)).toEqual([]);
    expect(bendsFor(14)).toEqual([15]);
    expect(bendsFor(44)).toEqual([45]);
    expect(bendsFor(90)).toEqual([87]);
    expect(bendsFor(120)).toEqual([87, 30]);
  });

  // Hauptleitung DN 150 mit einer 90°-Ecke, 0,80 m tief; ein Fallrohr mitten
  // an der Leitung auf einer Pflasterfläche +0,15 m; ein Gully am Leitungsende;
  // eine Nebenleitung DN 110 endet auf der Hauptleitung; ein Schacht am Anfang
  const plan: PlanObject[] = [
    {
      id: 'main',
      type: 'rainwater',
      points: [at(0, 0), at(10, 0), at(10, 8)],
      props: { dn: 150, depth: 0.8 },
    },
    { id: 'side', type: 'rainwater', points: [at(5, 6), at(5, 0)], props: { dn: 110 } },
    {
      id: 'pflaster',
      type: 'paving',
      points: [at(1, -2), at(4, -2), at(4, 2), at(1, 2)],
      props: { height: 0.15 },
    },
    { id: 'fallrohr', type: 'downpipe', points: [at(2, 0.2)] },
    { id: 'gully', type: 'gully', points: [at(10, 8)] },
    { id: 'schacht', type: 'manhole', points: [at(0, 0), at(0.5, 0)], props: { shape: 'circle' } },
    { id: 'haus', type: 'building', points: [at(12, 0), at(20, 0), at(20, 8), at(12, 8)] },
    { id: 'hp', type: 'height_point', points: [at(15, 10)], props: { height: 0.3 } },
  ];

  it('Bögen, Abzweige, Anschlussrohre und Schachttiefe', () => {
    expect(validateObjects(plan)).toBeNull();
    const rows = pipeFittings(plan, U);
    // Ecke der Hauptleitung (87°) + Bogen am Fallrohr + Bogen am Gully
    expect(q(rows, 'rainwater:bogen87-dn150')).toBe(3);
    // Fallrohr mitten an der Leitung + Nebenleitung endet auf ihr
    expect(q(rows, 'rainwater:abzweig-dn150')).toBe(2);
    // Anschlussrohr: Fallrohr 0,80 + 0,15 (Pflaster), Gully 0,80
    expect(q(rows, 'rainwater:anschluss-dn150')).toBeCloseTo(1.75);
    // Schacht bis zur Hauptleitung
    expect(q(rows, 'manhole:tiefe')).toBeCloseTo(0.8);
    // Nebenleitung: gerade, ohne eigene Formstücke
    expect(rows.some((r) => r.key.endsWith('-dn110'))).toBe(false);
  });

  it('Standardtiefe 0,50 m ohne Angabe, Gebäude und Höhenpunkte ohne Menge', () => {
    const rows = pipeFittings(
      [
        { id: 'p', type: 'wastewater', points: [at(0, 0), at(6, 0)] },
        { id: 'g', type: 'gully', points: [at(3, 0)] },
      ],
      U,
    );
    expect(q(rows, 'wastewater:anschluss')).toBeCloseTo(0.5);
    expect(q(rows, 'wastewater:abzweig')).toBe(1);
    const all = planQuantities(plan, U);
    expect(all.some((r) => r.key === 'building' || r.key === 'height_point')).toBe(false);
    expect(q(all, 'paving')).toBeCloseTo(12);
    for (const r of all) expect(isQuantityKey(r.key)).toBe(true);
  });

  it('Leerrohre mit DN und Bögen, Höhe nur bei Flächen und Höhenpunkten', () => {
    const conduit: PlanObject[] = [
      { id: 'l', type: 'conduit', points: [at(0, 0), at(4, 0), at(4, 4)], props: { dn: 50, depth: 0.6 } },
    ];
    expect(validateObjects(conduit)).toBeNull();
    expect(q(pipeFittings(conduit, U), 'conduit:bogen87-dn50')).toBe(1);
    expect(
      validateObjects([{ id: 'x', type: 'fence', points: [at(0, 0), at(1, 0)], props: { height: 1 } }]),
    ).toContain('keine Höhe');
    expect(isQuantityKey('conduit:bogen45-dn50')).toBe(true);
    expect(isQuantityKey('fence:bogen45')).toBe(false);
    expect(isQuantityKey('rainwater:bogen33')).toBe(false);
  });
});
