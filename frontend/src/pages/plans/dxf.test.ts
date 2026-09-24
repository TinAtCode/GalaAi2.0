import { describe, expect, it } from 'vitest';
import { guessType, parseDxf, toPlanObjects } from './dxf';
import { outline } from './outline';
import { polygonArea, polylineLength } from './geometry';

// Minimales ASCII-DXF aus Gruppencode/Wert-Paaren
const dxf = (header: string[], entities: string[][]) =>
  [
    '0',
    'SECTION',
    '2',
    'HEADER',
    ...header,
    '0',
    'ENDSEC',
    '0',
    'SECTION',
    '2',
    'ENTITIES',
    ...entities.flat(),
    '0',
    'ENDSEC',
    '0',
    'EOF',
  ].join('\n');

const lw = (layer: string, points: [number, number, number?][], closed = false) => [
  '0',
  'LWPOLYLINE',
  '8',
  layer,
  '90',
  String(points.length),
  '70',
  closed ? '1' : '0',
  ...points.flatMap(([x, y, b]) => ['10', String(x), '20', String(y), ...(b ? ['42', String(b)] : [])]),
];

const UPM = 50;
let n = 0;
const convert = (
  text: string,
  types: Record<string, Parameters<typeof toPlanObjects>[1]['types'][string]>,
) => {
  const drawing = parseDxf(text);
  return toPlanObjects(drawing, {
    metersPerUnit: drawing.metersPerUnit ?? 1,
    unitsPerMeter: UPM,
    types,
    newId: () => `id${++n}`,
  });
};

