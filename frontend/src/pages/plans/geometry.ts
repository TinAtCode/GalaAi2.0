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
