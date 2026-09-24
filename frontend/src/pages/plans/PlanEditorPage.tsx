import {
  ChangeEvent,
  PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  WheelEvent,
} from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import {
  GROUPS,
  labelAnchor,
  PatternDefs,
  PICTOGRAMS,
  Pictogram,
  PlanObject,
  SymbolGlyph,
  TYPES,
  ObjectType,
} from './catalog';
import {
  bounds,
  distance,
  meters,
  midpointAlong,
  Point,
  polygonArea,
  polygonPerimeter,
  polylineLength,
  squareMeters,
} from './geometry';

interface Plan {
  id: string;
  projectId: string;
  name: string;
  unitsPerMeter: number;
  background: { documentId: string; width: number; height: number } | null;
  objects: PlanObject[];
  quantities: { key: string; label: string; unit: string; quantity: number }[];
  version: number;
}

type Tool = 'select' | 'pan' | 'calibrate' | ObjectType;
type Drag =
  | { mode: 'pan'; start: Point; view: View }
  | { mode: 'move'; id: string; start: Point; original: PlanObject[]; moved?: boolean }
  | { mode: 'vertex'; id: string; index: number; original: PlanObject[]; moved?: boolean };
interface View {
  x: number;
  y: number;
  zoom: number; // Bildschirmpixel je Planeinheit
}

const DEFAULT_EXTENT: Point = [2000, 1500]; // ohne Hintergrund: 40 × 30 m bei 50 Einheiten/m
const HISTORY_LIMIT = 100;
// Koordinaten auf zwei Nachkommastellen (kleinere Speicherstände)
const round = (value: number) => Math.round(value * 100) / 100;
const newId = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const number = (value: number, decimals = 2) =>
  value.toLocaleString('de-DE', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });

