import { ReactNode } from 'react';
import { centroid, Point } from './geometry';

// Objektarten wie im Backend (src/plans/plan-catalog.ts), dazu Darstellung
export type Kind = 'line' | 'opening' | 'area' | 'symbol' | 'text';
export type ObjectType =
  | 'rainwater'
  | 'wastewater'
  | 'drain_channel'
  | 'cable'
  | 'fence'
  | 'gate'
  | 'door'
  | 'paving'
  | 'lawn'
  | 'parking'
  | 'planting'
  | 'downpipe'
  | 'gully'
  | 'pictogram'
  | 'text';
export type Pictogram = 'tree' | 'shrub' | 'lamp' | 'shaft' | 'water' | 'power' | 'bench' | 'play';

export interface PlanObject {
  id: string;
  type: ObjectType;
  points: Point[];
  label?: string;
  props?: {
    mowingEdge?: boolean;
    spaces?: number;
    icon?: Pictogram;
    dn?: number;
    depth?: number;
    locked?: boolean; // Lage fixiert
    fixed?: number[]; // fixierte Punkte (Indizes)
  };
}

interface TypeInfo {
  kind: Kind;
  label: string;
  group: 'Entwässerung' | 'Leitungen & Grenzen' | 'Flächen' | 'Symbole';
  color: string;
  fill?: string;
  dash?: string;
  width?: number;
}

export const TYPES: Record<ObjectType, TypeInfo> = {
  rainwater: { kind: 'line', label: 'Regenwasser', group: 'Entwässerung', color: '#1f6fd1', width: 3 },
  wastewater: { kind: 'line', label: 'Schmutzwasser', group: 'Entwässerung', color: '#8b5a2b', width: 3 },
  drain_channel: { kind: 'line', label: 'Rinne', group: 'Entwässerung', color: '#1f6fd1', width: 7 },
  downpipe: { kind: 'symbol', label: 'Fallrohr', group: 'Entwässerung', color: '#1f6fd1' },
  gully: { kind: 'symbol', label: 'Gully / Ablauf', group: 'Entwässerung', color: '#1d3f73' },
  cable: {
    kind: 'line',
    label: 'Erdkabel',
    group: 'Leitungen & Grenzen',
    color: '#d97a00',
    dash: '10 5',
    width: 2.5,
  },
  fence: {
    kind: 'line',
    label: 'Zaun',
    group: 'Leitungen & Grenzen',
    color: '#333333',
    dash: '12 3 2 3',
    width: 2,
  },
  gate: { kind: 'opening', label: 'Tor', group: 'Leitungen & Grenzen', color: '#333333', width: 5 },
  door: { kind: 'opening', label: 'Tür', group: 'Leitungen & Grenzen', color: '#6b3f1d', width: 4 },
  paving: { kind: 'area', label: 'Pflaster', group: 'Flächen', color: '#8a7560', fill: 'url(#plan-paving)' },
  lawn: { kind: 'area', label: 'Rasen', group: 'Flächen', color: '#4c9a2a', fill: '#a8d995' },
  parking: { kind: 'area', label: 'Parkplatz', group: 'Flächen', color: '#6b7280', fill: '#dde1e6' },
  planting: {
    kind: 'area',
    label: 'Pflanzfläche',
    group: 'Flächen',
    color: '#5f8f3a',
    fill: 'url(#plan-planting)',
  },
  pictogram: { kind: 'symbol', label: 'Piktogramm', group: 'Symbole', color: '#2f6b2f' },
  text: { kind: 'text', label: 'Beschriftung', group: 'Symbole', color: '#1b1b1b' },
};

export const PICTOGRAMS: Record<Pictogram, string> = {
  tree: 'Baum',
  shrub: 'Strauch',
  lamp: 'Leuchte',
  shaft: 'Schacht',
  water: 'Wasseranschluss',
  power: 'Stromanschluss',
  bench: 'Bank',
  play: 'Spielgerät',
};

export const GROUPS = ['Entwässerung', 'Leitungen & Grenzen', 'Flächen', 'Symbole'] as const;
export type Group = (typeof GROUPS)[number];

// Leitungen mit Nennweite (wie PIPE_TYPES im Backend); übliche DN im GaLaBau
export const PIPE_TYPES: ObjectType[] = ['rainwater', 'wastewater', 'drain_channel'];
export const DN_OPTIONS = [50, 70, 100, 110, 125, 150, 160, 200, 250, 300, 400];

