// Umriss eines Objekts mit Rundungen – gleiche Datei im Backend unter
// backend/src/plans/outline.ts (dort für die Mengen).
// Radien und Bögen sind in Metern angegeben,
// die Punkte in Planeinheiten (upm = Planeinheiten je Meter).
//
// - radii[i]: Eckradius am Punkt i (0 = spitz). An einer nach außen zeigenden
//   Ecke ergibt das eine Außenrundung, an einer einspringenden eine
//   Innenrundung. Nur zwischen zwei geraden Kanten.
// - bulges[i]: Kante i (Punkt i -> i+1) als Kreisbogen mit diesem Radius;
//   positiv = nach außen gewölbt (bei Linien: nach links), negativ = nach
//   innen; 0 = gerade. Radius mindestens halbe Kantenlänge.
// - shape 'circle': Kreis aus Mittelpunkt (Punkt 0) und Randpunkt (Punkt 1).

export type Point = [number, number];
export interface ShapeProps {
  radii?: number[];
  bulges?: number[];
  shape?: 'circle';
}

const STEP = Math.PI / 180; // Feinheit der Bögen (1°)

const sub = (a: Point, b: Point): Point => [a[0] - b[0], a[1] - b[1]];
const len = (a: Point) => Math.hypot(a[0], a[1]);
const unit = (a: Point): Point => {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l] : [0, 0];
};

// Punkte auf dem Bogen um center von start nach end (ohne start, mit end);
// side: der Bogen soll in diese Richtung gewölbt sein (sonst der kürzere)
function arc(center: Point, start: Point, end: Point, side: Point | null): Point[] {
  const r = len(sub(start, center));
  const a0 = Math.atan2(start[1] - center[1], start[0] - center[0]);
  const a1 = Math.atan2(end[1] - center[1], end[0] - center[0]);
  let d = a1 - a0;
  while (d <= -Math.PI) d += 2 * Math.PI;
  while (d > Math.PI) d -= 2 * Math.PI;
  if (side) {
    const mid = a0 + d / 2;
    if (Math.cos(mid) * side[0] + Math.sin(mid) * side[1] < 0) d = d > 0 ? d - 2 * Math.PI : d + 2 * Math.PI;
  }
  const n = Math.max(2, Math.ceil(Math.abs(d) / STEP));
  const out: Point[] = [];
  for (let k = 1; k < n; k++) {
    const a = a0 + (d * k) / n;
    out.push([center[0] + r * Math.cos(a), center[1] + r * Math.sin(a)]);
  }
  out.push(end);
  return out;
}

function signedArea(points: Point[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum / 2;
}

// Mittelpunkt und Wölbungsrichtung eines Bogens von start nach end (null = gerade).
// "außen" ist bei Flächen die Seite außerhalb, bei Linien links in Zeichenrichtung.
function bulgeArc(
  start: Point,
  end: Point,
  bulge: number,
  closed: boolean,
  orientation: number,
  upm: number,
) {
  const chord = len(sub(end, start));
  if (bulge === 0 || chord < 1e-9) return null;
  const e = unit(sub(end, start));
  const outward: Point = closed ? [e[1] * orientation, -e[0] * orientation] : [-e[1], e[0]];
  const dir: Point = bulge > 0 ? outward : [-outward[0], -outward[1]];
  const r = Math.max(Math.abs(bulge) * upm, (chord / 2) * (1 + 1e-9));
  const d = Math.sqrt(Math.max(0, r * r - (chord / 2) ** 2));
  const m: Point = [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  return { center: [m[0] - dir[0] * d, m[1] - dir[1] * d] as Point, dir, r };
}

// Mitte einer Kante (bei Bögen auf dem Bogen) – dort teilt ein neuer Punkt
// den Bogen in zwei Bögen mit gleichem Radius
export function edgeMidpoint(
  points: Point[],
  closed: boolean,
  props: ShapeProps | undefined,
  upm: number,
  edge: number,
): Point {
  const start = points[edge];
  const end = points[(edge + 1) % points.length];
  const orientation = closed && signedArea(points) < 0 ? -1 : 1;
  const bent = bulgeArc(start, end, props?.bulges?.[edge] ?? 0, closed, orientation, upm);
  if (!bent) return [(start[0] + end[0]) / 2, (start[1] + end[1]) / 2];
  return [bent.center[0] + bent.dir[0] * bent.r, bent.center[1] + bent.dir[1] * bent.r];
}

export const isCircle = (props?: ShapeProps) => props?.shape === 'circle';

// Umriss als Punktfolge (bei Flächen ohne Wiederholung des ersten Punkts)
export function outline(
  points: Point[],
  closed: boolean,
  props: ShapeProps | undefined,
  upm: number,
): Point[] {
  if (isCircle(props)) {
    const [c, rim] = points;
    const r = len(sub(rim, c));
    const steps = 128;
    return Array.from({ length: steps }, (_, k) => {
      const a = (2 * Math.PI * k) / steps;
      return [c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)] as Point;
    });
  }
  const n = points.length;
  const edges = closed ? n : n - 1;
  const bulge = (i: number) => props?.bulges?.[i] ?? 0;
  const prevEdge = (i: number) => (closed ? (i - 1 + n) % n : i - 1);

  // Eckrundungen (nur zwischen zwei geraden Kanten)
  const fillets = new Map<number, { t1: Point; t2: Point; c: Point }>();
  for (let i = 0; i < n; i++) {
    if (!closed && (i === 0 || i === n - 1)) continue;
    let r = (props?.radii?.[i] ?? 0) * upm;
    if (!(r > 0) || bulge(prevEdge(i)) !== 0 || bulge(i) !== 0) continue;
    const prev = points[closed ? (i - 1 + n) % n : i - 1];
    const next = points[(i + 1) % n];
    const p = points[i];
    const a = sub(prev, p);
    const b = sub(next, p);
    const u = unit(a);
    const v = unit(b);
    const theta = Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1])));
    if (theta < 1e-3 || Math.PI - theta < 1e-3) continue;
    let t = r / Math.tan(theta / 2);
    const maxT = Math.min(len(a), len(b)) / 2;
    if (t > maxT) {
      t = maxT;
      r = t * Math.tan(theta / 2);
    }
    const bis = unit([u[0] + v[0], u[1] + v[1]]);
    const h = r / Math.sin(theta / 2);
    fillets.set(i, {
      t1: [p[0] + u[0] * t, p[1] + u[1] * t],
      t2: [p[0] + v[0] * t, p[1] + v[1] * t],
      c: [p[0] + bis[0] * h, p[1] + bis[1] * h],
    });
  }

  const orientation = closed && signedArea(points) < 0 ? -1 : 1;
  const out: Point[] = [fillets.get(0)?.t2 ?? points[0]];
  for (let i = 0; i < edges; i++) {
    const a = i;
    const b = (i + 1) % n;
    const start = fillets.get(a)?.t2 ?? points[a];
    const end = fillets.get(b)?.t1 ?? points[b];
    const bent = bulgeArc(start, end, bulge(i), closed, orientation, upm);
    out.push(...(bent ? arc(bent.center, start, end, bent.dir) : [end]));
    const f = fillets.get(b);
    if (f && (closed || b < n - 1)) out.push(...arc(f.c, f.t1, f.t2, null));
  }
  if (closed && out.length > 1 && len(sub(out[0], out[out.length - 1])) < 1e-9) out.pop();
  return out;
}
