import {
  DEFAULT_PIPE_DEPTH,
  FITTING_TYPES,
  PlanObject,
  TYPES as PLAN_OBJECT_TYPES,
  ObjectType as PlanObjectType,
} from './catalog';

// Formstücke und Zusatzlängen der Entwässerung aus der Zeichnung – gleiche
// Rechnung im Frontend (frontend/src/pages/plans/fittings.ts):
// - Bögen an jeder Ecke einer Leitung, auf Normwinkel gerundet (15°, 30°,
//   45°, 87°; stärkere Knicke als mehrere Bögen)
// - Anschluss an der Oberfläche (Fallrohr, Gully): senkrechtes Anschlussrohr
//   von der Oberfläche bis zur Leitung, ein 87°-Bogen und – liegt der
//   Anschluss nicht am Leitungsende – ein Abzweig in der Leitung
// - endet eine Leitung auf einer anderen: Abzweig in der durchgehenden Leitung
// - Schacht: Schachttiefe von der Oberfläche bis zur tiefsten Leitung
// Höhen: Flächen props.height (Standard 0), Leitungen props.depth unter 0
// (Standard 0,50 m). Toleranz für „liegt auf der Leitung“: 0,5 m.
export interface FittingRow {
  key: string;
  label: string;
  unit: 'm' | 'Stk';
  quantity: number;
}

type Point = [number, number];
const STANDARD_BENDS = [15, 30, 45, 87];
const TOLERANCE_M = 0.5;

const dist = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

function distanceToSegment(p: Point, a: Point, b: Point) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const l2 = dx * dx + dy * dy;
  const t = l2 ? Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2)) : 0;
  return dist(p, [a[0] + t * dx, a[1] + t * dy]);
}

const distanceToLine = (p: Point, points: Point[]) =>
  points.slice(1).reduce((min, b, i) => Math.min(min, distanceToSegment(p, points[i], b)), Infinity);