describe('DXF-Import', () => {
  it('liest Einheiten, Layer und Elementarten', () => {
    const text = dxf(
      ['9', '$INSUNITS', '70', '4'],
      [
        ['0', 'LINE', '8', 'RW', '10', '0', '20', '0', '11', '1000', '21', '0'],
        ['0', 'CIRCLE', '8', 'Schacht', '10', '500', '20', '500', '40', '500'],
        ['0', 'TEXT', '8', 'Texte', '10', '0', '20', '0', '1', 'Garage'],
        ['0', 'MTEXT', '8', 'Texte', '10', '0', '20', '0', '1', '{\\fArial;Haus}\\PNr. 5'],
        ['0', 'HATCH', '8', 'X'],
      ],
    );
    const drawing = parseDxf(text);
    expect(drawing.metersPerUnit).toBe(0.001);
    expect(drawing.skipped).toBe(1);
    expect(drawing.entities.map((e) => [e.kind, e.layer])).toEqual([
      ['polyline', 'RW'],
      ['circle', 'Schacht'],
      ['text', 'Texte'],
      ['text', 'Texte'],
    ]);
    expect(drawing.entities[3].text).toBe('Haus Nr. 5');
    expect(() => parseDxf('kein dxf')).toThrow();
  });

  it('rechnet in Planeinheiten um und spiegelt y', () => {
    // 10 m × 4 m Rasen (in m), Leitung 10 m
    const text = dxf(
      ['9', '$INSUNITS', '70', '6'],
      [
        lw(
          'Rasen',
          [
            [0, 0],
            [10, 0],
            [10, 4],
            [0, 4],
          ],
          true,
        ),
        ['0', 'LINE', '8', 'RW-Leitung', '10', '0', '20', '4', '11', '10', '21', '4'],
      ],
    );
    const { objects } = convert(text, { Rasen: 'lawn', 'RW-Leitung': 'rainwater' });
    expect(objects).toHaveLength(2);
    const [lawn, pipe] = objects;
    expect(lawn.type).toBe('lawn');
    expect(polygonArea(lawn.points) / UPM ** 2).toBeCloseTo(40);
    // oberer Rand der Zeichnung (y = 4) liegt oben im Plan (2 m Rand)
    expect(pipe.points).toEqual([
      [100, 100],
      [600, 100],
    ]);
    expect(Math.min(...lawn.points.map((p) => p[1]))).toBe(100);
  });

  it('Bögen aus Polylinien liegen auf derselben Seite wie in der Zeichnung', () => {
    // Halbkreis unter der Strecke (DXF: + Bulge = rechts, bei Fahrt nach +x also unten)
    const text = dxf(
      ['9', '$INSUNITS', '70', '6'],
      [
        lw('RW', [
          [0, 0, 1],
          [2, 0],
        ]),
        lw('RW2', [
          [0, 0, -1],
          [2, 0],
        ]),
      ],
    );
    const { objects } = convert(text, { RW: 'rainwater', RW2: 'rainwater' });
    for (const [object, below] of [
      [objects[0], true],
      [objects[1], false],
    ] as const) {
      const ring = outline(object.points, false, object.props, UPM);
      expect(polylineLength(ring) / UPM).toBeCloseTo(Math.PI, 2);
      const y0 = object.points[0][1];
      const extreme = below ? Math.max(...ring.map((p) => p[1])) : Math.min(...ring.map((p) => p[1]));
      // unten in der Zeichnung = größeres y im Plan
      expect((extreme - y0) / UPM).toBeCloseTo(below ? 1 : -1, 2);
    }
  });

  it('Fläche mit Bogen: Fläche wie in der Zeichnung (auch gegen den Uhrzeigersinn)', () => {
    // Rechteck 4 × 2 m mit Halbkreis (r = 2 m) nach außen an der oberen Kante
    for (const ccw of [true, false]) {
      const pts: [number, number, number?][] = ccw
        ? [
            [0, 0],
            [4, 0],
            [4, 2, 1],
            [0, 2],
          ]
        : [
            [0, 0],
            [0, 2, -1],
            [4, 2],
            [4, 0],
          ];
      // gegen den Uhrzeigersinn: obere Kante von (4,2) nach (0,2), + Bulge = rechts = nach oben (außen)
      // im Uhrzeigersinn: von (0,2) nach (4,2) mit − Bulge = links = nach oben (außen)
      const { objects } = convert(dxf(['9', '$INSUNITS', '70', '6'], [lw('Pflaster', pts, true)]), {
        Pflaster: 'paving',
      });
      const ring = outline(objects[0].points, true, objects[0].props, UPM);
      expect(polygonArea(ring) / UPM ** 2).toBeCloseTo(8 + (Math.PI * 4) / 2, 1);
    }
  });

  it('Bogen (ARC) über 180° wird in zwei Teilbögen zerlegt', () => {
    const text = dxf(
      ['9', '$INSUNITS', '70', '6'],
      [['0', 'ARC', '8', 'Kabel', '10', '0', '20', '0', '40', '1', '50', '0', '51', '270']],
    );
    const { objects } = convert(text, { Kabel: 'cable' });
    expect(objects[0].points).toHaveLength(3);
    const ring = outline(objects[0].points, false, objects[0].props, UPM);
    expect(polylineLength(ring) / UPM).toBeCloseTo((3 * Math.PI) / 2, 2);
  });

  it('Kreise als Schacht, Symbole und Texte; ausgelassene Layer', () => {
    const text = dxf(
      ['9', '$INSUNITS', '70', '4'],
      [
        ['0', 'CIRCLE', '8', 'S', '10', '1000', '20', '1000', '40', '500'],
        ['0', 'POINT', '8', 'B', '10', '0', '20', '0'],
        ['0', 'TEXT', '8', 'T', '10', '0', '20', '0', '1', 'Garage'],
        ['0', 'LINE', '8', 'Hilfslinien', '10', '0', '20', '0', '11', '1', '21', '1'],
      ],
    );
    const { objects, dropped } = convert(text, {
      S: 'manhole',
      B: 'pictogram',
      T: 'text',
      Hilfslinien: null,
    });
    expect(dropped).toBe(0);
    expect(objects.map((o) => o.type)).toEqual(['manhole', 'pictogram', 'text']);
    expect(objects[0].props).toEqual({ shape: 'circle' });
    expect((objects[0].points[1][0] - objects[0].points[0][0]) / UPM).toBeCloseTo(0.5);
    expect(objects[2].label).toBe('Garage');
  });

  it('errät Objektarten aus Layernamen', () => {
    expect(guessType('RW_Leitung', ['polyline'])).toBe('rainwater');
    expect(guessType('Abwasser', ['polyline'])).toBe('wastewater');
    expect(guessType('Pflasterflaeche', ['polyline'])).toBe('paving');
    expect(guessType('Schacht DN1000', ['circle'])).toBe('manhole');
    expect(guessType('Layer1', ['text'])).toBe('text');
    expect(guessType('0', ['polyline'])).toBeNull();
  });
});