// Muster für Flächen (in Bildschirmgröße, unabhängig vom Zoom)
export function PatternDefs({ zoom }: { zoom: number }) {
  const s = 10 / zoom;
  return (
    <defs>
      <pattern id="plan-paving" width={s} height={s} patternUnits="userSpaceOnUse">
        <rect width={s} height={s} fill="#d8cbbb" />
        <path
          d={`M0 ${s / 2} H${s} M${s / 2} 0 V${s / 2} M0 ${s} H${s}`}
          stroke="#a8927a"
          strokeWidth={1 / zoom}
        />
      </pattern>
      <pattern id="plan-planting" width={s} height={s} patternUnits="userSpaceOnUse">
        <rect width={s} height={s} fill="#d6ebbd" />
        <circle cx={s / 2} cy={s / 2} r={1.5 / zoom} fill="#5f8f3a" />
      </pattern>
    </defs>
  );
}

// Symbol an einem Punkt; r = Radius in Planeinheiten (bildschirmgleich)
export function SymbolGlyph({ object, r }: { object: PlanObject; r: number }) {
  const [x, y] = object.points[0];
  const sw = r / 5;
  const circle = (fill: string, stroke: string, children?: ReactNode) => (
    <g>
      <circle cx={x} cy={y} r={r} fill={fill} stroke={stroke} strokeWidth={sw} />
      {children}
    </g>
  );
  const letter = (text: string, color: string) => (
    <text x={x} y={y + r * 0.38} fontSize={r * 1.1} textAnchor="middle" fill={color} fontWeight={700}>
      {text}
    </text>
  );
  if (object.type === 'downpipe')
    return circle('#ffffff', '#1f6fd1', <circle cx={x} cy={y} r={r * 0.35} fill="#1f6fd1" />);
  if (object.type === 'gully')
    return (
      <g>
        <rect
          x={x - r}
          y={y - r}
          width={2 * r}
          height={2 * r}
          fill="#ffffff"
          stroke="#1d3f73"
          strokeWidth={sw}
        />
        <path
          d={`M${x - r} ${y - r / 3} H${x + r} M${x - r} ${y + r / 3} H${x + r} M${x - r / 3} ${y - r} V${y + r} M${x + r / 3} ${y - r} V${y + r}`}
          stroke="#1d3f73"
          strokeWidth={sw / 2}
        />
      </g>
    );
  switch (object.props?.icon) {
    case 'tree':
      return circle('#7cc36a', '#2f6b2f', <circle cx={x} cy={y} r={r * 0.25} fill="#6b4a2b" />);
    case 'shrub':
      return (
        <circle
          cx={x}
          cy={y}
          r={r * 0.7}
          fill="#a6d98f"
          stroke="#2f6b2f"
          strokeWidth={sw}
          strokeDasharray={`${sw * 2} ${sw}`}
        />
      );
    case 'lamp':
      return circle(
        '#ffe680',
        '#8a6d00',
        <path
          d={`M${x - r * 0.6} ${y - r * 0.6} L${x + r * 0.6} ${y + r * 0.6} M${x + r * 0.6} ${y - r * 0.6} L${x - r * 0.6} ${y + r * 0.6}`}
          stroke="#8a6d00"
          strokeWidth={sw}
        />,
      );
    case 'shaft':
      return (
        <g>
          <rect
            x={x - r}
            y={y - r}
            width={2 * r}
            height={2 * r}
            fill="#ffffff"
            stroke="#444"
            strokeWidth={sw}
          />
          <path
            d={`M${x - r} ${y - r} L${x + r} ${y + r} M${x + r} ${y - r} L${x - r} ${y + r}`}
            stroke="#444"
            strokeWidth={sw}
          />
        </g>
      );
    case 'water':
      return circle('#e3efff', '#1f6fd1', letter('W', '#1f6fd1'));
    case 'power':
      return circle('#fff1dc', '#d97a00', letter('E', '#d97a00'));
    case 'bench':
      return (
        <rect
          x={x - r * 1.3}
          y={y - r * 0.45}
          width={r * 2.6}
          height={r * 0.9}
          fill="#c49a6c"
          stroke="#6b3f1d"
          strokeWidth={sw}
        />
      );
    case 'play':
      return (
        <path
          d={`M${x} ${y - r} L${x + r} ${y + r * 0.8} L${x - r} ${y + r * 0.8} Z`}
          fill="#e6d4f5"
          stroke="#7a3fb0"
          strokeWidth={sw}
        />
      );
    default:
      return circle('#ffffff', '#555');
  }
}

// Position für die Beschriftung eines Objekts
export function labelAnchor(object: PlanObject): Point {
  return TYPES[object.type].kind === 'area' ? centroid(object.points) : object.points[0];
}
