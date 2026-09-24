import { readFileSync } from 'fs';
import { PlanObject } from '../src/plans/plan-catalog';
import {
  isQuantityKey,
  planQuantities,
  polygonArea,
  polygonPerimeter,
  polylineLength,
  validateObjects,
} from '../src/plans/plan-geometry';
import { imageSize } from '../src/plans/image-size';

// 50 Planeinheiten = 1 m
const obj = (o: Partial<PlanObject> & Pick<PlanObject, 'type' | 'points'>): PlanObject => ({
  id: Math.random().toString(36),
  ...o,
});

describe('Lageplan: Geometrie', () => {
  it('Länge, Fläche, Umfang', () => {
    expect(
      polylineLength([
        [0, 0],
        [300, 0],
        [300, 400],
      ]),
    ).toBe(700);
    // 10 m × 4 m bei 50 Einheiten je Meter
    const rect: [number, number][] = [
      [0, 0],
      [500, 0],
      [500, 200],
      [0, 200],
    ];
    expect(polygonArea(rect)).toBe(100_000);
    expect(polygonPerimeter(rect)).toBe(1400);
    // Umlaufrichtung egal
    expect(polygonArea([...rect].reverse())).toBe(100_000);
  });

  it('Mengen je Objektart', () => {
    const rows = planQuantities(
      [
        obj({
          type: 'rainwater',
          points: [
            [0, 0],
            [500, 0],
          ],
        }),
        obj({
          type: 'rainwater',
          points: [
            [0, 0],
            [0, 125],
          ],
        }),
        obj({
          type: 'lawn',
          points: [
            [0, 0],
            [500, 0],
            [500, 200],
            [0, 200],
          ],
          props: { mowingEdge: true },
        }),
        obj({
          type: 'lawn',
          points: [
            [0, 0],
            [100, 0],
            [100, 100],
          ],
        }),
        obj({
          type: 'parking',
          points: [
            [0, 0],
            [250, 0],
            [250, 500],
            [0, 500],
          ],
          props: { spaces: 2 },
        }),
        obj({
          type: 'gate',
          points: [
            [0, 0],
            [175, 0],
          ],
        }),
        obj({ type: 'downpipe', points: [[1, 1]] }),
        obj({ type: 'downpipe', points: [[2, 2]] }),
        obj({ type: 'pictogram', points: [[3, 3]], props: { icon: 'tree' } }),
        obj({ type: 'text', points: [[4, 4]], label: 'Einfahrt' }),
      ],
      50,
    );
    // Formstücke (Fallrohre an der Leitung) prüft plan-fittings.spec.ts; hier nur ihre Summe
    const fittings = (key: string) => /:(bogen|abzweig|anschluss)/.test(key);
    expect(rows.filter((r) => fittings(r.key)).map((r) => [r.key, r.quantity])).toEqual([
      ['rainwater:anschluss', 1],
      ['rainwater:bogen87', 2],
    ]);
    expect(rows.filter((r) => !fittings(r.key))).toEqual([
      { key: 'rainwater', label: 'Regenwasserleitung', unit: 'm', quantity: 12.5 },
      { key: 'lawn', label: 'Rasenfläche', unit: 'm²', quantity: 42 },
      { key: 'lawn:mowingEdge', label: 'Mähkante', unit: 'm', quantity: 28 },
      { key: 'parking', label: 'Parkplatz', unit: 'm²', quantity: 50 },
      { key: 'parking:spaces', label: 'Stellplätze', unit: 'Stk', quantity: 2 },
      { key: 'gate', label: 'Tor', unit: 'Stk', quantity: 1 },
      { key: 'gate:width', label: 'Tor (Breite gesamt)', unit: 'm', quantity: 3.5 },
      { key: 'downpipe', label: 'Fallrohr', unit: 'Stk', quantity: 2 },
      { key: 'pictogram:tree', label: 'Baum', unit: 'Stk', quantity: 1 },
    ]);
  });

  it('Schlüssel der Mengenzeilen', () => {
    for (const key of [
      'lawn',
      'lawn:mowingEdge',
      'parking:spaces',
      'gate',
      'gate:width',
      'pictogram:tree',
      'gully',
    ])
      expect(isQuantityKey(key)).toBe(true);
    for (const key of [
      'text',
      'pictogram',
      'pictogram:ufo',
      'fence:width',
      'lawn:x',
      'constructor',
      'lawn:mowingEdge:x',
    ])
      expect(isQuantityKey(key)).toBe(false);
  });

  it('Leitungen je Nennweite; Tiefe und DN geprüft', () => {
    const rows = planQuantities(
      [
        obj({
          type: 'rainwater',
          points: [
            [0, 0],
            [500, 0],
          ],
          props: { dn: 110, depth: 0.8 },
        }),
        obj({
          type: 'rainwater',
          points: [
            [0, 0],
            [250, 0],
          ],
          props: { dn: 110 },
        }),
        obj({
          type: 'rainwater',
          points: [
            [0, 0],
            [100, 0],
          ],
          props: { dn: 160 },
        }),
        obj({
          type: 'rainwater',
          points: [
            [0, 0],
            [50, 0],
          ],
        }),
        obj({
          type: 'cable',
          points: [
            [0, 0],
            [100, 0],
          ],
          props: { depth: 0.6 },
        }),
      ],
      50,
    );
    expect(rows.filter((r) => !/:(bogen|abzweig|anschluss)/.test(r.key))).toEqual([
      { key: 'rainwater:dn110', label: 'Regenwasserleitung DN 110', unit: 'm', quantity: 15 },
      { key: 'rainwater:dn160', label: 'Regenwasserleitung DN 160', unit: 'm', quantity: 2 },
      { key: 'rainwater', label: 'Regenwasserleitung', unit: 'm', quantity: 1 },
      { key: 'cable', label: 'Erdkabel', unit: 'm', quantity: 2 },
    ]);
    const line = (props: object, type = 'rainwater') => [
      {
        id: 'a',
        type,
        points: [
          [0, 0],
          [1, 1],
        ],
        props,
      },
    ];
    expect(validateObjects(line({ dn: 110, depth: 0.8 }))).toBeNull();
    expect(validateObjects(line({ dn: 5 }))).toMatch(/Nennweite/);
    expect(validateObjects(line({ dn: 110.5 }))).toMatch(/Nennweite/);
    expect(validateObjects(line({ dn: 110 }, 'cable'))).toMatch(/keine Nennweite/);
    expect(validateObjects(line({ depth: -1 }))).toMatch(/Verlegetiefe/);
    expect(
      validateObjects([
        {
          id: 'a',
          type: 'lawn',
          points: [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
          props: { depth: 1 },
        },
      ]),
    ).toMatch(/keine Verlegetiefe/);
  });

  it('Fixierung: ganzes Objekt oder einzelne Punkte', () => {
    const rect = [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ];
    expect(
      validateObjects([{ id: 'a', type: 'lawn', points: rect, props: { locked: true, fixed: [0, 1] } }]),
    ).toBeNull();
    expect(validateObjects([{ id: 'a', type: 'lawn', points: rect, props: { fixed: [0, 4] } }])).toMatch(
      /fixierte Punkte/,
    );
    expect(validateObjects([{ id: 'a', type: 'lawn', points: rect, props: { fixed: [1, 1] } }])).toMatch(
      /fixierte Punkte/,
    );
    expect(validateObjects([{ id: 'a', type: 'lawn', points: rect, props: { locked: 'ja' } }])).toMatch(
      /Fixierung/,
    );
  });

  it('prüft Objekte', () => {
    expect(
      validateObjects([
        obj({
          type: 'fence',
          points: [
            [0, 0],
            [1, 1],
          ],
        }),
      ]),
    ).toBeNull();
    expect(validateObjects('x')).toMatch(/fehlen/);
    expect(validateObjects([{ id: 'a', type: 'pool', points: [[0, 0]] }])).toMatch(/Unbekannte Objektart/);
    expect(validateObjects([{ id: 'a', type: 'constructor', points: [[0, 0]] }])).toMatch(
      /Unbekannte Objektart/,
    );
    expect(
      validateObjects([{ id: 'a', type: 'pictogram', points: [[0, 0]], props: { icon: 'toString' } }]),
    ).toMatch(/Piktogramm/);
    expect(
      validateObjects([
        {
          id: 'a',
          type: 'lawn',
          points: [
            [0, 0],
            [1, 1],
          ],
        },
      ]),
    ).toMatch(/Punkte/);
    expect(
      validateObjects([
        {
          id: 'a',
          type: 'gate',
          points: [
            [0, 0],
            [1, 1],
            [2, 2],
          ],
        },
      ]),
    ).toMatch(/Punkte/);
    expect(validateObjects([{ id: 'a', type: 'gully', points: [[0, Infinity]] }])).toMatch(/Koordinaten/);
    expect(validateObjects([{ id: 'a', type: 'text', points: [[0, 0]], label: ' ' }])).toMatch(/ohne Text/);
    expect(
      validateObjects([{ id: 'a', type: 'pictogram', points: [[0, 0]], props: { icon: 'ufo' } }]),
    ).toMatch(/Piktogramm/);
    expect(
      validateObjects([
        {
          id: 'a',
          type: 'lawn',
          points: [
            [0, 0],
            [1, 0],
            [1, 1],
          ],
          props: { color: 'red' },
        },
      ]),
    ).toMatch(/Eigenschaft/);
    const same = obj({ id: 'x', type: 'gully', points: [[0, 0]] });
    expect(validateObjects([same, same])).toMatch(/ID/);
  });

  it('Bildgröße aus PNG- und JPEG-Kopf', () => {
    const png = Buffer.alloc(24);
    png.writeUInt32BE(0x89504e47, 0);
    png.write('IHDR', 12, 'ascii');
    png.writeUInt32BE(1920, 16);
    png.writeUInt32BE(1080, 20);
    expect(imageSize(png)).toEqual({ width: 1920, height: 1080, type: 'png' });
    // JPEG: SOI, APP0 (Länge 16), SOF0 mit Höhe 600, Breite 800
    const jpeg = Buffer.from([
      0xff,
      0xd8,
      0xff,
      0xe0,
      0x00,
      0x10,
      ...Array(14).fill(0),
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      0x02,
      0x58,
      0x03,
      0x20,
      0x03,
    ]);
    expect(imageSize(jpeg)).toEqual({ width: 800, height: 600, type: 'jpeg' });
    expect(imageSize(Buffer.from('kein bild'))).toBeNull();
    // Handyfoto hochkant: Exif-Ausrichtung 6 (90° gedreht) -> Breite/Höhe getauscht
    const tiff = Buffer.from([
      0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, 0x00, 0x01, 0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00,
      0x01, 0x00, 0x06, 0x00, 0x00, 0x00, 0x00,
    ]);
    const app1 = Buffer.concat([
      Buffer.from([0xff, 0xe1, 0x00, 2 + 6 + tiff.length]),
      Buffer.from('Exif\0\0', 'binary'),
      tiff,
    ]);
    const sof = Buffer.from([
      0xff,
      0xc0,
      0x00,
      0x11,
      0x08,
      0x0b,
      0xb8,
      0x0f,
      0xa0,
      0x03,
      ...Array(10).fill(0),
    ]);
    expect(imageSize(Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof]))).toEqual({
      width: 3000,
      height: 4000,
      type: 'jpeg',
    });
  });
});

