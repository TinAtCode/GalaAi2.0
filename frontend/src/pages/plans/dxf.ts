import { ObjectType, PlanObject, TYPES } from './catalog';
import { Point } from './geometry';

// DXF-Import (ASCII-DXF aus CAD, z. B. Vermessung oder Architektenplan):
// Linien, Polylinien (mit Bögen), Kreise, Bögen, Punkte und Texte aus dem
// ENTITIES-Abschnitt. Je CAD-Layer wählt man die Objektart im Plan.
// DXF rechnet mit y nach oben – der Plan mit y nach unten, daher gespiegelt.

export interface DxfEntity {
  kind: 'polyline' | 'circle' | 'point' | 'text';
  layer: string;
  points: Point[]; // DXF-Koordinaten (Zeichnungseinheiten)
  closed?: boolean;
  bulges?: number[]; // DXF-Bulge je Segment (tan(Winkel/4), + = gegen den Uhrzeigersinn)
  radius?: number;
  text?: string;
}

export interface DxfDrawing {
  entities: DxfEntity[];
  // Einheit laut Kopf ($INSUNITS): Meter je Zeichnungseinheit, null = unbekannt
  metersPerUnit: number | null;
  skipped: number; // nicht unterstützte Elemente (z. B. Blöcke, Schraffuren)
}

// $INSUNITS: 1 Zoll, 2 Fuß, 4 mm, 5 cm, 6 m, 14 dm
const UNIT_METERS: Record<number, number> = { 1: 0.0254, 2: 0.3048, 4: 0.001, 5: 0.01, 6: 1, 14: 0.1 };

type Pair = [number, string];

function pairs(text: string): Pair[] {
  const lines = text.split(/\r?\n/);
  const list: Pair[] = [];
  for (let i = 0; i + 1 < lines.length; i += 2) {
    const code = Number(lines[i].trim());
    if (!Number.isInteger(code)) throw new Error('Die Datei ist keine DXF-Datei im Textformat.');
    list.push([code, lines[i + 1].replace(/\s+$/, '')]);
  }
  return list;
}

// MTEXT-Formatierungen (\P Absatz, {\f…;} Schrift) entfernen
const plainText = (s: string) =>
  s
    .replace(/\\P/gi, ' ')
    .replace(/\\[A-Za-z][^;\\{}]*;/g, '')
    .replace(/[{}]/g, '')
    .replace(/%%[cdp]/gi, (m) => ({ '%%c': 'Ø', '%%d': '°', '%%p': '±' })[m.toLowerCase()] ?? '')
    .trim();

