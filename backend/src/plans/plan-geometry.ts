import { PICTOGRAMS, PIPE_TYPES, PLAN_OBJECT_TYPES, PlanObject, PlanObjectType } from './plan-catalog';
import { isCircle, outline } from './outline';

type Point = [number, number];

export const MAX_OBJECTS = 2000;
export const MAX_POINTS = 500;
export const MAX_TOTAL_POINTS = 50_000;
const MAX_COORDINATE = 1_000_000;

const distance = (a: Point, b: Point) => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function polylineLength(points: Point[]) {
  let sum = 0;
  for (let i = 1; i < points.length; i++) sum += distance(points[i - 1], points[i]);
  return sum;
}

// Fläche eines (einfachen) Polygons nach der Gaußschen Trapezformel
export function polygonArea(points: Point[]) {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return Math.abs(sum) / 2;
}

export function polygonPerimeter(points: Point[]) {
  return polylineLength([...points, points[0]]);
}

// Prüft die vom Client gesendeten Objekte; Fehlertext oder null
export function validateObjects(objects: unknown): string | null {
  if (!Array.isArray(objects)) return 'Objekte fehlen.';
  if (objects.length > MAX_OBJECTS) return `Höchstens ${MAX_OBJECTS} Objekte je Plan.`;
  const ids = new Set<string>();
  let totalPoints = 0;
  for (const raw of objects) {
    const o = raw as Partial<PlanObject>;
    if (!o || typeof o !== 'object') return 'Ungültiges Objekt.';
    if (typeof o.id !== 'string' || !o.id || o.id.length > 64 || ids.has(o.id)) return 'Ungültige Objekt-ID.';
    ids.add(o.id);
    // eigene Eigenschaft: "constructor", "toString" o.ä. sind keine Objektarten
    if (typeof o.type !== 'string' || !Object.prototype.hasOwnProperty.call(PLAN_OBJECT_TYPES, o.type))
      return `Unbekannte Objektart: ${String(o.type)}.`;
    const type = PLAN_OBJECT_TYPES[o.type as PlanObjectType];
    if (!Array.isArray(o.points) || o.points.length > MAX_POINTS) return 'Ungültige Punkte.';
    totalPoints += o.points.length;
    if (totalPoints > MAX_TOTAL_POINTS) return `Höchstens ${MAX_TOTAL_POINTS} Punkte je Plan.`;
    for (const p of o.points) {
      if (
        !Array.isArray(p) ||
        p.length !== 2 ||
        !p.every((v) => Number.isFinite(v) && Math.abs(v) <= MAX_COORDINATE)
      )
        return 'Ungültige Koordinaten.';
    }
    const n = o.points.length;
    const circle = (o.props as { shape?: unknown } | undefined)?.shape === 'circle';
    const ok =
      type.kind === 'line'
        ? n >= 2
        : type.kind === 'opening'
          ? n === 2
          : type.kind === 'area'
            ? circle
              ? n === 2
              : n >= 3
            : n === 1;
    if (!ok) return `${type.label}: falsche Anzahl Punkte.`;
    if (circle && distance(o.points[0], o.points[1]) === 0) return `${type.label}: Kreis ohne Durchmesser.`;
    if (o.label !== undefined && (typeof o.label !== 'string' || o.label.length > 200))
      return 'Beschriftung zu lang.';
    if (type.kind === 'text' && !o.label?.trim()) return 'Beschriftung ohne Text.';
    if (o.props !== undefined) {
      if (typeof o.props !== 'object' || o.props === null) return 'Ungültige Eigenschaften.';
      const { mowingEdge, spaces, icon, dn, depth, locked, fixed, radii, bulges, shape, ...rest } = o.props;
      if (Object.keys(rest).length) return 'Unbekannte Eigenschaft.';
      if (mowingEdge !== undefined && typeof mowingEdge !== 'boolean') return 'Ungültige Mähkante.';
      if (locked !== undefined && typeof locked !== 'boolean') return 'Ungültige Fixierung.';
      if (shape !== undefined && (shape !== 'circle' || type.kind !== 'area')) return 'Ungültige Form.';
      // Eckradien je Punkt, Bögen je Kante (Radius in m, siehe outline.ts)
      const numbers = (list: unknown, count: number, max: number) =>
        Array.isArray(list) &&
        list.length === count &&
        list.every((v) => typeof v === 'number' && Number.isFinite(v) && Math.abs(v) <= max);
      const shaped = type.kind === 'line' || (type.kind === 'area' && !circle);
      if (radii !== undefined && (!shaped || !numbers(radii, n, 1000) || radii.some((r: number) => r < 0)))
        return 'Ungültige Eckradien.';
      if (bulges !== undefined && (!shaped || !numbers(bulges, type.kind === 'area' ? n : n - 1, 100_000)))
        return 'Ungültige Bögen.';
      if (
        fixed !== undefined &&
        (!Array.isArray(fixed) ||
          new Set(fixed).size !== fixed.length ||
          !fixed.every((i) => Number.isInteger(i) && i >= 0 && i < (o.points?.length ?? 0)))
      )
        return 'Ungültige fixierte Punkte.';
      if (dn !== undefined && (!Number.isInteger(dn) || dn < 10 || dn > 2000))
        return 'Ungültige Nennweite (DN).';
      if (dn !== undefined && !PIPE_TYPES.includes(o.type as PlanObjectType))
        return `${type.label}: keine Nennweite.`;
      if (
        depth !== undefined &&
        (typeof depth !== 'number' || !Number.isFinite(depth) || depth < 0 || depth > 20)
      )
        return 'Ungültige Verlegetiefe.';
      if (depth !== undefined && type.kind !== 'line') return `${type.label}: keine Verlegetiefe.`;
      if (spaces !== undefined && (!Number.isInteger(spaces) || spaces < 0 || spaces > 10_000))
        return 'Ungültige Anzahl Stellplätze.';
      if (
        icon !== undefined &&
        (typeof icon !== 'string' || !Object.prototype.hasOwnProperty.call(PICTOGRAMS, icon))
      )
        return 'Unbekanntes Piktogramm.';
    }
    if (o.type === 'pictogram' && !o.props?.icon) return 'Piktogramm ohne Symbol.';
  }
  return null;
}

