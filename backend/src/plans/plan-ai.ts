import { randomUUID } from 'crypto';
import { PICTOGRAMS, PLAN_OBJECT_TYPES, PlanObject } from './plan-catalog';
import { validateObjects } from './plan-geometry';

// Zeichnen mit KI: Die KI arbeitet in Metern (x nach rechts, y nach unten,
// Ursprung oben links); GartenAI rechnet in Planeinheiten um. So braucht die
// KI keinen Maßstab zu kennen, und die Mengen fürs Angebot stimmen.
export const MAX_AI_OBJECTS = 200;

const round = (value: number) => Math.round(value * 100) / 100;

// Plan für die KI: vorhandene Objekte in Metern, Größe der Zeichenfläche
export function planForAi(objects: PlanObject[], unitsPerMeter: number, extent: [number, number]) {
  return {
    flaecheInMetern: { breite: round(extent[0] / unitsPerMeter), hoehe: round(extent[1] / unitsPerMeter) },
    vorhandeneObjekte: objects.slice(0, 300).map((o) => ({
      type: o.type,
      points: o.points.map(([x, y]) => [round(x / unitsPerMeter), round(y / unitsPerMeter)]),
      ...(o.label ? { label: o.label } : {}),
    })),
    objektarten: Object.fromEntries(
      Object.entries(PLAN_OBJECT_TYPES).map(([key, t]) => [key, `${t.label} (${t.kind})`]),
    ),
    piktogramme: PICTOGRAMS,
  };
}

export const PLAN_AI_PROMPT = [
  'Du zeichnest in einen Lageplan eines Garten- und Landschaftsbaubetriebs.',
  'Antworte NUR mit JSON: {"objects": [{"type": "...", "points": [[x, y], ...], "label": "...", "props": {...}}]}.',
  'Koordinaten in Metern, x nach rechts, y nach unten, Ursprung oben links, innerhalb der Fläche.',
  'Punkte je Art: line mindestens 2, area mindestens 3 (Umriss, ohne den ersten Punkt zu wiederholen),',
  'opening genau 2, symbol und text genau 1. Kreisfläche: props.shape "circle" mit Mittelpunkt und Randpunkt.',
  'Erlaubte props: mowingEdge (Rasen, true/false), spaces (Parkplatz, Anzahl), icon (Piktogramm, siehe Liste),',
  'dn (Nennweite bei Leitungen/Rinnen), depth (Verlegetiefe in m bei Leitungen). text braucht ein label.',
  'Zeichne nur, was verlangt ist; vorhandene Objekte nicht wiederholen.',
].join('\n');

// Vorschlag der KI prüfen und umrechnen: ungültige Objekte fallen weg (mit Zählung)
export function objectsFromAi(raw: unknown, unitsPerMeter: number) {
  const list = Array.isArray(raw) ? raw : [];
  const objects: PlanObject[] = [];
  let dropped = Math.max(0, list.length - MAX_AI_OBJECTS);
  for (const item of list.slice(0, MAX_AI_OBJECTS)) {
    const o = item as Partial<PlanObject> | null;
    const candidate = {
      id: `ki-${randomUUID().slice(0, 18)}`,
      type: o?.type,
      points: Array.isArray(o?.points)
        ? o.points.map((p) =>
            Array.isArray(p) && p.length === 2
              ? [Number(p[0]) * unitsPerMeter, Number(p[1]) * unitsPerMeter]
              : p,
          )
        : o?.points,
      ...(typeof o?.label === 'string' && o.label.trim() ? { label: o.label.trim().slice(0, 200) } : {}),
      ...(o?.props && typeof o.props === 'object' ? { props: o.props } : {}),
    };
    if (validateObjects([candidate]) === null) objects.push(candidate as PlanObject);
    else dropped++;
  }
  return { objects, dropped };
}
