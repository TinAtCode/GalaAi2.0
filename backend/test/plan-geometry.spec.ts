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
    expect(rows).toEqual([
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
    expect(rows).toEqual([
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