describe('Lageplan: Rundungen und Kreise', () => {
  const upm = 50;
  const qty = (objects: PlanObject[]) =>
    Object.fromEntries(planQuantities(objects, upm).map((r) => [r.key, r.quantity]));
  // 10 m x 6 m (Plan-Einheiten)
  const rect: [number, number][] = [
    [0, 0],
    [500, 0],
    [500, 300],
    [0, 300],
  ];

  it('Kreis: exakte Fläche und Umfang aus dem Durchmesser', () => {
    const q = qty([
      obj({
        type: 'lawn',
        points: [
          [100, 100],
          [200, 100],
        ],
        props: { shape: 'circle', mowingEdge: true },
      }),
    ]);
    // r = 2 m
    expect(q.lawn).toBe(12.57);
    expect(q['lawn:mowingEdge']).toBe(12.57);
  });

  it('Rechteck mit abgerundeten Ecken (Außenrundung)', () => {
    const r = 1;
    const q = qty([
      obj({ type: 'paving', points: rect, props: { radii: [r, r, r, r] } }),
      obj({ type: 'lawn', points: rect, props: { radii: [r, r, r, r], mowingEdge: true } }),
    ]);
    expect(q.paving).toBeCloseTo(60 - (4 - Math.PI) * r * r, 2);
    expect(q['lawn:mowingEdge']).toBeCloseTo(32 - 8 * r + 2 * Math.PI * r, 2);
  });

  it('einspringende Ecke erhält eine Innenrundung (Fläche wächst)', () => {
    // L-Form: Innenecke bei (250, 150)
    const l: [number, number][] = [
      [0, 0],
      [500, 0],
      [500, 150],
      [250, 150],
      [250, 300],
      [0, 300],
    ];
    const sharp = qty([obj({ type: 'paving', points: l })]).paving;
    const round = qty([obj({ type: 'paving', points: l, props: { radii: [0, 0, 0, 1, 0, 0] } })]).paving;
    expect(sharp).toBe(45);
    expect(round).toBeCloseTo(45 + (1 - Math.PI / 4), 2);
  });

  it('Radius wird auf die halbe Kantenlänge begrenzt', () => {
    // 2 m x 2 m mit Radius 5 m -> Kreis mit r = 1 m
    const q = qty([
      obj({
        type: 'paving',
        points: [
          [0, 0],
          [100, 0],
          [100, 100],
          [0, 100],
        ],
        props: { radii: [5, 5, 5, 5] },
      }),
    ]);
    expect(q.paving).toBeCloseTo(Math.PI, 2);
  });

  it('Kante als Bogen nach außen und nach innen', () => {
    // Halbkreis (r = 5 m) auf der unteren Kante des 10 x 6 m Rechtecks
    const outward = qty([obj({ type: 'paving', points: rect, props: { bulges: [0, 0, 5, 0] } })]).paving;
    const inward = qty([obj({ type: 'paving', points: rect, props: { bulges: [0, 0, -5, 0] } })]).paving;
    const half = (Math.PI * 25) / 2;
    expect(outward).toBeCloseTo(60 + half, 1);
    expect(Math.abs(60 - half - inward)).toBeLessThan(0.05);
    // gleiche Wirkung bei umgekehrtem Umlaufsinn
    const reversed = [...rect].reverse() as [number, number][];
    const rev = qty([obj({ type: 'paving', points: reversed, props: { bulges: [5, 0, 0, 0] } })]).paving;
    expect(rev).toBeCloseTo(outward, 2);
  });

  it('Leitung mit Bogen und abgerundetem Knick', () => {
    const q = qty([
      // Viertelkreis-Bogen mit r = 2 m zwischen (0,0) und (2,2) m
      obj({
        type: 'rainwater',
        points: [
          [0, 0],
          [100, 100],
        ],
        props: { bulges: [2] },
      }),
      // rechter Winkel 4 m + 4 m, Knick mit r = 1 m
      obj({
        type: 'cable',
        points: [
          [0, 0],
          [200, 0],
          [200, 200],
        ],
        props: { radii: [0, 1, 0] },
      }),
    ]);
    expect(q.rainwater).toBeCloseTo(Math.PI, 2);
    expect(q.cable).toBeCloseTo(8 - 2 + Math.PI / 2, 2);
  });

  it('Schächte: gezählt je Durchmesser', () => {
    const shaft = (rim: number): PlanObject =>
      obj({
        type: 'manhole',
        points: [
          [0, 0],
          [rim, 0],
        ],
        props: { shape: 'circle' },
      });
    const rows = planQuantities(
      [shaft(25), shaft(25), shaft(50), obj({ type: 'manhole', points: rect })],
      upm,
    );
    expect(rows).toEqual(
      expect.arrayContaining([
        { key: 'manhole:d100', label: 'Schacht Ø 1,00 m', unit: 'Stk', quantity: 2 },
        { key: 'manhole:d200', label: 'Schacht Ø 2,00 m', unit: 'Stk', quantity: 1 },
        { key: 'manhole', label: 'Schacht', unit: 'Stk', quantity: 1 },
      ]),
    );
    expect(isQuantityKey('manhole:d100')).toBe(true);
    expect(isQuantityKey('manhole:d0')).toBe(false);
    expect(isQuantityKey('manhole:x')).toBe(false);
  });

  it('Validierung von Form, Radien und Bögen', () => {
    const v = (o: Partial<PlanObject> & Pick<PlanObject, 'type' | 'points'>) => validateObjects([obj(o)]);
    const two: [number, number][] = [
      [0, 0],
      [10, 0],
    ];
    expect(v({ type: 'manhole', points: two, props: { shape: 'circle' } })).toBeNull();
    expect(v({ type: 'lawn', points: two })).toMatch(/Anzahl Punkte/);
    expect(
      v({
        type: 'manhole',
        points: [
          [5, 5],
          [5, 5],
        ],
        props: { shape: 'circle' },
      }),
    ).toMatch(/Durchmesser/);
    expect(v({ type: 'lawn', points: rect, props: { shape: 'circle' } })).toMatch(/Anzahl Punkte/);
    expect(v({ type: 'cable', points: two, props: { shape: 'circle' } })).toMatch(/Form/);
    expect(v({ type: 'lawn', points: rect, props: { radii: [1, 1, 1] } })).toMatch(/Eckradien/);
    expect(v({ type: 'lawn', points: rect, props: { radii: [1, -1, 1, 1] } })).toMatch(/Eckradien/);
    expect(v({ type: 'lawn', points: rect, props: { bulges: [0, 0, 0] } })).toMatch(/Bögen/);
    expect(v({ type: 'cable', points: two, props: { bulges: [3] } })).toBeNull();
    expect(v({ type: 'cable', points: two, props: { bulges: [3, 0] } })).toMatch(/Bögen/);
    expect(v({ type: 'gate', points: two, props: { radii: [0, 0] } })).toMatch(/Eckradien/);
    expect(
      v({ type: 'manhole', points: two, props: { shape: 'circle', radii: [1, 1] } as PlanObject['props'] }),
    ).toMatch(/Eckradien/);
  });
});

describe('Lageplan: Umriss im Frontend', () => {
  it('ist dieselbe Datei wie im Backend (bis auf den Kopfkommentar)', () => {
    const body = (path: string) => readFileSync(path, 'utf8').split('\n').slice(2).join('\n');
    expect(body(`${__dirname}/../../frontend/src/pages/plans/outline.ts`)).toBe(
      body(`${__dirname}/../src/plans/outline.ts`),
    );
  });

  it('Formstücke: dieselbe Rechnung wie im Frontend (bis auf die Importe)', () => {
    const body = (path: string) =>
      readFileSync(path, 'utf8')
        .split('\n')
        .filter((line) => !/^import |^  [A-Za-z_ ]+,$|^} from /.test(line))
        .join('\n');
    expect(body(`${__dirname}/../../frontend/src/pages/plans/fittings.ts`)).toBe(
      body(`${__dirname}/../src/plans/plan-fittings.ts`),
    );
  });
});