function insidePolygon(p: Point, poly: Point[]) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i];
    const [xj, yj] = poly[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function insideArea(p: Point, area: PlanObject) {
  if (area.props?.shape === 'circle') return dist(p, area.points[0]) <= dist(area.points[0], area.points[1]);
  return insidePolygon(p, area.points);
}

// Richtungsänderung an Punkt i in Grad (0 = gerade weiter)
function turnAngle(a: Point, b: Point, c: Point) {
  const u = [b[0] - a[0], b[1] - a[1]];
  const v = [c[0] - b[0], c[1] - b[1]];
  const lu = Math.hypot(u[0], u[1]);
  const lv = Math.hypot(v[0], v[1]);
  if (!lu || !lv) return 0;
  const cos = Math.max(-1, Math.min(1, (u[0] * v[0] + u[1] * v[1]) / (lu * lv)));
  return (Math.acos(cos) * 180) / Math.PI;
}

// Knick in Normbögen zerlegen: 90° -> 87°, 120° -> 87° + 30°
export function bendsFor(angle: number): number[] {
  const bends: number[] = [];
  let rest = angle;
  while (rest > 93.5) {
    bends.push(87);
    rest -= 87;
  }
  if (rest >= 7.5) {
    bends.push(STANDARD_BENDS.reduce((best, b) => (Math.abs(b - rest) < Math.abs(best - rest) ? b : best)));
  }
  return bends;
}

export function pipeFittings(objects: PlanObject[], unitsPerMeter: number): FittingRow[] {
  const rows = new Map<string, FittingRow>();
  const add = (key: string, label: string, unit: FittingRow['unit'], quantity: number) => {
    if (quantity <= 0) return;
    const row = rows.get(key) ?? { key, label, unit, quantity: 0 };
    row.quantity += quantity;
    rows.set(key, row);
  };
  const tol = TOLERANCE_M * unitsPerMeter;
  const pipes = objects.filter((o) => FITTING_TYPES.includes(o.type) && o.points.length >= 2);
  const areas = objects.filter((o) => PLAN_OBJECT_TYPES[o.type].kind === 'area' && o.type !== 'manhole');
  const depthOf = (pipe: PlanObject) => pipe.props?.depth ?? DEFAULT_PIPE_DEPTH;
  // Oberfläche an einem Punkt: höchste Fläche mit Höhenangabe, sonst 0
  const surfaceAt = (p: Point) =>
    areas
      .filter((a) => a.props?.height !== undefined && insideArea(p, a))
      .reduce<number | null>((max, a) => Math.max(max ?? -Infinity, a.props!.height!), null) ?? 0;
  const fitting = (pipe: PlanObject, extra: string, label: string, unit: FittingRow['unit'], q: number) => {
    const dn = pipe.props?.dn;
    const type = PLAN_OBJECT_TYPES[pipe.type].label;
    add(`${pipe.type}:${extra}${dn ? `-dn${dn}` : ''}`, `${type}: ${label}${dn ? ` DN ${dn}` : ''}`, unit, q);
  };
  const onEnd = (p: Point, pipe: PlanObject) =>
    dist(p, pipe.points[0]) <= tol || dist(p, pipe.points[pipe.points.length - 1]) <= tol;
  // nächste Leitung am Punkt (innerhalb der Toleranz)
  const pipeAt = (p: Point, except?: PlanObject) =>
    pipes
      .filter((pipe) => pipe !== except)
      .map((pipe) => ({ pipe, d: distanceToLine(p, pipe.points) }))
      .filter((x) => x.d <= tol)
      .sort((a, b) => a.d - b.d)[0]?.pipe;

  for (const pipe of pipes) {
    const pts = pipe.points;
    for (let i = 1; i < pts.length - 1; i++) {
      for (const bend of bendsFor(turnAngle(pts[i - 1], pts[i], pts[i + 1]))) {
        fitting(pipe, `bogen${bend}`, `Bogen ${bend}°`, 'Stk', 1);
      }
    }
    // Leitung endet auf einer anderen: Abzweig in der durchgehenden
    for (const end of [pts[0], pts[pts.length - 1]]) {
      const main = pipeAt(end, pipe);
      if (main && !onEnd(end, main)) fitting(main, 'abzweig', 'Abzweig', 'Stk', 1);
    }
  }

  for (const o of objects) {
    if (o.type !== 'downpipe' && o.type !== 'gully') continue;
    const p = o.points[0];
    const pipe = pipeAt(p);
    if (!pipe) continue;
    const rise = Math.max(0, depthOf(pipe) + surfaceAt(p));
    fitting(pipe, 'anschluss', 'Anschlussrohr senkrecht', 'm', rise);
    fitting(pipe, 'bogen87', 'Bogen 87°', 'Stk', 1);
    if (!onEnd(p, pipe)) fitting(pipe, 'abzweig', 'Abzweig', 'Stk', 1);
  }

  for (const shaft of objects.filter((o) => o.type === 'manhole')) {
    const touching = pipes.filter((pipe) =>
      pipe.points.some((p) => insideArea(p, shaft) || distanceToLine(p, shaft.points) <= tol),
    );
    if (!touching.length) continue;
    const top = shaft.props?.height ?? surfaceAt(shaft.points[0]);
    const deepest = Math.max(...touching.map(depthOf));
    add('manhole:tiefe', 'Schacht: Tiefe gesamt', 'm', Math.max(0, deepest + top));
  }
  return [...rows.values()];
}

// Schlüssel der Formstück-Zeilen (für die Leistungs-Zuordnung)
export function isFittingKey(base: PlanObjectType, extra: string) {
  if (base === 'manhole') return extra === 'tiefe';
  if (!FITTING_TYPES.includes(base)) return false;
  return /^(bogen(15|30|45|87)|abzweig|anschluss)(-dn[1-9]\d{1,3})?$/.test(extra);
}