// Lageplan zeichnen: Entwässerung, Leitungen, Flächen, Zäune/Tore/Türen,
// Symbole; Maße und Mengen live, Maßstab über eine bekannte Strecke
export function PlanEditorPage() {
  const { planId } = useParams();
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('plan.write');
  const [plan, setPlan] = useState<Plan | null>(null);
  const [objects, setObjects] = useState<PlanObject[]>([]);
  const [name, setName] = useState('');
  const [unitsPerMeter, setUnitsPerMeter] = useState(50);
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tool, setTool] = useState<Tool>('select');
  const [icon, setIcon] = useState<Pictogram>('tree');
  const [draft, setDraft] = useState<Point[]>([]);
  const [cursor, setCursor] = useState<Point | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [calibration, setCalibration] = useState<{ points: Point[]; meters: string } | null>(null);
  // Objekte, die vor dem Hintergrund auf dem Raster gezeichnet wurden, beim
  // Kalibrieren mitskalieren (ihre Maße bleiben), sonst bleiben sie am Bild
  const [keepSizes, setKeepSizes] = useState(false);
  const [showMeasures, setShowMeasures] = useState(true);
  const [background, setBackground] = useState<{ id: string; url: string } | null>(null);
  const [backgroundOpacity, setBackgroundOpacity] = useState(0.7);
  const [size, setSize] = useState<Point>([800, 560]);
  const [view, setView] = useState<View>({ x: 0, y: 0, zoom: 0.4 });
  const [history, setHistory] = useState<{ past: PlanObject[][]; future: PlanObject[][] }>({
    past: [],
    future: [],
  });
  const drag = useRef<Drag | null>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);

  const extent: Point = plan?.background ? [plan.background.width, plan.background.height] : DEFAULT_EXTENT;
  const toMeters = (units: number) => units / unitsPerMeter;

  // Laden
  const apply = (loaded: Plan) => {
    setPlan(loaded);
    setObjects(loaded.objects);
    setName(loaded.name);
    setUnitsPerMeter(loaded.unitsPerMeter);
    setDirty(false);
    setHistory({ past: [], future: [] });
  };

  useEffect(() => {
    api
      .get<Plan>(`/plans/${planId}`)
      .then(apply)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Plan konnte nicht geladen werden.'));
  }, [planId]);

  // Hintergrundbild als Blob (Anmeldung per Cookie)
  const backgroundId = plan?.background?.documentId;
  const backgroundUrl = background && background.id === backgroundId ? background.url : null;
  useEffect(() => {
    if (!backgroundId) return;
    let url: string | null = null;
    let cancelled = false;
    api
      .blob(`/plans/${planId}/background`)
      .then((blob) => {
        if (cancelled) return;
        url = URL.createObjectURL(blob);
        setBackground({ id: backgroundId, url });
      })
      .catch(() => !cancelled && setError('Hintergrund konnte nicht geladen werden.'));
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [backgroundId, planId]);

  // Größe der Zeichenfläche
  useEffect(() => {
    const element = boxRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize([Math.max(200, entry.contentRect.width), Math.max(200, entry.contentRect.height)]),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [plan]);

  // Einpassen: Hintergrund bzw. Zeichnung ganz sichtbar
  const fit = useCallback(() => {
    const all = objects.flatMap((o) => o.points);
    const b = plan?.background
      ? { minX: 0, minY: 0, maxX: plan.background.width, maxY: plan.background.height }
      : all.length
        ? bounds([...all, [0, 0], DEFAULT_EXTENT])
        : { minX: 0, minY: 0, maxX: DEFAULT_EXTENT[0], maxY: DEFAULT_EXTENT[1] };
    const w = Math.max(1, b.maxX - b.minX);
    const h = Math.max(1, b.maxY - b.minY);
    const zoom = Math.min(size[0] / w, size[1] / h) * 0.95;
    setView({ zoom, x: b.minX - (size[0] / zoom - w) / 2, y: b.minY - (size[1] / zoom - h) / 2 });
  }, [plan, size, objects]);
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    const key = `${plan?.id}:${backgroundId}:${size[0] > 0}`;
    if (plan && fitted.current !== key) {
      fitted.current = key;
      const frame = requestAnimationFrame(fit);
      return () => cancelAnimationFrame(frame);
    }
  }, [plan, backgroundId, size, fit]);

  // Änderungen mit Rückgängig
  const remember = (before: PlanObject[]) =>
    setHistory((h) => ({ past: [...h.past.slice(-HISTORY_LIMIT + 1), before], future: [] }));
  const commit = (next: PlanObject[]) => {
    remember(objects);
    setObjects(next);
    setDirty(true);
  };
  const undo = () => {
    const previous = history.past[history.past.length - 1];
    if (!previous) return;
    setHistory({ past: history.past.slice(0, -1), future: [...history.future, objects] });
    setObjects(previous);
    setDirty(true);
  };
  const redo = () => {
    const next = history.future[history.future.length - 1];
    if (!next) return;
    setHistory({ past: [...history.past, objects], future: history.future.slice(0, -1) });
    setObjects(next);
    setDirty(true);
  };

  const selected = objects.find((o) => o.id === selectedId) ?? null;
  const updateSelected = (patch: Partial<PlanObject>) =>
    selected && commit(objects.map((o) => (o.id === selected.id ? { ...o, ...patch } : o)));

  // Bildschirm -> Planeinheiten
  const toPlan = (event: { clientX: number; clientY: number }): Point => {
    const svg = svgRef.current!;
    const point = svg.createSVGPoint();
    point.x = event.clientX;
    point.y = event.clientY;
    const p = point.matrixTransform(svg.getScreenCTM()!.inverse());
    return [round(p.x), round(p.y)];
  };

  // Fangen: vorhandene Punkte in der Nähe, mit Umschalt rechtwinklig
  const snap = (p: Point, shift: boolean, exceptId?: string): Point => {
    const last = draft[draft.length - 1];
    if (shift && last) {
      const dx = Math.abs(p[0] - last[0]);
      const dy = Math.abs(p[1] - last[1]);
      return dx > dy ? [p[0], last[1]] : [last[0], p[1]];
    }
    const radius = 10 / view.zoom;
    let best: Point | null = null;
    let bestDistance = radius;
    for (const o of objects) {
      if (o.id === exceptId) continue;
      for (const q of o.points) {
        const d = distance(p, q);
        if (d < bestDistance) {
          best = q;
          bestDistance = d;
        }
      }
    }
    for (const q of draft.slice(0, -1)) {
      const d = distance(p, q);
      if (d < bestDistance) {
        best = q;
        bestDistance = d;
      }
    }
    return best ? [best[0], best[1]] : p;
  };

  const finishDraft = (points = draft) => {
    if (tool === 'select' || tool === 'pan' || tool === 'calibrate') return;
    // doppelte Punkte (Doppelklick) entfernen
    const clean = points.filter((p, i) => i === 0 || distance(p, points[i - 1]) > 1e-6);
    const kind = TYPES[tool].kind;
    const enough = kind === 'area' ? clean.length >= 3 : clean.length >= 2;
    if (enough) {
      const object: PlanObject = { id: newId(), type: tool, points: clean };
      commit([...objects, object]);
      setSelectedId(object.id);
    }
    setDraft([]);
  };

  const onPointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (event.button === 1 || tool === 'pan' || (tool === 'select' && event.button === 0)) {
      if (tool === 'select') setSelectedId(null);
      drag.current = { mode: 'pan', start: [event.clientX, event.clientY], view };
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (event.button !== 0) return;
    const p = snap(toPlan(event), event.shiftKey);
    if (tool === 'calibrate') {
      const points = [...(calibration?.points.length === 1 ? calibration.points : []), p];
      setCalibration({ points, meters: calibration?.meters ?? '' });
      return;
    }
    if (tool === 'select') return;
    const kind = TYPES[tool].kind;
    if (kind === 'symbol' || kind === 'text') {
      const object: PlanObject = {
        id: newId(),
        type: tool,
        points: [p],
        ...(tool === 'pictogram' ? { props: { icon } } : {}),
        ...(tool === 'text' ? { label: 'Text' } : {}),
      };
      commit([...objects, object]);
      setSelectedId(object.id);
      return;
    }
    const next = [...draft, p];
    if (kind === 'opening' && next.length === 2) finishDraft(next);
    else setDraft(next);
  };

  const onPointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const d = drag.current;
    if (d?.mode === 'pan') {
      setView({
        ...d.view,
        x: d.view.x - (event.clientX - d.start[0]) / d.view.zoom,
        y: d.view.y - (event.clientY - d.start[1]) / d.view.zoom,
      });
      return;
    }
    const p = toPlan(event);
    if (d?.mode === 'move') {
      d.moved = true;
      const dx = p[0] - d.start[0];
      const dy = p[1] - d.start[1];
      setObjects(
        d.original.map((o) =>
          o.id === d.id
            ? { ...o, points: o.points.map(([x, y]) => [round(x + dx), round(y + dy)] as Point) }
            : o,
        ),
      );
      return;
    }
    if (d?.mode === 'vertex') {
      d.moved = true;
      const q = snap(p, false, d.id);
      setObjects(
        d.original.map((o) =>
          o.id === d.id ? { ...o, points: o.points.map((pt, i) => (i === d.index ? q : pt)) } : o,
        ),
      );
      return;
    }
    if (draft.length || tool === 'calibrate') setCursor(snap(p, event.shiftKey));
  };

  const onPointerUp = () => {
    const d = drag.current;
    drag.current = null;
    if (d && d.mode !== 'pan' && d.moved) {
      // Verschieben als ein Schritt in der Historie
      remember(d.original);
      setDirty(true);
    }
  };

  const startObjectDrag = (event: ReactPointerEvent, object: PlanObject) => {
    if (tool !== 'select') return;
    event.stopPropagation();
    setSelectedId(object.id);
    if (!canEdit) return;
    drag.current = { mode: 'move', id: object.id, start: toPlan(event), original: objects };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const startVertexDrag = (event: ReactPointerEvent, object: PlanObject, index: number) => {
    event.stopPropagation();
    drag.current = { mode: 'vertex', id: object.id, index, original: objects };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const onWheel = (event: WheelEvent<SVGSVGElement>) => {
    const p = toPlan(event);
    const zoom = Math.min(50, Math.max(0.01, view.zoom * Math.pow(1.0015, -event.deltaY)));
    setView({
      zoom,
      x: p[0] - (p[0] - view.x) * (view.zoom / zoom),
      y: p[1] - (p[1] - view.y) * (view.zoom / zoom),
    });
  };
  const zoomBy = (factor: number) => {
    const cx = view.x + size[0] / view.zoom / 2;
    const cy = view.y + size[1] / view.zoom / 2;
    const zoom = Math.min(50, Math.max(0.01, view.zoom * factor));
    setView({ zoom, x: cx - size[0] / zoom / 2, y: cy - size[1] / zoom / 2 });
  };

  const deleteSelected = () => {
    if (!selected) return;
    commit(objects.filter((o) => o.id !== selected.id));
    setSelectedId(null);
  };

  // Stand, der gerade gespeichert wird: danach nur "gespeichert", wenn
  // inzwischen nichts mehr geändert wurde
  const current = useRef({ objects, name, unitsPerMeter });
  useEffect(() => {
    current.current = { objects, name, unitsPerMeter };
  }, [objects, name, unitsPerMeter]);
  const saving = useRef(false);

  const save = useCallback(async () => {
    if (!plan || !canEdit || saving.current) return;
    saving.current = true;
    setBusy(true);
    setError(null);
    const snapshot = current.current;
    try {
      const saved = await api.put<Plan>(`/plans/${plan.id}`, {
        version: plan.version,
        name: snapshot.name.trim() || plan.name,
        unitsPerMeter: snapshot.unitsPerMeter,
        objects: snapshot.objects,
      });
      setPlan(saved);
      const now = current.current;
      setDirty(
        now.objects !== snapshot.objects ||
          now.name !== snapshot.name ||
          now.unitsPerMeter !== snapshot.unitsPerMeter,
      );
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.');
    } finally {
      saving.current = false;
      setBusy(false);
    }
  }, [plan, canEdit]);

  // Tastatur: Esc, Enter, Entf/Rücktaste, Strg+Z/Y/S
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement;
      if (['INPUT', 'SELECT', 'TEXTAREA'].includes(target.tagName)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 's') {
        event.preventDefault();
        save();
      } else if (!canEdit) return;
      else if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) redo();
        else undo();
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        redo();
      } else if (event.key === 'Escape') {
        setDraft([]);
        setCalibration(null);
        setSelectedId(null);
      } else if (event.key === 'Enter') finishDraft();
      else if (event.key === 'Backspace' || event.key === 'Delete') {
        if (draft.length) setDraft(draft.slice(0, -1));
        else deleteSelected();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Warnung beim Verlassen mit ungespeicherten Änderungen
  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => event.preventDefault();
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const uploadBackground = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file || !plan) return;
    if (dirty) {
      setError('Bitte zuerst speichern.');
      return;
    }
    setBusy(true);
    setError(null);
    api
      .upload<Plan>(`/plans/${plan.id}/background`, file)
      .then((saved) => {
        setPlan(saved);
        setNotice('Hintergrund übernommen. Jetzt den Maßstab über eine bekannte Strecke festlegen.');
        setTool('calibrate');
        setKeepSizes(objects.length > 0);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Hintergrund konnte nicht geladen werden.'),
      )
      .finally(() => setBusy(false));
  };

  const applyCalibration = () => {
    if (!calibration || calibration.points.length !== 2) return;
    const m = Number(calibration.meters.replace(',', '.'));
    const units = distance(calibration.points[0], calibration.points[1]);
    if (!Number.isFinite(m) || m <= 0 || units <= 0) {
      setError('Bitte die Länge der Strecke in Metern angeben.');
      return;
    }
    const next = units / m;
    if (keepSizes && objects.length) {
      const factor = next / unitsPerMeter;
      commit(
        objects.map((o) => ({
          ...o,
          points: o.points.map(([x, y]) => [round(x * factor), round(y * factor)] as Point),
        })),
      );
    }
    setUnitsPerMeter(next);
    setKeepSizes(false);
    setDirty(true);
    setCalibration(null);
    setTool('select');
    setNotice(`Maßstab festgelegt: ${number(units / m, 1)} Einheiten je Meter.`);
  };

  // SVG herunterladen (Hintergrund eingebettet)
  const exportSvg = async () => {
    const svg = svgRef.current;
    if (!svg) return;
    const clone = svg.cloneNode(true) as SVGSVGElement;
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('viewBox', `0 0 ${extent[0]} ${extent[1]}`);
    clone.querySelectorAll('[data-ui]').forEach((n) => n.remove());
    const image = clone.querySelector('image');
    if (image && backgroundUrl) {
      const blob = await (await fetch(backgroundUrl)).blob();
      const dataUrl = await new Promise<string>((resolve) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.readAsDataURL(blob);
      });
      image.setAttribute('href', dataUrl);
    }
    const url = URL.createObjectURL(
      new Blob([new XMLSerializer().serializeToString(clone)], { type: 'image/svg+xml' }),
    );
    const link = document.createElement('a');
    link.href = url;
    link.download = `${name || 'Lageplan'}.svg`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  };

  // live berechnete Mengen (wie im Backend)
  const quantities = useMemo(() => {
    const rows = new Map<string, { label: string; unit: string; quantity: number }>();
    const add = (key: string, label: string, unit: string, q: number) => {
      const row = rows.get(key) ?? { label, unit, quantity: 0 };
      row.quantity += q;
      rows.set(key, row);
    };
    for (const o of objects) {
      const t = TYPES[o.type];
      if (t.kind === 'line') add(o.type, t.label, 'm', toMeters(polylineLength(o.points)));
      if (t.kind === 'opening') {
        add(o.type, t.label, 'Stk', 1);
        add(`${o.type}:w`, `${t.label} (Breite gesamt)`, 'm', toMeters(polylineLength(o.points)));
      }
      if (t.kind === 'area') {
        add(o.type, t.label, 'm²', toMeters(toMeters(polygonArea(o.points))));
        if (o.type === 'lawn' && o.props?.mowingEdge)
          add('lawn:edge', 'Mähkante', 'm', toMeters(polygonPerimeter(o.points)));
        if (o.type === 'parking' && o.props?.spaces)
          add('parking:spaces', 'Stellplätze', 'Stk', o.props.spaces);
      }
      if (t.kind === 'symbol') {
        if (o.type === 'pictogram' && o.props?.icon)
          add(`p:${o.props.icon}`, PICTOGRAMS[o.props.icon], 'Stk', 1);
        else add(o.type, t.label, 'Stk', 1);
      }
    }
    return [...rows.entries()];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [objects, unitsPerMeter]);

  if (error && !plan) return <p className="field-error">{error}</p>;
  if (!plan) return <p>Lädt …</p>;

  const r = 9 / view.zoom; // Symbolgröße: bildschirmgleich
  const fontSize = 12 / view.zoom;
  const px = 1 / view.zoom;
  // Maßstabsleiste: runde Länge, die etwa 120 px lang ist
  const barMeters =
    [0.5, 1, 2, 5, 10, 20, 50, 100, 200, 500].find((m) => m * unitsPerMeter * view.zoom >= 80) ?? 500;
  const metric = (o: PlanObject) => {
    const kind = TYPES[o.type].kind;
    if (kind === 'area') return squareMeters(toMeters(toMeters(polygonArea(o.points))));
    if (kind === 'line' || kind === 'opening') return meters(toMeters(polylineLength(o.points)));
    return null;
  };

  const renderObject = (o: PlanObject) => {
    const t = TYPES[o.type];
    const isSelected = o.id === selectedId;
    const d = `M${o.points.map((p) => p.join(' ')).join(' L')}${t.kind === 'area' ? ' Z' : ''}`;
    const handlers = {
      onPointerDown: (e: ReactPointerEvent) => startObjectDrag(e, o),
      style: { cursor: tool === 'select' ? 'move' : undefined },
    };
    let shape;
    if (t.kind === 'symbol')
      shape = (
        <g {...handlers}>
          <SymbolGlyph object={o} r={r} />
        </g>
      );
    else if (t.kind === 'text')
      shape = (
        <text
          {...handlers}
          x={o.points[0][0]}
          y={o.points[0][1]}
          fontSize={fontSize * 1.3}
          fill={t.color}
          fontWeight={600}
        >
          {o.label}
        </text>
      );
    else
      shape = (
        <g {...handlers}>
          {t.kind === 'area' && (
            <path
              d={d}
              fill={t.fill}
              fillOpacity={0.85}
              stroke={o.type === 'lawn' && o.props?.mowingEdge ? '#555' : t.color}
              strokeWidth={(o.type === 'lawn' && o.props?.mowingEdge ? 4 : 1.5) * px}
            />
          )}
          {t.kind !== 'area' && (
            <>
              <path
                d={d}
                fill="none"
                stroke={t.color}
                strokeWidth={(t.width ?? 2) * px}
                strokeDasharray={t.dash
                  ?.split(' ')
                  .map((v) => Number(v) * px)
                  .join(' ')}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              {o.type === 'drain_channel' && (
                <path
                  d={d}
                  fill="none"
                  stroke="#ffffff"
                  strokeWidth={2 * px}
                  strokeDasharray={`${4 * px} ${4 * px}`}
                />
              )}
              {t.kind === 'opening' &&
                o.points.map((p, i) => <circle key={i} cx={p[0]} cy={p[1]} r={3 * px} fill={t.color} />)}
            </>
          )}
          {/* breite, unsichtbare Trefferfläche */}
          <path
            d={d}
            fill={t.kind === 'area' ? 'transparent' : 'none'}
            stroke="transparent"
            strokeWidth={14 * px}
            data-ui
          />
        </g>
      );
    const measure = showMeasures ? metric(o) : null;
    const anchor =
      t.kind === 'area'
        ? labelAnchor(o)
        : t.kind === 'line' || t.kind === 'opening'
          ? midpointAlong(o.points)
          : labelAnchor(o);
    const caption = [
      o.type === 'parking' && o.props?.spaces ? `P ${o.props.spaces}` : o.type === 'parking' ? 'P' : null,
      t.kind === 'opening' ? t.label : null,
      t.kind !== 'text' ? o.label : null,
      measure,
    ]
      .filter(Boolean)
      .join(' · ');
    return (
      <g key={o.id} data-testid="plan-object" data-type={o.type}>
        {shape}
        {caption && (
          <text
            x={anchor[0]}
            y={anchor[1] - (t.kind === 'symbol' ? r * 1.4 : 4 * px)}
            fontSize={fontSize}
            textAnchor="middle"
            fill="#1b1b1b"
            stroke="#ffffff"
            strokeWidth={3 * px}
            paintOrder="stroke"
            pointerEvents="none"
          >
            {caption}
          </text>
        )}
        {isSelected && canEdit && tool === 'select' && (
          <g data-ui>
            {o.points.map((p, i) => (
              <circle
                key={i}
                cx={p[0]}
                cy={p[1]}
                r={6 * px}
                fill="#ffffff"
                stroke="#2a78d6"
                strokeWidth={2 * px}
                style={{ cursor: 'grab' }}
                onPointerDown={(e) => startVertexDrag(e, o, i)}
                data-testid="plan-vertex"
              />
            ))}
          </g>
        )}
      </g>
    );
  };

  const drawKind = tool !== 'select' && tool !== 'pan' && tool !== 'calibrate' ? TYPES[tool].kind : null;
  const preview = draft.length && cursor ? [...draft, cursor] : draft;
  const hint =
    tool === 'calibrate'
      ? 'Maßstab: Anfang und Ende einer bekannten Strecke anklicken (z.B. Hauslänge aus dem Plan).'
      : drawKind === 'line'
        ? 'Punkte setzen; Doppelklick oder Enter beendet, Rücktaste nimmt den letzten Punkt zurück, Umschalt = rechtwinklig.'
        : drawKind === 'area'
          ? 'Eckpunkte setzen; Doppelklick oder Enter schließt die Fläche.'
          : drawKind === 'opening'
            ? 'Anfang und Ende der Öffnung anklicken.'
            : drawKind
              ? 'Klicken, um das Symbol zu setzen.'
              : 'Objekt anklicken zum Auswählen und Verschieben, Punkte ziehen; freie Fläche ziehen = verschieben, Mausrad = zoomen.';

  return (
    <div className="plan-editor" data-testid="plan-editor">
      <header className="plan-header">
        <Link to={`/projekte/${plan.projectId}`} className="no-print">
          ← Projekt
        </Link>
        {canEdit ? (
          <input
            className="plan-name"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setDirty(true);
            }}
            maxLength={80}
            aria-label="Name des Plans"
            data-testid="plan-name"
          />
        ) : (
          <h2 style={{ margin: 0 }}>{plan.name}</h2>
        )}
        <span className="list-item-meta no-print" data-testid="plan-state">
          {dirty ? 'nicht gespeichert' : 'gespeichert'}
        </span>
        <span style={{ flex: 1 }} />
        {canEdit && (
          <button
            className="btn btn-primary no-print"
            disabled={busy || !dirty}
            onClick={save}
            data-testid="plan-save"
          >
            Speichern
          </button>
        )}
      </header>
      <p className={`plan-message no-print${error ? ' field-error' : ' list-item-meta'}`} role="status">
        {error ?? notice ?? ''}
      </p>

      {canEdit && (
        <div className="plan-toolbar no-print" role="toolbar" aria-label="Werkzeuge">
          <label className="plan-tool-compact">
            <span className="plan-tool-label">Zeichnen</span>
            <select
              value={tool === 'select' || tool === 'pan' || tool === 'calibrate' ? '' : tool}
              onChange={(e) => {
                setTool((e.target.value || 'select') as Tool);
                setDraft([]);
                setSelectedId(null);
              }}
              data-testid="plan-tool-compact"
            >
              <option value="">– Werkzeug –</option>
              {GROUPS.map((group) => (
                <optgroup key={group} label={group}>
                  {(Object.keys(TYPES) as ObjectType[])
                    .filter((t) => TYPES[t].group === group)
                    .map((t) => (
                      <option key={t} value={t}>
                        {TYPES[t].label}
                      </option>
                    ))}
                </optgroup>
              ))}
            </select>
          </label>
          <div className="plan-tool-group">
            {(['select', 'pan'] as const).map((t) => (
              <button
                key={t}
                className={`plan-tool${tool === t ? ' active' : ''}`}
                onClick={() => {
                  setTool(t);
                  setDraft([]);
                }}
                data-testid={`plan-tool-${t}`}
              >
                {t === 'select' ? 'Auswählen' : 'Verschieben'}
              </button>
            ))}
            <button
              className="plan-tool"
              onClick={undo}
              disabled={!history.past.length}
              title="Rückgängig (Strg+Z)"
              data-testid="plan-undo"
            >
              ↶
            </button>
            <button
              className="plan-tool"
              onClick={redo}
              disabled={!history.future.length}
              title="Wiederholen (Strg+Y)"
            >
              ↷
            </button>
          </div>
          {GROUPS.map((group) => (
            <div key={group} className="plan-tool-group plan-tool-types">
              <span className="plan-tool-label">{group}</span>
              {(Object.keys(TYPES) as ObjectType[])
                .filter((t) => TYPES[t].group === group)
                .map((t) => (
                  <button
                    key={t}
                    className={`plan-tool${tool === t ? ' active' : ''}`}
                    onClick={() => {
                      setTool(t);
                      setDraft([]);
                      setSelectedId(null);
                    }}
                    data-testid={`plan-tool-${t}`}
                  >
                    <span
                      className="plan-swatch"
                      style={{ background: TYPES[t].fill?.startsWith('#') ? TYPES[t].fill : TYPES[t].color }}
                    />
                    {TYPES[t].label}
                  </button>
                ))}
              {group === 'Symbole' && tool === 'pictogram' && (
                <select
                  value={icon}
                  onChange={(e) => setIcon(e.target.value as Pictogram)}
                  aria-label="Piktogramm"
                  data-testid="plan-icon"
                >
                  {(Object.keys(PICTOGRAMS) as Pictogram[]).map((k) => (
                    <option key={k} value={k}>
                      {PICTOGRAMS[k]}
                    </option>
                  ))}
                </select>
              )}
            </div>
          ))}
          <div className="plan-tool-group">
            <span className="plan-tool-label">Plan</span>
            <label className="plan-tool">
              Hintergrund …
              <input
                type="file"
                accept="image/png,image/jpeg,application/pdf,.pdf"
                onChange={uploadBackground}
                style={{ display: 'none' }}
                data-testid="plan-background"
              />
            </label>
            <button
              className={`plan-tool${tool === 'calibrate' ? ' active' : ''}`}
              onClick={() => {
                setTool('calibrate');
                setCalibration(null);
                setDraft([]);
              }}
              data-testid="plan-tool-calibrate"
            >
              Maßstab
            </button>
          </div>
        </div>
      )}
      <div className="plan-body">
        <div ref={boxRef} className="plan-canvas" data-testid="plan-canvas">
          {(drawKind || tool === 'calibrate') && (
            <div className="plan-hint no-print" data-testid="plan-hint">
              <span>
                {hint}
                {draft.length > 0 &&
                  drawKind === 'line' &&
                  cursor &&
                  ` Länge: ${meters(toMeters(polylineLength(preview)))}`}
                {draft.length > 1 &&
                  drawKind === 'area' &&
                  cursor &&
                  ` Fläche: ${squareMeters(toMeters(toMeters(polygonArea(preview))))}`}
              </span>
              {draft.length > 0 && (
                <button className="btn btn-primary" onClick={() => finishDraft()} data-testid="plan-finish">
                  Fertig
                </button>
              )}
            </div>
          )}
          <svg
            ref={svgRef}
            width={size[0]}
            height={size[1]}
            viewBox={`${view.x} ${view.y} ${size[0] / view.zoom} ${size[1] / view.zoom}`}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
            onDoubleClick={() => finishDraft()}
            onWheel={onWheel}
            style={{
              touchAction: 'none',
              cursor: tool === 'pan' ? 'grab' : drawKind || tool === 'calibrate' ? 'crosshair' : 'default',
            }}
          >
            <PatternDefs zoom={view.zoom} />
            <rect x={0} y={0} width={extent[0]} height={extent[1]} fill="#ffffff" />
            {backgroundUrl && plan.background && (
              <image
                href={backgroundUrl}
                x={0}
                y={0}
                width={plan.background.width}
                height={plan.background.height}
                opacity={backgroundOpacity}
              />
            )}
            {!plan.background && (
              <g data-ui>
                {Array.from({ length: Math.floor(extent[0] / unitsPerMeter) + 1 }, (_, i) => (
                  <line
                    key={`x${i}`}
                    x1={i * unitsPerMeter}
                    x2={i * unitsPerMeter}
                    y1={0}
                    y2={extent[1]}
                    stroke={i % 5 ? '#eef0f2' : '#d9dde2'}
                    strokeWidth={px}
                  />
                ))}
                {Array.from({ length: Math.floor(extent[1] / unitsPerMeter) + 1 }, (_, i) => (
                  <line
                    key={`y${i}`}
                    y1={i * unitsPerMeter}
                    y2={i * unitsPerMeter}
                    x1={0}
                    x2={extent[0]}
                    stroke={i % 5 ? '#eef0f2' : '#d9dde2'}
                    strokeWidth={px}
                  />
                ))}
              </g>
            )}
            {objects.filter((o) => TYPES[o.type].kind === 'area').map(renderObject)}
            {objects.filter((o) => TYPES[o.type].kind !== 'area').map(renderObject)}
            {preview.length > 0 && drawKind && (
              <path
                data-ui
                d={`M${preview.map((p) => p.join(' ')).join(' L')}${drawKind === 'area' && preview.length > 2 ? ' Z' : ''}`}
                fill={drawKind === 'area' ? 'rgba(42,120,214,0.12)' : 'none'}
                stroke="#2a78d6"
                strokeWidth={2 * px}
                strokeDasharray={`${6 * px} ${4 * px}`}
                pointerEvents="none"
              />
            )}
            {calibration && (
              <g data-ui pointerEvents="none">
                <path
                  d={`M${[...calibration.points, ...(calibration.points.length === 1 && cursor ? [cursor] : [])].map((p) => p.join(' ')).join(' L')}`}
                  stroke="#eb6834"
                  strokeWidth={3 * px}
                  fill="none"
                />
                {calibration.points.map((p, i) => (
                  <circle key={i} cx={p[0]} cy={p[1]} r={5 * px} fill="#eb6834" />
                ))}
              </g>
            )}
          </svg>
          <div className="plan-scale" aria-hidden="true">
            <span style={{ width: barMeters * unitsPerMeter * view.zoom }} />
            {number(barMeters, barMeters < 1 ? 1 : 0)} m
          </div>
          <div className="plan-zoom no-print">
            <button className="plan-tool" onClick={() => zoomBy(1.25)} aria-label="Vergrößern">
              +
            </button>
            <button className="plan-tool" onClick={() => zoomBy(0.8)} aria-label="Verkleinern">
              −
            </button>
            <button className="plan-tool" onClick={fit} data-testid="plan-fit">
              Einpassen
            </button>
          </div>
        </div>

        <aside className="plan-panel">
          {calibration?.points.length === 2 && (
            <div className="job-card" style={{ display: 'block' }} data-testid="plan-calibration">
              <strong>Maßstab festlegen</strong>
              <p className="list-item-meta">Wie lang ist die markierte Strecke in Wirklichkeit?</p>
              <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
                <label className="field" style={{ flex: 1 }}>
                  <span>Länge (m)</span>
                  <input
                    value={calibration.meters}
                    onChange={(e) => setCalibration({ ...calibration, meters: e.target.value })}
                    inputMode="decimal"
                    autoFocus
                    data-testid="plan-calibration-meters"
                  />
                </label>
                <button
                  className="btn btn-primary"
                  onClick={applyCalibration}
                  data-testid="plan-calibration-apply"
                >
                  Übernehmen
                </button>
              </div>
            </div>
          )}

          {selected && (
            <div className="job-card" style={{ display: 'block' }} data-testid="plan-selection">
              <strong>{TYPES[selected.type].label}</strong>
              {metric(selected) && <div data-testid="plan-selection-metric">{metric(selected)}</div>}
              {selected.type === 'lawn' && selected.props?.mowingEdge && (
                <div className="list-item-meta">
                  Mähkante {meters(toMeters(polygonPerimeter(selected.points)))}
                </div>
              )}
              {TYPES[selected.type].kind === 'area' && (
                <div className="list-item-meta">
                  Umfang {meters(toMeters(polygonPerimeter(selected.points)))}
                </div>
              )}
              {canEdit && (
                <>
                  <label className="field">
                    <span>{selected.type === 'text' ? 'Text' : 'Bezeichnung'}</span>
                    <input
                      value={selected.label ?? ''}
                      onChange={(e) => updateSelected({ label: e.target.value })}
                      maxLength={200}
                      data-testid="plan-selection-label"
                    />
                  </label>
                  {TYPES[selected.type].kind !== 'text' && (
                    <label className="field">
                      <span>Art</span>
                      <select
                        value={selected.type}
                        onChange={(e) => {
                          const type = e.target.value as ObjectType;
                          updateSelected({
                            type,
                            props:
                              type === 'pictogram'
                                ? { icon: selected.props?.icon ?? 'tree' }
                                : selected.props,
                          });
                        }}
                      >
                        {(Object.keys(TYPES) as ObjectType[])
                          .filter((t) => TYPES[t].kind === TYPES[selected.type].kind)
                          .map((t) => (
                            <option key={t} value={t}>
                              {TYPES[t].label}
                            </option>
                          ))}
                      </select>
                    </label>
                  )}
                  {selected.type === 'lawn' && (
                    <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '6px 0' }}>
                      <input
                        type="checkbox"
                        checked={!!selected.props?.mowingEdge}
                        onChange={(e) =>
                          updateSelected({ props: { ...selected.props, mowingEdge: e.target.checked } })
                        }
                        data-testid="plan-mowing-edge"
                      />
                      mit Mähkante
                    </label>
                  )}
                  {selected.type === 'parking' && (
                    <label className="field">
                      <span>Stellplätze</span>
                      <input
                        type="number"
                        min={0}
                        max={10000}
                        value={selected.props?.spaces ?? ''}
                        onChange={(e) =>
                          updateSelected({
                            props: {
                              ...selected.props,
                              spaces: e.target.value
                                ? Math.max(0, Math.floor(Number(e.target.value)))
                                : undefined,
                            },
                          })
                        }
                        data-testid="plan-spaces"
                      />
                    </label>
                  )}
                  {selected.type === 'pictogram' && (
                    <label className="field">
                      <span>Symbol</span>
                      <select
                        value={selected.props?.icon ?? 'tree'}
                        onChange={(e) =>
                          updateSelected({ props: { ...selected.props, icon: e.target.value as Pictogram } })
                        }
                      >
                        {(Object.keys(PICTOGRAMS) as Pictogram[]).map((k) => (
                          <option key={k} value={k}>
                            {PICTOGRAMS[k]}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    <button
                      className="btn"
                      onClick={() => {
                        const copy = {
                          ...selected,
                          id: newId(),
                          points: selected.points.map(
                            ([x, y]) => [round(x + 20 * px), round(y + 20 * px)] as Point,
                          ),
                        };
                        commit([...objects, copy]);
                        setSelectedId(copy.id);
                      }}
                    >
                      Duplizieren
                    </button>
                    <button className="btn" onClick={deleteSelected} data-testid="plan-delete-object">
                      Löschen
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="job-card" style={{ display: 'block' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
              <strong>Mengen</strong>
              <label
                className="list-item-meta no-print"
                style={{ display: 'flex', gap: 4, alignItems: 'center' }}
              >
                <input
                  type="checkbox"
                  checked={showMeasures}
                  onChange={(e) => setShowMeasures(e.target.checked)}
                />{' '}
                Maße im Plan
              </label>
            </div>
            {quantities.length === 0 ? (
              <p className="list-item-meta">Noch nichts gezeichnet.</p>
            ) : (
              <table className="finance-table" data-testid="plan-quantities">
                <tbody>
                  {quantities.map(([key, row]) => (
                    <tr key={key}>
                      <td>{row.label}</td>
                      <td>
                        {number(row.quantity, row.unit === 'Stk' ? 0 : 2)} {row.unit}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <p className="list-item-meta">
              Maßstab: {number(unitsPerMeter, 1)} Einheiten je Meter
              {!plan.background && ' (Raster 1 m)'}
            </p>
          </div>

          <div className="job-card no-print" style={{ display: 'block' }}>
            {plan.background && (
              <label className="field">
                <span>Hintergrund sichtbar</span>
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={backgroundOpacity}
                  onChange={(e) => setBackgroundOpacity(Number(e.target.value))}
                />
              </label>
            )}
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn" onClick={() => window.print()}>
                Drucken
              </button>
              <button className="btn" onClick={exportSvg} data-testid="plan-export">
                Als SVG
              </button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
