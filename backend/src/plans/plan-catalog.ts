// Objektarten im Lageplan. Gleiche Liste (mit Farben und Symbolen) im
// Frontend unter src/pages/plans/catalog.ts.
export type PlanObjectKind = 'line' | 'opening' | 'area' | 'symbol' | 'text';

export const PLAN_OBJECT_TYPES = {
  // Leitungen und Linien: Länge in m
  rainwater: { kind: 'line', label: 'Regenwasserleitung' },
  wastewater: { kind: 'line', label: 'Schmutzwasserleitung' },
  drain_channel: { kind: 'line', label: 'Entwässerungsrinne' },
  cable: { kind: 'line', label: 'Erdkabel' },
  fence: { kind: 'line', label: 'Zaun' },
  // Durchgänge: genau zwei Punkte, Breite = Abstand
  gate: { kind: 'opening', label: 'Tor' },
  door: { kind: 'opening', label: 'Tür' },
  // Flächen: m², Umfang in m
  paving: { kind: 'area', label: 'Pflasterfläche' },
  lawn: { kind: 'area', label: 'Rasenfläche' },
  parking: { kind: 'area', label: 'Parkplatz' },
  planting: { kind: 'area', label: 'Pflanzfläche' },
  // Punkte: Stück
  downpipe: { kind: 'symbol', label: 'Fallrohr' },
  gully: { kind: 'symbol', label: 'Gully / Ablauf' },
  pictogram: { kind: 'symbol', label: 'Piktogramm' },
  text: { kind: 'text', label: 'Beschriftung' },
} as const satisfies Record<string, { kind: PlanObjectKind; label: string }>;

export type PlanObjectType = keyof typeof PLAN_OBJECT_TYPES;

// Leitungen mit Nennweite: Mengen je DN getrennt (eigene Leistungen im Angebot)
export const PIPE_TYPES: PlanObjectType[] = ['rainwater', 'wastewater', 'drain_channel'];

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
    depth?: number; // Leitung: Verlegetiefe in m
  };
}
