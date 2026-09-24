export type Point = [number, number];

export const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function polylineLength(points: Point[]) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += distance(points[i - 1], points[i]);
  return sum;
}

export function polygonArea(points: Point[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

export const polygonPerimeter = (points: Point[]) => polylineLength([...points, points[0]]);

// Schwerpunkt für Beschriftungen (bei entarteten Flächen: Mittel der Punkte)
export function centroid(points: Point[]): Point {
  const area2 = points.reduce((sum, p, i) => {
    const q = points[(i + 1) % points.length];
    return sum + (p[0] * q[1] - q[0] * p[1]);
  }, 0);
  if (Math.abs(area2) < 1e-9) {
    const n = points.length;
    return [points.reduce((s, p) => s + p[0], 0) / n, points.reduce((s, p) => s + p[1], 0) / n];
  }
  let cx = 0;
  let cy = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const q = points[(i + 1) % points.length];
    const f = p[0] * q[1] - q[0] * p[1];
    cx += (p[0] + q[0]) * f;
    cy += (p[1] + q[1]) * f;
  }
  return [cx / (3 * area2), cy / (3 * area2)];
}

// Mitte einer Linie entlang ihrer Länge (für die Längenangabe)
export function midpointAlong(points: Point[]): Point {
  const half = polylineLength(points) / 2;
  let walked = 0;
  for (let i = 1; i < points.length; i++) {
    const segment = distance(points[i - 1], points[i]);
    if (walked + segment >= half && segment > 0) {
      const t = (half - walked) / segment;
      return [
        points[i - 1][0] + (points[i][0] - points[i - 1][0]) * t,
        points[i - 1][1] + (points[i][1] - points[i - 1][1]) * t,
      ];
    }
    walked += segment;
  }
  return points[0];
}

export function bounds(points: Point[]) {
  const xs = points.map((p) => p[0]);
  const ys = points.map((p) => p[1]);
  return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
}

const number = (value: number, decimals: number) =>
  value.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
export const meters = (value: number) => `${number(value, 2)} m`;
export const squareMeters = (value: number) => `${number(value, 2)} m²`;

// Name eines Punkts: A, B, C … (ab dem 27. Punkt P27, P28 …)
export const pointName = (index: number) => (index < 26 ? String.fromCharCode(65 + index) : `P${index + 1}`);

// Kanten eines Objekts: [von, bis]; geschlossene Flächen mit der letzten Kante zurück zum Anfang
export function segments(count: number, closed: boolean): [number, number][] {
  const list: [number, number][] = [];
  for (let i = 0; i < count - 1; i++) list.push([i, i + 1]);
  if (closed && count > 2) list.push([count - 1, 0]);
  return list;
}

const round2 = (value: number) => Math.round(value * 100) / 100;

// Länge einer Kante (in Planeinheiten) setzen. Der Anfangspunkt bleibt; der
// Endpunkt und die folgenden Punkte bis zum nächsten fixierten (bei Flächen
// höchstens bis vor die Kante am Anfangspunkt) verschieben sich um denselben
// Weg entlang der Kante – so behalten sie ihre Abstände.
// Ist der Endpunkt fixiert, bewegt sich stattdessen der Anfangspunkt (mit
// den vorigen Punkten). Beispiel: Rechteck ABCD, Kante AB fixiert – eine
// neue Länge für BC verschiebt C und D, das Rechteck bleibt rechteckig.
export function setSegmentLength(
  points: Point[],
  segment: [number, number],
  closed: boolean,
  length: number,
  fixed: number[] = [],
): Point[] | string {
  const [a, b] = segment;
  const current = distance(points[a], points[b]);
  if (current <= 0) return 'Die Kante hat keine Länge.';
  if (!(length > 0)) return 'Bitte eine Länge größer 0 angeben.';
  const isFixed = (i: number) => fixed.includes(i);
  if (isFixed(a) && isFixed(b)) return 'Beide Punkte der Kante sind fixiert.';
  // bewegte Seite: normalerweise der Endpunkt b, vorwärts; sonst a, rückwärts
  const [anchor, moving, step] = isFixed(b) ? [b, a, -1] : [a, b, 1];
  const n = points.length;
  const dx = ((points[moving][0] - points[anchor][0]) / current) * (length - current);
  const dy = ((points[moving][1] - points[anchor][1]) / current) * (length - current);
  // Flächen: die Kante vor dem Anker bleibt stehen (ihr anderer Punkt bewegt
  // sich nicht) – so bleibt ein Rechteck auch ohne fixierte Punkte rechteckig
  const stopAt = closed ? (anchor - step + n) % n : -1;
  const moved = new Set<number>();
  let k = moving;
  for (;;) {
    moved.add(k);
    const next = closed ? (k + step + n) % n : k + step;
    if (next < 0 || next >= n || next === anchor || next === stopAt || isFixed(next) || moved.has(next))
      break;
    k = next;
  }
  return points.map((p, i) => (moved.has(i) ? [round2(p[0] + dx), round2(p[1] + dy)] : p));
}