export function parseDxf(text: string): DxfDrawing {
  const list = pairs(text);
  let metersPerUnit: number | null = null;
  const insunits = list.findIndex(([c, v]) => c === 9 && v.trim() === '$INSUNITS');
  if (insunits >= 0 && list[insunits + 1]?.[0] === 70) {
    metersPerUnit = UNIT_METERS[Number(list[insunits + 1][1])] ?? null;
  }

  const start = list.findIndex(([c, v], i) => c === 0 && v === 'SECTION' && list[i + 1]?.[1] === 'ENTITIES');
  if (start < 0) throw new Error('In der DXF-Datei wurde kein ENTITIES-Abschnitt gefunden.');
  const entities: DxfEntity[] = [];
  let skipped = 0;

  // Elemente nacheinander: jedes beginnt mit Code 0
  let i = start + 2;
  const next = () => {
    const group: Pair[] = [];
    i++;
    while (i < list.length && list[i][0] !== 0) group.push(list[i++]);
    return group;
  };
  const num = (group: Pair[], code: number, fallback = 0) => {
    const found = group.find(([c]) => c === code);
    return found ? Number(found[1]) : fallback;
  };
  const str = (group: Pair[], code: number) => group.find(([c]) => c === code)?.[1] ?? '';

  while (i < list.length) {
    const [, type] = list[i];
    if (type === 'ENDSEC' || type === 'EOF') break;
    const group = next();
    const layer = str(group, 8) || '0';
    switch (type) {
      case 'LINE':
        entities.push({
          kind: 'polyline',
          layer,
          points: [
            [num(group, 10), num(group, 20)],
            [num(group, 11), num(group, 21)],
          ],
          bulges: [0],
        });
        break;
      case 'LWPOLYLINE': {
        // Punkte 10/20, Bulge 42 gehört zum vorher genannten Punkt
        const points: Point[] = [];
        const bulges: number[] = [];
        for (const [code, value] of group) {
          if (code === 10) {
            points.push([Number(value), 0]);
            bulges.push(0);
          } else if (code === 20 && points.length) points[points.length - 1][1] = Number(value);
          else if (code === 42 && bulges.length) bulges[bulges.length - 1] = Number(value);
        }
        const closed = (num(group, 70) & 1) === 1;
        if (points.length >= 2) entities.push({ kind: 'polyline', layer, points, bulges, closed });
        break;
      }
      case 'POLYLINE': {
        // alte Polylinie: VERTEX-Elemente bis SEQEND
        const closed = (num(group, 70) & 1) === 1;
        const is3dMesh = (num(group, 70) & (16 | 64)) !== 0;
        const points: Point[] = [];
        const bulges: number[] = [];
        while (i < list.length && list[i][1] === 'VERTEX') {
          const vertex = next();
          points.push([num(vertex, 10), num(vertex, 20)]);
          bulges.push(num(vertex, 42));
        }
        if (i < list.length && list[i][1] === 'SEQEND') next();
        if (is3dMesh) skipped++;
        else if (points.length >= 2) entities.push({ kind: 'polyline', layer, points, bulges, closed });
        break;
      }
      case 'CIRCLE':
        entities.push({
          kind: 'circle',
          layer,
          points: [[num(group, 10), num(group, 20)]],
          radius: num(group, 40),
        });
        break;
      case 'ARC': {
        // Bogen gegen den Uhrzeigersinn von Start- zu Endwinkel (Grad)
        const [cx, cy, r] = [num(group, 10), num(group, 20), num(group, 40)];
        const a0 = (num(group, 50) * Math.PI) / 180;
        let a1 = (num(group, 51) * Math.PI) / 180;
        while (a1 <= a0) a1 += 2 * Math.PI;
        const at = (a: number): Point => [cx + r * Math.cos(a), cy + r * Math.sin(a)];
        // über 180° in zwei Teilbögen (ein Bogen im Plan ist höchstens ein Halbkreis)
        const parts = a1 - a0 > Math.PI - 1e-9 ? 2 : 1;
        const step = (a1 - a0) / parts;
        const points = Array.from({ length: parts + 1 }, (_, k) => at(a0 + k * step));
        const bulge = Math.tan(step / 4);
        entities.push({ kind: 'polyline', layer, points, bulges: points.map(() => bulge) });
        break;
      }
      case 'POINT':
        entities.push({ kind: 'point', layer, points: [[num(group, 10), num(group, 20)]] });
        break;
      case 'TEXT':
      case 'MTEXT': {
        const content = plainText(
          type === 'MTEXT'
            ? group
                .filter(([c]) => c === 3 || c === 1)
                .map(([, v]) => v)
                .join('')
            : str(group, 1),
        );
        if (content)
          entities.push({ kind: 'text', layer, points: [[num(group, 10), num(group, 20)]], text: content });
        break;
      }
      default:
        skipped++;
    }
  }
  return { entities, metersPerUnit, skipped };
}

// Objektart je Layer aus dem Namen erraten (übliche deutsche Layernamen)
const GUESSES: [RegExp, ObjectType][] = [
  [/schacht|kontroll/i, 'manhole'],
  [/rinne/i, 'drain_channel'],
  [/regen|\brw\b|_rw|rw_|dach/i, 'rainwater'],
  [/schmutz|abwasser|\bsw\b|_sw|sw_|kanal/i, 'wastewater'],
  [/kabel|elektr|strom|\belt?\b/i, 'cable'],
  [/zaun|einfried/i, 'fence'],
  [/tor\b|tore/i, 'gate'],
  [/rasen|gruen|grün|wiese/i, 'lawn'],
  [/pflaster|weg|terrasse|belag|platte/i, 'paving'],
  [/park|stellpl/i, 'parking'],
  [/beet|pflanz|hecke|gehoelz|gehölz/i, 'planting'],
  [/baum|bäume|baeume/i, 'pictogram'],
  [/text|beschrift|schrift/i, 'text'],
];

export function guessType(layer: string, kinds: DxfEntity['kind'][]): ObjectType | null {
  for (const [pattern, type] of GUESSES) if (pattern.test(layer)) return type;
  if (kinds.every((k) => k === 'text')) return 'text';
  return null;
}

const signedArea = (points: Point[]) =>
  points.reduce((sum, p, k) => {
    const q = points[(k + 1) % points.length];
    return sum + p[0] * q[1] - q[0] * p[1];
  }, 0) / 2;

export interface ImportOptions {
  metersPerUnit: number;
  unitsPerMeter: number; // Planeinheiten je Meter
  types: Record<string, ObjectType | null>; // je Layer, null = auslassen
  newId: () => string;
}

const MAX_POINTS = 500;
const round = (v: number) => Math.round(v * 100) / 100;

