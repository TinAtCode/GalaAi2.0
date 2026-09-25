// Objektarten im Lageplan. Gleiche Liste (mit Farben und Symbolen) im
// Frontend unter src/pages/plans/catalog.ts.
export type PlanObjectKind = 'line' | 'opening' | 'area' | 'symbol' | 'text';

export const PLAN_OBJECT_TYPES = {
  // Leitungen und Linien: Länge in m
  rainwater: { kind: 'line', label: 'Regenwasserleitung' },
  wastewater: { kind: 'line', label: 'Schmutzwasserleitung' },
  drain_channel: { kind: 'line', label: 'Entwässerungsrinne' },
  // Schacht: Fläche, meist rund (Durchmesser); gezählt je Durchmesser
  manhole: { kind: 'area', label: 'Schacht' },
  cable: { kind: 'line', label: 'Erdkabel' },
  conduit: { kind: 'line', label: 'Leerrohr' },
  fence: { kind: 'line', label: 'Zaun' },
  // Durchgänge: genau zwei Punkte, Breite = Abstand
  gate: { kind: 'opening', label: 'Tor' },
  door: { kind: 'opening', label: 'Tür' },
  // Flächen: m², Umfang in m
  paving: { kind: 'area', label: 'Pflasterfläche' },
  lawn: { kind: 'area', label: 'Rasenfläche' },
  parking: { kind: 'area', label: 'Parkplatz' },
  planting: { kind: 'area', label: 'Pflanzfläche' },
  // Gebäude: Bezug im Plan (Hauswand, Garage), keine Menge
  building: { kind: 'area', label: 'Gebäude' },
  // Punkte: Stück
  downpipe: { kind: 'symbol', label: 'Fallrohr' },
  gully: { kind: 'symbol', label: 'Gully / Ablauf' },
  pictogram: { kind: 'symbol', label: 'Piktogramm' },
  // Höhenpunkt: Geländehöhe an einer Stelle (props.height in m)
  height_point: { kind: 'symbol', label: 'Höhenpunkt' },
  text: { kind: 'text', label: 'Beschriftung' },
} as const satisfies Record<string, { kind: PlanObjectKind; label: string }>;

export type PlanObjectType = keyof typeof PLAN_OBJECT_TYPES;

// Leitungen mit Nennweite: Mengen je DN getrennt (eigene Leistungen im Angebot)
export const PIPE_TYPES: PlanObjectType[] = ['rainwater', 'wastewater', 'drain_channel', 'conduit'];

// Rohrleitungen mit Formstücken (Bögen, Abzweige), Rinnen liegen an der Oberfläche
export const FITTING_TYPES: PlanObjectType[] = ['rainwater', 'wastewater', 'conduit'];

// ohne Angabe: Leitungen 0,50 m unter, Flächen auf 0 (Bezugshöhe)
export const DEFAULT_PIPE_DEPTH = 0.5;

export const PICTOGRAMS = {
  tree: 'Baum',
  shrub: 'Strauch',
  lamp: 'Leuchte',
  shaft: 'Schacht',
  water: 'Wasseranschluss',
  power: 'Stromanschluss',
  bench: 'Bank',
  play: 'Spielgerät',
} as const;

export type Pictogram = keyof typeof PICTOGRAMS;

export interface PlanObject {
  id: string;
  type: PlanObjectType;
  // Koordinaten in Planeinheiten (bei Hintergrundbild: dessen Pixel)
  points: [number, number][];
  label?: string;
  props?: {
    mowingEdge?: boolean; // Rasen: Mähkante am Rand
    spaces?: number; // Parkplatz: Anzahl Stellplätze
    icon?: Pictogram; // Piktogramm
    dn?: number; // Leitung/Rinne: Nennweite (DN)
    depth?: number; // Leitung: Verlegetiefe in m (Standard 0,50)
    height?: number; // Fläche/Höhenpunkt: Höhe über Bezug in m (Standard 0)
    locked?: boolean; // Lage fixiert: nicht verschieben
    fixed?: number[]; // fixierte Punkte (Indizes)
    radii?: number[]; // Eckradius je Punkt in m (siehe outline.ts)
    bulges?: number[]; // Kante als Bogen: Radius in m, + außen, − innen
    shape?: 'circle'; // Kreis: Mittelpunkt + Randpunkt
  };
}