// Fläche (m²), Umfang (m) und bei Kreisen der Durchmesser (m) – mit Rundungen
export function areaMeasures(o: Pick<PlanObject, 'points' | 'props'>, unitsPerMeter: number) {
  if (isCircle(o.props)) {
    const r = distance(o.points[0], o.points[1]) / unitsPerMeter;
    return { area: Math.PI * r * r, perimeter: 2 * Math.PI * r, diameter: 2 * r };
  }
  const ring = outline(o.points, true, o.props, unitsPerMeter);
  return {
    area: polygonArea(ring) / unitsPerMeter ** 2,
    perimeter: polygonPerimeter(ring) / unitsPerMeter,
    diameter: null,
  };
}

export interface QuantityRow {
  key: string; // z.B. "lawn", "lawn:mowingEdge", "pictogram:tree"
  label: string;
  unit: 'm' | 'm²' | 'Stk';
  quantity: number;
}

const round = (value: number, decimals: number) => Math.round(value * 10 ** decimals) / 10 ** decimals;

// Mengen je Objektart: Längen (m, 2 Nachkommastellen), Flächen (m², 2),
// Stückzahlen; Rasen mit Mähkante zusätzlich deren Länge (Umfang),
// Parkplätze zusätzlich die Stellplätze
export function planQuantities(objects: PlanObject[], unitsPerMeter: number): QuantityRow[] {
  const rows = new Map<string, QuantityRow>();
  const add = (key: string, label: string, unit: QuantityRow['unit'], quantity: number) => {
    const row = rows.get(key) ?? { key, label, unit, quantity: 0 };
    row.quantity += quantity;
    rows.set(key, row);
  };
  const m = (units: number) => units / unitsPerMeter;
  for (const o of objects) {
    const type = PLAN_OBJECT_TYPES[o.type];
    switch (type.kind) {
      case 'line': {
        // mit Bögen und Eckrundungen; Leitungen mit Nennweite getrennt je DN
        const length = m(polylineLength(outline(o.points, false, o.props, unitsPerMeter)));
        if (o.props?.dn && PIPE_TYPES.includes(o.type))
          add(`${o.type}:dn${o.props.dn}`, `${type.label} DN ${o.props.dn}`, 'm', length);
        else add(o.type, type.label, 'm', length);
        break;
      }
      case 'opening':
        add(o.type, type.label, 'Stk', 1);
        add(`${o.type}:width`, `${type.label} (Breite gesamt)`, 'm', m(polylineLength(o.points)));
        break;
      case 'area': {
        const { area, perimeter, diameter } = areaMeasures(o, unitsPerMeter);
        if (o.type === 'manhole') {
          // Schächte zählen, runde getrennt je Durchmesser (in cm)
          if (diameter !== null) {
            const cm = Math.round(diameter * 100);
            add(`manhole:d${cm}`, `${type.label} Ø ${(cm / 100).toFixed(2).replace('.', ',')} m`, 'Stk', 1);
          } else add(o.type, type.label, 'Stk', 1);
          break;
        }
        add(o.type, type.label, 'm²', area);
        if (o.type === 'lawn' && o.props?.mowingEdge) add('lawn:mowingEdge', 'Mähkante', 'm', perimeter);
        if (o.type === 'parking' && o.props?.spaces)
          add('parking:spaces', 'Stellplätze', 'Stk', o.props.spaces);
        break;
      }
      case 'symbol':
        if (o.type === 'pictogram' && o.props?.icon)
          add(`pictogram:${o.props.icon}`, PICTOGRAMS[o.props.icon], 'Stk', 1);
        else add(o.type, type.label, 'Stk', 1);
        break;
      case 'text':
        break;
    }
  }
  return [...rows.values()].map((r) => ({ ...r, quantity: round(r.quantity, r.unit === 'Stk' ? 0 : 2) }));
}

// Gültige Schlüssel einer Mengenzeile (wie planQuantities sie bildet)
export function isQuantityKey(key: string): boolean {
  const [base, extra, ...rest] = key.split(':');
  if (rest.length || !Object.prototype.hasOwnProperty.call(PLAN_OBJECT_TYPES, base)) return false;
  const kind = PLAN_OBJECT_TYPES[base as PlanObjectType].kind;
  if (extra === undefined) return kind !== 'text' && base !== 'pictogram';
  if (base === 'lawn') return extra === 'mowingEdge';
  if (base === 'parking') return extra === 'spaces';
  if (kind === 'opening') return extra === 'width';
  if (base === 'pictogram') return Object.prototype.hasOwnProperty.call(PICTOGRAMS, extra);
  if (PIPE_TYPES.includes(base as PlanObjectType)) return /^dn[1-9]\d{1,3}$/.test(extra);
  if (base === 'manhole') return /^d[1-9]\d{0,4}$/.test(extra);
  return false;
}