// DXF-Elemente in Planobjekte umrechnen: Meter -> Planeinheiten, y gespiegelt,
// linke obere Ecke der Zeichnung mit 2 m Rand
export function toPlanObjects(
  drawing: DxfDrawing,
  options: ImportOptions,
): { objects: PlanObject[]; dropped: number } {
  const chosen = drawing.entities.filter((e) => options.types[e.layer]);
  const all = chosen.flatMap((e) => e.points);
  if (!all.length) return { objects: [], dropped: 0 };
  const scale = options.metersPerUnit * options.unitsPerMeter;
  const minX = Math.min(...all.map((p) => p[0]));
  const maxY = Math.max(...all.map((p) => p[1]));
  const margin = 2 * options.unitsPerMeter;
  const map = ([x, y]: Point): Point => [
    round((x - minX) * scale + margin),
    round((maxY - y) * scale + margin),
  ];
  const toMeters = (units: number) => units / options.unitsPerMeter;

  const objects: PlanObject[] = [];
  let dropped = 0;
  for (const entity of chosen) {
    const type = options.types[entity.layer]!;
    const kind = TYPES[type].kind;
    const base = { id: options.newId(), type };

    if (entity.kind === 'text') {
      if (kind === 'text')
        objects.push({ ...base, points: [map(entity.points[0])], label: entity.text!.slice(0, 200) });
      else dropped++;
      continue;
    }
    if (entity.kind === 'point') {
      if (kind === 'symbol')
        objects.push({
          ...base,
          points: [map(entity.points[0])],
          ...(type === 'pictogram' ? { props: { icon: 'tree' } } : {}),
        });
      else dropped++;
      continue;
    }
    if (entity.kind === 'circle') {
      const c = map(entity.points[0]);
      const r = entity.radius! * scale;
      if (kind === 'area')
        objects.push({ ...base, points: [c, [round(c[0] + r), c[1]]], props: { shape: 'circle' } });
      else if (kind === 'symbol')
        objects.push({ ...base, points: [c], ...(type === 'pictogram' ? { props: { icon: 'tree' } } : {}) });
      else if (kind === 'line') {
        // Kreis als Linie: zwei Halbkreise
        const m = round(toMeters(r) * 100) / 100;
        objects.push({
          ...base,
          points: [
            [round(c[0] - r), c[1]],
            [round(c[0] + r), c[1]],
            [round(c[0] - r), c[1]],
          ],
          props: { bulges: [m, m] },
        });
      } else dropped++;
      continue;
    }

    // Polylinie
    const points = entity.points.map(map);
    const closed =
      !!entity.closed || (points.length > 2 && distance(points[0], points[points.length - 1]) < 1e-6);
    if (closed && distance(points[0], points[points.length - 1]) < 1e-6) points.pop();
    if (points.length > MAX_POINTS || (kind === 'area' && points.length < 3) || points.length < 2) {
      dropped++;
      continue;
    }
    if (kind === 'text' || kind === 'symbol') {
      dropped++;
      continue;
    }
    if (kind === 'opening') {
      objects.push({ ...base, points: [points[0], points[points.length - 1]] });
      continue;
    }
    const asArea = kind === 'area';
    // offene Linie als Fläche: nur wenn sie sich schließt; geschlossene als Linie: erster Punkt am Ende
    if (asArea && !closed) {
      dropped++;
      continue;
    }
    const linePoints = !asArea && closed ? [...points, points[0]] : points;
    const segmentCount = asArea ? linePoints.length : linePoints.length - 1;
    const orientation = signedArea(linePoints) < 0 ? -1 : 1;
    const bulges = Array.from({ length: segmentCount }, (_, k) => {
      const b = entity.bulges?.[k % entity.points.length] ?? 0;
      if (!b) return 0;
      const a = linePoints[k];
      const e = linePoints[(k + 1) % linePoints.length];
      const chord = distance(a, e);
      if (chord < 1e-9) return 0;
      // + Bulge: Bogen rechts der Fahrtrichtung (DXF, y oben). Gespiegelt in den
      // Plan (y unten) ist das die Seite (-dy, dx) der Planrichtung (dx, dy).
      const theta = 4 * Math.atan(Math.abs(b));
      const radius = chord / (2 * Math.sin(theta / 2));
      const [dx, dy] = [(e[0] - a[0]) / chord, (e[1] - a[1]) / chord];
      const side: Point = b > 0 ? [-dy, dx] : [dy, -dx];
      // Vorzeichen im Plan wie in outline.ts: + = außen (Fläche) bzw. links (Linie)
      const outward: Point = asArea ? [dy * orientation, -dx * orientation] : [-dy, dx];
      const sign = side[0] * outward[0] + side[1] * outward[1] > 0 ? 1 : -1;
      return round(toMeters(radius) * sign);
    });
    const props = bulges.some((b) => b !== 0) ? { bulges } : undefined;
    objects.push({ ...base, points: linePoints, ...(props ? { props } : {}) });
  }
  return { objects, dropped };
}

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);
