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
import { QuoteFromPlan } from './QuoteFromPlan';
import { useAuth } from '../../auth/AuthContext';
import {
  DN_OPTIONS,
  Group,
  GROUPS,
  PIPE_TYPES,
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
  insertPoint,
  meters,
  midpointAlong,
  Point,
  pointName,
  segments,
  setSegmentLength,
  polygonArea,
  polygonPerimeter,
  polylineLength,
  removePoint,
  scaleObject,
  setListValue,
  squareMeters,
} from './geometry';
import { edgeMidpoint, isCircle, outline } from './outline';
import { DxfDrawing, parseDxf } from './dxf';
import { DxfImport } from './DxfImport';
import { pipeFittings } from './fittings';
import { AiDrawing } from './AiDrawing';
import { useAiTask } from '../../ai/tasks';
import { offlineDb, OutboxEntry } from '../../offline/db';
import {
  discardLocalVersion,
  flushOutbox,
  isNetworkError,
  keepLocalVersion,
  notifyOfflineChange,
  useOnline,
  useOutbox,
} from '../../offline/sync';

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
  const canQuote = hasPermission('quote.create');
  const canDrawAi = useAiTask('lageplan_zeichnen') && canEdit && hasPermission('ai.use');
  const [aiOpen, setAiOpen] = useState(false);
  const [scalePercent, setScalePercent] = useState('100');
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
  // Ebenen: ausgeblendete Gruppen; Flächen blass, damit Leitungen darunter lesbar sind
  const [hidden, setHidden] = useState<Group[]>([]);
  const [paleAreas, setPaleAreas] = useState(false);
  // exakte Länge der nächsten Strecke beim Zeichnen (Richtung: Maus)
  const [lengthEntry, setLengthEntry] = useState('');
  // Flächen als Kreis zeichnen (Mittelpunkt, dann Rand); beim Schacht Standard
  const [circleChoice, setCircleChoice] = useState<Partial<Record<Tool, boolean>>>({});
  const circleMode = circleChoice[tool] ?? tool === 'manhole';
  const [quoteOpen, setQuoteOpen] = useState(false);
  // DXF-Datei, deren Layer gerade zugeordnet werden
  const [dxf, setDxf] = useState<{ name: string; drawing: DxfDrawing } | null>(null);
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
  // Umriss mit Rundungen und Bögen (in Planeinheiten); Maße daraus wie im Backend
  const outlineOf = (o: PlanObject) => {
    const kind = TYPES[o.type].kind;
    return kind === 'line' || kind === 'area'
      ? outline(o.points, kind === 'area', o.props, unitsPerMeter)
      : o.points;
  };
  const radiusOf = (o: PlanObject) => toMeters(distance(o.points[0], o.points[1]));
  const lengthOf = (o: PlanObject) => toMeters(polylineLength(outlineOf(o)));
  const areaOf = (o: PlanObject) =>
    isCircle(o.props) ? Math.PI * radiusOf(o) ** 2 : toMeters(toMeters(polygonArea(outlineOf(o))));
  const perimeterOf = (o: PlanObject) =>
    isCircle(o.props) ? 2 * Math.PI * radiusOf(o) : toMeters(polygonPerimeter(outlineOf(o)));

  // Laden – offline aus dem Gerät; eine noch nicht übertragene Änderung
  // (Warteschlange) geht dem Serverstand vor
  const online = useOnline();
  const [offlineCopy, setOfflineCopy] = useState<number | null>(null); // Stand vom (ms)
  const outbox = useOutbox();
  const pending = outbox.find((e) => e.planId === planId) ?? null;

  const apply = (loaded: Plan, queued?: OutboxEntry) => {
    setPlan(loaded);
    const local = queued && !queued.conflict;
    setObjects(local ? (queued.objects as PlanObject[]) : loaded.objects);
    setName(local ? queued.name : loaded.name);
    setUnitsPerMeter(local ? queued.unitsPerMeter : loaded.unitsPerMeter);
    setDirty(false);
    setHistory({ past: [], future: [] });
  };

  useEffect(() => {
    if (!planId) return;
    let current = true;
    (async () => {
      const queued = await offlineDb.getOutbox(planId).catch(() => undefined);
      try {
        const loaded = await api.get<Plan>(`/plans/${planId}`);
        if (!current) return;
        apply(loaded, queued);
        setOfflineCopy(null);
        // für später ohne Netz auf dem Gerät behalten (Hintergrund kommt beim Laden dazu)
        const cached = await offlineDb.getPlan(planId).catch(() => undefined);
        await offlineDb
          .putPlan({
            id: loaded.id,
            projectId: loaded.projectId,
            name: loaded.name,
            plan: loaded,
            background:
              cached?.backgroundId === loaded.background?.documentId ? cached?.background : undefined,
            backgroundId:
              cached?.backgroundId === loaded.background?.documentId ? cached?.backgroundId : undefined,
            cachedAt: Date.now(),
          })
          .catch(() => undefined);
      } catch (err) {
        if (!current) return;
        if (!isNetworkError(err)) {
          setError(err instanceof ApiError ? err.message : 'Plan konnte nicht geladen werden.');
          return;
        }
        const cached = await offlineDb.getPlan(planId).catch(() => undefined);
        if (!current) return;
        if (!cached) {
          setError('Keine Verbindung – dieser Plan wurde auf diesem Gerät noch nicht geöffnet.');
          return;
        }
        apply(cached.plan as Plan, queued);
        setOfflineCopy(cached.cachedAt);
      }
    })();
    return () => {
      current = false;
    };
  }, [planId]);

  // Nach dem Übertragen der Warteschlange: neuen Serverstand (Version) übernehmen
  const hadPending = useRef(false);
  useEffect(() => {
    if (pending && !pending.conflict) {
      hadPending.current = true;
      return;
    }
    if (!hadPending.current || pending || !planId) return;
    hadPending.current = false;
    offlineDb
      .getPlan(planId)
      .then((cached) => {
        if (cached) setPlan(cached.plan as Plan);
      })
      .catch(() => undefined);
  }, [pending, planId]);

  // Hintergrundbild als Blob (Anmeldung per Cookie)
  const backgroundId = plan?.background?.documentId;
  const backgroundUrl = background && background.id === backgroundId ? background.url : null;
  useEffect(() => {
    if (!backgroundId) return;
    let url: string | null = null;
    let cancelled = false;
    const show = (blob: Blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setBackground({ id: backgroundId, url });
    };
    api
      .blob(`/plans/${planId}/background`)
      .then(async (blob) => {
        show(blob);
        // Hintergrund für offline mitspeichern
        const cached = await offlineDb.getPlan(planId!).catch(() => undefined);
        if (cached)
          await offlineDb.putPlan({ ...cached, background: blob, backgroundId }).catch(() => undefined);
      })
      .catch(async (err) => {
        const cached = isNetworkError(err)
          ? await offlineDb.getPlan(planId!).catch(() => undefined)
          : undefined;
        if (cached?.background && cached.backgroundId === backgroundId) show(cached.background);
        else if (!cancelled) setError('Hintergrund konnte nicht geladen werden.');
      });
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
  // nach einem Import einpassen, sobald die neuen Objekte gerendert sind
  const fitPending = useRef(false);
  useEffect(() => {
    if (!fitPending.current) return;
    fitPending.current = false;
    fit();
  }, [fit]);
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

  // nächsten Punkt genau in der eingegebenen Entfernung setzen, Richtung zur Maus
  // (ohne Mausposition: nach rechts)
  const addPointAtLength = () => {
    const last = draft[draft.length - 1];
    const m = Number(lengthEntry.trim().replace(',', '.'));
    if (!last || !Number.isFinite(m) || m <= 0) {
      setError('Bitte eine Länge in Metern angeben, z. B. 4,5.');
      return;
    }
    setError(null);
    const target = cursor && distance(cursor, last) > 0 ? cursor : ([last[0] + 1, last[1]] as Point);
    const d = distance(target, last);
    const kind = tool === 'select' || tool === 'pan' || tool === 'calibrate' ? null : TYPES[tool].kind;
    const circle = kind === 'area' && circleMode && draft.length === 1;
    // beim Kreis ist die Eingabe der Durchmesser
    const units = (circle ? m / 2 : m) * unitsPerMeter;
    const next: Point = [
      Math.round((last[0] + ((target[0] - last[0]) / d) * units) * 100) / 100,
      Math.round((last[1] + ((target[1] - last[1]) / d) * units) * 100) / 100,
    ];
    const points = [...draft, next];
    setLengthEntry('');
    if ((kind === 'opening' || circle) && points.length === 2) finishDraft(points);
    else setDraft(points);
  };

  const finishDraft = (points = draft) => {
    if (tool === 'select' || tool === 'pan' || tool === 'calibrate') return;
    // doppelte Punkte (Doppelklick) entfernen
    const clean = points.filter((p, i) => i === 0 || distance(p, points[i - 1]) > 1e-6);
    const kind = TYPES[tool].kind;
    const circle = kind === 'area' && circleMode;
    const enough = circle ? clean.length === 2 : kind === 'area' ? clean.length >= 3 : clean.length >= 2;
    if (enough) {
      const object: PlanObject = {
        id: newId(),
        type: tool,
        points: clean,
        ...(circle ? { props: { shape: 'circle' as const } } : {}),
      };
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
    if ((kind === 'opening' || (kind === 'area' && circleMode)) && next.length === 2) finishDraft(next);
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
        d.original.map((o) => {
          if (o.id !== d.id) return o;
          // Kreis: Mittelpunkt ziehen verschiebt den ganzen Kreis
          if (isCircle(o.props) && d.index === 0) {
            const [dx, dy] = [q[0] - o.points[0][0], q[1] - o.points[0][1]];
            return { ...o, points: o.points.map(([x, y]) => [round(x + dx), round(y + dy)] as Point) };
          }
          return { ...o, points: o.points.map((pt, i) => (i === d.index ? q : pt)) };
        }),
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
    // fixierte Objekte (oder mit fixierten Punkten) bleiben, wo sie sind
    if (object.props?.locked || object.props?.fixed?.length) return;
    drag.current = { mode: 'move', id: object.id, start: toPlan(event), original: objects };
    svgRef.current?.setPointerCapture(event.pointerId);
  };

  const startVertexDrag = (event: ReactPointerEvent, object: PlanObject, index: number) => {
    event.stopPropagation();
    if (object.props?.locked || object.props?.fixed?.includes(index)) return;
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

  // Kantenlänge aus dem Maß-Feld übernehmen (Meter, Komma erlaubt)
  const applySegmentLength = (segment: [number, number], raw: string) => {
    if (!selected) return;
    const m = Number(raw.trim().replace(',', '.'));
    const current = toMeters(distance(selected.points[segment[0]], selected.points[segment[1]]));
    if (!Number.isFinite(m) || Math.abs(m - current) < 0.005) return;
    const result = setSegmentLength(
      selected.points,
      segment,
      TYPES[selected.type].kind === 'area',
      m * unitsPerMeter,
      selected.props?.fixed,
    );
    if (typeof result === 'string') {
      setError(result);
      return;
    }
    setError(null);
    updateSelected({ points: result });
  };

  const deleteSelected = () => {
    if (!selected) return;
    commit(objects.filter((o) => o.id !== selected.id));
    setSelectedId(null);
  };

  // Punkt auf einer Kante einfügen (in der Mitte, bei Bögen auf dem Bogen)
  const insertOnEdge = (o: PlanObject, edge: number) => {
    const closed = TYPES[o.type].kind === 'area';
    const [x, y] = edgeMidpoint(o.points, closed, o.props, unitsPerMeter, edge);
    const next = insertPoint(o.points, o.props, edge, [round(x), round(y)]);
    commit(objects.map((item) => (item.id === o.id ? { ...item, ...next } : item)));
  };

  const deletePoint = (index: number) => {
    if (!selected) return;
    const result = removePoint(selected.points, selected.props, index, TYPES[selected.type].kind === 'area');
    if (typeof result === 'string') {
      setError(result);
      return;
    }
    setError(null);
    updateSelected(result);
  };

  // Meterwert aus einem Eingabefeld (leer = 0); null bei ungültiger Eingabe
  const parseMeters = (raw: string, max: number) => {
    const value = raw.trim() ? Number(raw.trim().replace(',', '.')) : 0;
    return Number.isFinite(value) && value >= 0 && value <= max ? value : null;
  };

  const setCornerRadius = (index: number, raw: string) => {
    if (!selected) return;
    const radius = parseMeters(raw, 1000);
    if (radius === null) {
      setError('Radius bitte in Metern angeben, z. B. 0,5.');
      return;
    }
    const radii = setListValue(selected.props?.radii, selected.points.length, index, radius);
    if ((radii ?? []).join() === (selected.props?.radii ?? []).join()) return;
    setError(null);
    updateSelected({ props: { ...selected.props, radii } });
  };

  // Kante als Bogen: Richtung (1 = außen/links, -1 = innen/rechts, 0 = gerade)
  // und Radius; ohne Radius ein Halbkreis
  const setEdgeBulge = (edge: number, direction: number, raw?: string) => {
    if (!selected) return;
    const closed = TYPES[selected.type].kind === 'area';
    const [a, b] = [selected.points[edge], selected.points[(edge + 1) % selected.points.length]];
    const half = toMeters(distance(a, b)) / 2;
    const current = Math.abs(selected.props?.bulges?.[edge] ?? 0);
    let radius = raw === undefined ? current || half : parseMeters(raw, 100_000);
    if (radius === null || (direction !== 0 && radius <= 0)) {
      setError('Radius bitte in Metern angeben.');
      return;
    }
    radius = Math.max(radius, Math.ceil(half * 100) / 100);
    const edges = closed ? selected.points.length : selected.points.length - 1;
    const bulges = setListValue(selected.props?.bulges, edges, edge, direction * radius);
    setError(null);
    updateSelected({ props: { ...selected.props, bulges } });
  };

  const setDiameter = (raw: string) => {
    if (!selected) return;
    const diameter = parseMeters(raw, 1000);
    if (!diameter) {
      setError('Durchmesser bitte in Metern angeben, z. B. 1,00.');
      return;
    }
    if (Math.abs(diameter - 2 * radiusOf(selected)) < 0.005) return;
    const [c, rim] = selected.points;
    const d = distance(c, rim);
    const units = (diameter / 2) * unitsPerMeter;
    setError(null);
    updateSelected({
      points: [c, [round(c[0] + ((rim[0] - c[0]) / d) * units), round(c[1] + ((rim[1] - c[1]) / d) * units)]],
    });
  };

  // Fläche zwischen Vieleck und Kreis umstellen: Kreis gleicher Fläche um den
  // Schwerpunkt; ein Kreis wird zum Quadrat mit vollen Eckrundungen (sieht
  // gleich aus, lässt sich dann aber weiter formen)
  const setShape = (circle: boolean) => {
    if (!selected || circle === isCircle(selected.props)) return;
    // punkt- und kantenbezogene Angaben passen nicht mehr zur neuen Form
    const rest = { ...selected.props };
    delete rest.radii;
    delete rest.bulges;
    delete rest.fixed;
    delete rest.shape;
    if (circle) {
      const c = labelAnchor(selected);
      const units = Math.sqrt(areaOf(selected) / Math.PI) * unitsPerMeter;
      updateSelected({
        points: [
          [round(c[0]), round(c[1])],
          [round(c[0] + units), round(c[1])],
        ],
        props: { ...rest, shape: 'circle' },
      });
    } else {
      const [c] = selected.points;
      const units = radiusOf(selected) * unitsPerMeter;
      const r = Math.floor(radiusOf(selected) * 100) / 100;
      updateSelected({
        points: [
          [round(c[0] - units), round(c[1] - units)],
          [round(c[0] + units), round(c[1] - units)],
          [round(c[0] + units), round(c[1] + units)],
          [round(c[0] - units), round(c[1] + units)],
        ],
        props: { ...rest, radii: [r, r, r, r] },
      });
    }
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
    const body = {
      name: snapshot.name.trim() || plan.name,
      unitsPerMeter: snapshot.unitsPerMeter,
      objects: snapshot.objects,
    };
    const stillDirty = () => {
      const now = current.current;
      return (
        now.objects !== snapshot.objects ||
        now.name !== snapshot.name ||
        now.unitsPerMeter !== snapshot.unitsPerMeter
      );
    };
    // Ohne Netz (oder solange noch eine ältere Änderung wartet): in die
    // Warteschlange – auf dem Stand, auf dem die erste Änderung beruhte
    const queue = async () => {
      const waiting = await offlineDb.getOutbox(plan.id).catch(() => undefined);
      await offlineDb.putOutbox({
        planId: plan.id,
        projectId: plan.projectId,
        ...body,
        baseVersion: waiting?.baseVersion ?? plan.version,
        conflict: waiting?.conflict,
        queuedAt: Date.now(),
      });
      notifyOfflineChange();
      setDirty(stillDirty());
      setNotice('Auf dem Gerät gespeichert – wird übertragen, sobald wieder Netz da ist.');
    };
    try {
      if (!navigator.onLine || (await offlineDb.getOutbox(plan.id).catch(() => undefined))) {
        await queue();
        if (navigator.onLine) void flushOutbox();
        return;
      }
      const saved = await api.put<Plan>(`/plans/${plan.id}`, { version: plan.version, ...body });
      setPlan(saved);
      setOfflineCopy(null);
      setDirty(stillDirty());
      const cached = await offlineDb.getPlan(plan.id).catch(() => undefined);
      if (cached) await offlineDb.putPlan({ ...cached, plan: saved, name: saved.name, cachedAt: Date.now() });
    } catch (err) {
      if (isNetworkError(err)) {
        try {
          await queue();
        } catch {
          setError('Keine Verbindung und kein Offline-Speicher im Browser – bitte später speichern.');
        }
      } else setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.');
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

  // DXF im Browser lesen; zugeordnet und übernommen wird im Dialog rechts
  const readDxf = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const drawing = parseDxf(await file.text());
      if (!drawing.entities.length) {
        setError('In der DXF-Datei wurden keine übernehmbaren Elemente gefunden.');
        return;
      }
      setError(null);
      setDxf({ name: file.name, drawing });
      setTool('select');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Die DXF-Datei konnte nicht gelesen werden.');
    }
  };

  const importDxf = (imported: PlanObject[], dropped: number) => {
    const room = 2000 - objects.length;
    const taken = imported.slice(0, Math.max(0, room));
    commit([...objects, ...taken]);
    setDxf(null);
    setNotice(
      `${taken.length} Objekte aus der DXF übernommen` +
        (imported.length > taken.length
          ? ` (höchstens 2000 je Plan, ${imported.length - taken.length} ausgelassen)`
          : '') +
        (dropped ? `, ${dropped} passten nicht zur gewählten Art` : '') +
        '.',
    );
    fitPending.current = true;
  };

  // Vorschlag der Zeichnungs-KI übernehmen (wie beim DXF: höchstens 2000 Objekte)
  const drawAi = (drawn: PlanObject[], dropped: number, providerName: string) => {
    const room = 2000 - objects.length;
    const taken = drawn.slice(0, Math.max(0, room));
    commit([...objects, ...taken]);
    setNotice(
      `${taken.length} Objekte von der KI (${providerName}) eingezeichnet` +
        (dropped ? `, ${dropped} passten nicht` : '') +
        ' – bitte prüfen, rückgängig machen ist möglich.',
    );
  };

  const uploadBackground = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (file) uploadBackgroundFile(file);
  };

  const uploadBackgroundFile = (file: File) => {
    if (!plan) return;
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
    } else if (objects.some((o) => o.props?.radii || o.props?.bulges)) {
      // Objekte bleiben am Bild: Radien (in m) mit dem neuen Maßstab umrechnen
      const factor = unitsPerMeter / next;
      const scale = (list?: number[]) => list?.map((v) => Math.round(v * factor * 100) / 100);
      commit(
        objects.map((o) =>
          o.props?.radii || o.props?.bulges
            ? { ...o, props: { ...o.props, radii: scale(o.props.radii), bulges: scale(o.props.bulges) } }
            : o,
        ),
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
      if (t.kind === 'line') {
        const dn = PIPE_TYPES.includes(o.type) ? o.props?.dn : undefined;
        if (dn) add(`${o.type}:dn${dn}`, `${t.label} DN ${dn}`, 'm', lengthOf(o));
        else add(o.type, t.label, 'm', lengthOf(o));
      }
      if (t.kind === 'opening') {
        add(o.type, t.label, 'Stk', 1);
        add(`${o.type}:w`, `${t.label} (Breite gesamt)`, 'm', toMeters(polylineLength(o.points)));
      }
      if (o.type === 'manhole') {
        // Schächte zählen, runde je Durchmesser
        if (isCircle(o.props)) {
          const cm = Math.round(radiusOf(o) * 200);
          add(`manhole:d${cm}`, `${t.label} Ø ${number(cm / 100, 2)} m`, 'Stk', 1);
        } else add(o.type, t.label, 'Stk', 1);
      } else if (t.kind === 'area' && o.type !== 'building') {
        add(o.type, t.label, 'm²', areaOf(o));
        if (o.type === 'lawn' && o.props?.mowingEdge) add('lawn:edge', 'Mähkante', 'm', perimeterOf(o));
        if (o.type === 'parking' && o.props?.spaces)
          add('parking:spaces', 'Stellplätze', 'Stk', o.props.spaces);
      }
      if (t.kind === 'symbol' && o.type !== 'height_point') {
        if (o.type === 'pictogram' && o.props?.icon)
          add(`p:${o.props.icon}`, PICTOGRAMS[o.props.icon], 'Stk', 1);
        else add(o.type, t.label, 'Stk', 1);
      }
    }
    // Bögen, Abzweige, Anschlussrohre, Schachttiefen (wie im Backend)
    for (const f of pipeFittings(objects, unitsPerMeter)) add(f.key, f.label, f.unit, f.quantity);
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
    if (isCircle(o.props)) return `Ø ${meters(2 * radiusOf(o))}`;
    if (o.type === 'manhole') return null;
    if (kind === 'area') return squareMeters(areaOf(o));
    if (kind === 'line') return meters(lengthOf(o));
    if (kind === 'opening') return meters(toMeters(polylineLength(o.points)));
    return null;
  };

  const visible = objects.filter((o) => !hidden.includes(TYPES[o.type].group));

  const renderObject = (o: PlanObject) => {
    const t = TYPES[o.type];
    const isSelected = o.id === selectedId;
    const circle = isCircle(o.props);
    const d = `M${outlineOf(o)
      .map((p) => `${round(p[0])} ${round(p[1])}`)
      .join(' L')}${t.kind === 'area' ? ' Z' : ''}`;
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
              fillOpacity={paleAreas ? 0.3 : 0.85}
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
      o.props?.dn ? `DN ${o.props.dn}` : null,
      o.props?.depth !== undefined ? `${number(o.props.depth, 2)} m tief` : null,
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
        {isSelected && tool === 'select' && t.kind !== 'symbol' && t.kind !== 'text' && !circle && (
          <g data-ui pointerEvents="none" data-testid="plan-edge-labels">
            {/* Kantenlängen und Punktnamen des ausgewählten Objekts */}
            {segments(o.points.length, t.kind === 'area').map(([a, b]) => {
              const mid: Point = [
                (o.points[a][0] + o.points[b][0]) / 2,
                (o.points[a][1] + o.points[b][1]) / 2,
              ];
              return (
                <text
                  key={`${a}-${b}`}
                  x={mid[0]}
                  y={mid[1] + fontSize * 1.2}
                  fontSize={fontSize}
                  textAnchor="middle"
                  fill="#2a78d6"
                  stroke="#ffffff"
                  strokeWidth={3 * px}
                  paintOrder="stroke"
                >
                  {meters(toMeters(distance(o.points[a], o.points[b])))}
                </text>
              );
            })}
            {o.points.map((p, i) => (
              <text
                key={i}
                x={p[0] + 8 * px}
                y={p[1] - 8 * px}
                fontSize={fontSize}
                fill="#2a78d6"
                fontWeight={700}
              >
                {pointName(i)}
              </text>
            ))}
          </g>
        )}
        {isSelected &&
          canEdit &&
          tool === 'select' &&
          (t.kind === 'line' || t.kind === 'area') &&
          !circle &&
          !o.props?.locked && (
            <g data-ui>
              {/* "+" auf jeder Kante: dort einen Punkt einfügen */}
              {segments(o.points.length, t.kind === 'area').map(([a]) => {
                const [x, y] = edgeMidpoint(o.points, t.kind === 'area', o.props, unitsPerMeter, a);
                return (
                  <g
                    key={`insert-${a}`}
                    onPointerDown={(e) => {
                      e.stopPropagation();
                      insertOnEdge(o, a);
                    }}
                    style={{ cursor: 'copy' }}
                    data-testid="plan-insert-point"
                  >
                    <circle cx={x} cy={y} r={5 * px} fill="#2a78d6" fillOpacity={0.8} />
                    <path
                      d={`M${x - 3 * px} ${y} H${x + 3 * px} M${x} ${y - 3 * px} V${y + 3 * px}`}
                      stroke="#ffffff"
                      strokeWidth={1.5 * px}
                    />
                  </g>
                );
              })}
            </g>
          )}
        {isSelected && canEdit && tool === 'select' && (
          <g data-ui>
            {o.points.map((p, i) =>
              o.props?.locked || o.props?.fixed?.includes(i) ? (
                <rect
                  key={i}
                  x={p[0] - 5 * px}
                  y={p[1] - 5 * px}
                  width={10 * px}
                  height={10 * px}
                  fill="#2a78d6"
                  data-testid="plan-vertex-fixed"
                />
              ) : (
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
              ),
            )}
          </g>
        )}
      </g>
    );
  };

  const drawKind = tool !== 'select' && tool !== 'pan' && tool !== 'calibrate' ? TYPES[tool].kind : null;
  const preview = draft.length && cursor ? [...draft, cursor] : draft;
  const drawCircle = drawKind === 'area' && circleMode;
  const hint =
    tool === 'calibrate'
      ? 'Maßstab: Anfang und Ende einer bekannten Strecke anklicken (z.B. Hauslänge aus dem Plan).'
      : drawKind === 'line'
        ? 'Punkte setzen; Doppelklick oder Enter beendet, Rücktaste nimmt den letzten Punkt zurück, Umschalt = rechtwinklig.'
        : drawCircle
          ? 'Mittelpunkt anklicken, dann einen Punkt auf dem Rand (oder den Durchmesser eingeben).'
          : drawKind === 'area'
            ? 'Eckpunkte setzen; Doppelklick oder Enter schließt die Fläche. Rundungen danach im Maß-Feld.'
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
          {dirty
            ? 'nicht gespeichert'
            : pending?.conflict
              ? 'Konflikt'
              : pending
                ? 'auf dem Gerät gespeichert'
                : 'gespeichert'}
        </span>
        {(!online || offlineCopy) && (
          <span className="status-badge status-open no-print" data-testid="plan-offline">
            offline{offlineCopy ? ` · Stand ${new Date(offlineCopy).toLocaleString('de-DE')}` : ''}
          </span>
        )}
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
      {pending?.conflict && (
        <div className="job-card no-print" style={{ display: 'block' }} data-testid="plan-conflict">
          <strong>Konflikt beim Übertragen</strong>
          <p className="list-item-meta" style={{ margin: '4px 0 8px' }}>
            Deine offline gespeicherte Änderung vom {new Date(pending.queuedAt).toLocaleString('de-DE')}{' '}
            beruht auf einem älteren Stand – auf dem Server wurde der Plan inzwischen geändert (oder er ist
            nicht mehr erreichbar).
          </p>
          <div className="btn-row">
            <button
              className="btn btn-primary"
              disabled={!online || busy}
              onClick={() =>
                keepLocalVersion(pending.planId).catch((err) =>
                  setError(err instanceof ApiError ? err.message : 'Übertragen fehlgeschlagen.'),
                )
              }
              data-testid="plan-conflict-keep"
            >
              Meine Version übernehmen
            </button>
            <button
              className="btn"
              disabled={!online || busy}
              onClick={async () => {
                await discardLocalVersion(pending.planId);
                const loaded = await api.get<Plan>(`/plans/${pending.planId}`);
                apply(loaded);
              }}
              data-testid="plan-conflict-discard"
            >
              Serverstand laden (meine Änderung verwerfen)
            </button>
          </div>
        </div>
      )}
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
            {canDrawAi && (
              <button
                className={`plan-tool${aiOpen ? ' active' : ''}`}
                onClick={() => setAiOpen(!aiOpen)}
                title="Flächen, Leitungen und Symbole von der KI einzeichnen lassen"
                data-testid="plan-ai-open"
              >
                KI zeichnen
              </button>
            )}
            <label className="plan-tool" title="CAD-Zeichnung (DXF) übernehmen">
              DXF …
              <input
                type="file"
                accept=".dxf,application/dxf,image/vnd.dxf"
                onChange={readDxf}
                style={{ display: 'none' }}
                data-testid="plan-dxf"
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
                {draft.length > 0 &&
                  drawCircle &&
                  cursor &&
                  ` Ø ${meters(2 * toMeters(distance(draft[0], cursor)))}`}
                {draft.length > 1 &&
                  drawKind === 'area' &&
                  !drawCircle &&
                  cursor &&
                  ` Fläche: ${squareMeters(toMeters(toMeters(polygonArea(preview))))}`}
              </span>
              {drawKind === 'area' && (
                <label className="plan-shape-toggle">
                  <input
                    type="checkbox"
                    checked={circleMode}
                    onChange={(e) => {
                      setCircleChoice({ ...circleChoice, [tool]: e.target.checked });
                      setDraft([]);
                    }}
                    data-testid="plan-draw-circle"
                  />
                  Kreis
                </label>
              )}
              {draft.length > 0 && drawKind && drawKind !== 'symbol' && drawKind !== 'text' && (
                <span className="plan-length-entry">
                  <input
                    value={lengthEntry}
                    onChange={(e) => setLengthEntry(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        addPointAtLength();
                      }
                    }}
                    inputMode="decimal"
                    placeholder={drawCircle ? 'Ø m' : 'Länge m'}
                    aria-label={drawCircle ? 'Durchmesser in Metern' : 'Länge der nächsten Strecke in Metern'}
                    data-testid="plan-length-entry"
                  />
                  <button className="btn" onClick={addPointAtLength}>
                    Setzen
                  </button>
                </span>
              )}
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
            onPointerDownCapture={() => {
              // offene Maßeingabe übernehmen, bevor ein Klick die Auswahl wechselt
              const active = document.activeElement as HTMLElement | null;
              if (active?.closest('.plan-dimensions')) active.blur();
            }}
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
            {/* Flächen unten, Leitungen und Symbole darüber */}
            {visible.filter((o) => TYPES[o.type].kind === 'area').map(renderObject)}
            {visible.filter((o) => TYPES[o.type].kind !== 'area').map(renderObject)}
            {drawCircle && preview.length === 2 && (
              <circle
                data-ui
                cx={preview[0][0]}
                cy={preview[0][1]}
                r={distance(preview[0], preview[1])}
                fill="rgba(42,120,214,0.12)"
                stroke="#2a78d6"
                strokeWidth={2 * px}
                strokeDasharray={`${6 * px} ${4 * px}`}
                pointerEvents="none"
              />
            )}
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
          {aiOpen && plan && (
            <AiDrawing
              planId={plan.id}
              objects={objects}
              unitsPerMeter={unitsPerMeter}
              canUseBackground={!dirty && !busy}
              onDraw={drawAi}
              onBackground={uploadBackgroundFile}
              onClose={() => setAiOpen(false)}
            />
          )}
          {dxf && (
            <DxfImport
              fileName={dxf.name}
              drawing={dxf.drawing}
              unitsPerMeter={unitsPerMeter}
              newId={newId}
              onImport={importDxf}
              onCancel={() => setDxf(null)}
            />
          )}
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
                <div className="list-item-meta">Mähkante {meters(perimeterOf(selected))}</div>
              )}
              {TYPES[selected.type].kind === 'area' && (
                <div className="list-item-meta" data-testid="plan-selection-perimeter">
                  {/* bei Kreisen und Schächten steht oben der Durchmesser bzw. nichts */}
                  {(isCircle(selected.props) || selected.type === 'manhole') &&
                    `${squareMeters(areaOf(selected))} · `}
                  Umfang {meters(perimeterOf(selected))}
                </div>
              )}
              {TYPES[selected.type].kind !== 'symbol' && TYPES[selected.type].kind !== 'text' && (
                <div className="plan-dimensions" data-testid="plan-dimensions">
                  <div className="list-item-meta">Maße (m)</div>
                  {isCircle(selected.props) ? (
                    <label className="plan-dimension">
                      <span>Ø</span>
                      <input
                        key={`${selected.id}-d-${radiusOf(selected)}`}
                        defaultValue={number(2 * radiusOf(selected), 2)}
                        disabled={!canEdit || !!selected.props?.locked}
                        inputMode="decimal"
                        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                        onBlur={(e) => setDiameter(e.target.value)}
                        aria-label="Durchmesser in Metern"
                        data-testid="plan-diameter"
                      />
                    </label>
                  ) : (
                    segments(selected.points.length, TYPES[selected.type].kind === 'area').map(([a, b]) => {
                      const shaped = TYPES[selected.type].kind !== 'opening';
                      const bulge = selected.props?.bulges?.[a] ?? 0;
                      const editable = canEdit && !selected.props?.locked;
                      return (
                        <div key={`${selected.id}-${a}-${b}`} className="plan-dimension">
                          <span>
                            {pointName(a)}–{pointName(b)}
                          </span>
                          <input
                            key={`${selected.id}-${a}-${b}-${distance(selected.points[a], selected.points[b])}`}
                            defaultValue={number(
                              toMeters(distance(selected.points[a], selected.points[b])),
                              2,
                            )}
                            disabled={!editable}
                            inputMode="decimal"
                            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                            onBlur={(e) => applySegmentLength([a, b], e.target.value)}
                            aria-label={`Länge ${pointName(a)}–${pointName(b)} in Metern`}
                            data-testid="plan-segment"
                          />
                          {shaped && (
                            <select
                              value={Math.sign(bulge)}
                              disabled={!editable}
                              onChange={(e) => setEdgeBulge(a, Number(e.target.value))}
                              aria-label={`Kante ${pointName(a)}–${pointName(b)}: gerade oder Bogen`}
                              title="Kante gerade oder als Kreisbogen"
                              data-testid="plan-edge-bulge"
                            >
                              <option value={0}>gerade</option>
                              <option value={1}>
                                {TYPES[selected.type].kind === 'area' ? 'Bogen außen' : 'Bogen links'}
                              </option>
                              <option value={-1}>
                                {TYPES[selected.type].kind === 'area' ? 'Bogen innen' : 'Bogen rechts'}
                              </option>
                            </select>
                          )}
                          {shaped && bulge !== 0 && (
                            <input
                              key={`${selected.id}-${a}-r-${bulge}`}
                              className="plan-radius"
                              defaultValue={number(Math.abs(bulge), 2)}
                              disabled={!editable}
                              inputMode="decimal"
                              onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                              onBlur={(e) => setEdgeBulge(a, Math.sign(bulge), e.target.value)}
                              aria-label={`Bogenradius ${pointName(a)}–${pointName(b)} in Metern`}
                              title="Bogenradius (m)"
                              data-testid="plan-edge-radius"
                            />
                          )}
                        </div>
                      );
                    })
                  )}
                  {canEdit && !isCircle(selected.props) && (
                    <>
                      <div className="list-item-meta" style={{ marginTop: 6 }}>
                        Punkte: fixieren (bleiben beim Ändern der Maße und beim Ziehen stehen)
                        {TYPES[selected.type].kind !== 'opening' &&
                          ', Ecke abrunden (Radius m), löschen. Neue Punkte mit „+“ auf einer Kante.'}
                      </div>
                      {selected.points.map((_, i) => {
                        const fixed = selected.props?.fixed?.includes(i) ?? false;
                        const kind = TYPES[selected.type].kind;
                        // Eckradius nur an echten Ecken (nicht an Linienenden)
                        const corner =
                          kind === 'area' || (kind === 'line' && i > 0 && i < selected.points.length - 1);
                        const radius = selected.props?.radii?.[i] ?? 0;
                        // Rundung wirkt nur zwischen zwei geraden Kanten
                        const n = selected.points.length;
                        const bulges = selected.props?.bulges;
                        const nextToArc =
                          !!bulges && ((bulges[i] ?? 0) !== 0 || (bulges[(i - 1 + n) % n] ?? 0) !== 0);
                        return (
                          <div
                            key={`${selected.id}-p${i}`}
                            className="plan-dimension"
                            data-testid="plan-point"
                          >
                            <button
                              type="button"
                              className={`plan-tool${fixed ? ' active' : ''}`}
                              aria-pressed={fixed}
                              onClick={() => {
                                const list = selected.props?.fixed ?? [];
                                const next = fixed
                                  ? list.filter((x) => x !== i)
                                  : [...list, i].sort((x, y) => x - y);
                                updateSelected({
                                  props: { ...selected.props, fixed: next.length ? next : undefined },
                                });
                              }}
                              title="Punkt fixieren"
                              data-testid="plan-fix-point"
                            >
                              {fixed ? '🔒' : ''} {pointName(i)}
                            </button>
                            {corner && (
                              <input
                                key={`${selected.id}-${i}-r-${radius}`}
                                className="plan-radius"
                                defaultValue={radius ? number(radius, 2) : ''}
                                placeholder="R"
                                disabled={!!selected.props?.locked || nextToArc}
                                inputMode="decimal"
                                onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
                                onBlur={(e) => setCornerRadius(i, e.target.value)}
                                aria-label={`Eckradius ${pointName(i)} in Metern`}
                                title={
                                  nextToArc
                                    ? 'Keine Eckrundung neben einem Bogen'
                                    : 'Eckradius (m): an Außenecken Außenrundung, an einspringenden Ecken Innenrundung'
                                }
                                data-testid="plan-corner-radius"
                              />
                            )}
                            {kind !== 'opening' && (
                              <button
                                type="button"
                                className="plan-tool"
                                onClick={() => deletePoint(i)}
                                disabled={!!selected.props?.locked}
                                aria-label={`Punkt ${pointName(i)} löschen`}
                                title="Punkt löschen"
                                data-testid="plan-delete-point"
                              >
                                ×
                              </button>
                            )}
                          </div>
                        );
                      })}
                    </>
                  )}
                  {canEdit && (
                    <>
                      <label style={{ display: 'flex', gap: 6, alignItems: 'center', margin: '6px 0' }}>
                        <input
                          type="checkbox"
                          checked={!!selected.props?.locked}
                          onChange={(e) =>
                            updateSelected({
                              props: { ...selected.props, locked: e.target.checked || undefined },
                            })
                          }
                          data-testid="plan-lock"
                        />
                        Lage fixieren (nicht verschieben)
                      </label>
                    </>
                  )}
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
                          // Nennweite nur bei Leitungen mit DN, Tiefe nicht beim Zaun
                          const { dn, depth, height, ...rest } = selected.props ?? {};
                          const keepsHeight = TYPES[type].kind === 'area' || type === 'height_point';
                          updateSelected({
                            type,
                            props:
                              type === 'pictogram'
                                ? { icon: selected.props?.icon ?? 'tree' }
                                : {
                                    ...rest,
                                    ...(dn !== undefined && PIPE_TYPES.includes(type) ? { dn } : {}),
                                    ...(depth !== undefined && type !== 'fence' ? { depth } : {}),
                                    ...(height !== undefined && keepsHeight ? { height } : {}),
                                  },
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
                  {TYPES[selected.type].kind === 'area' && (
                    <label className="field">
                      <span>Form</span>
                      <select
                        value={isCircle(selected.props) ? 'circle' : 'polygon'}
                        onChange={(e) => setShape(e.target.value === 'circle')}
                        disabled={!!selected.props?.locked}
                        data-testid="plan-shape"
                      >
                        <option value="polygon">Vieleck (Ecken, Rundungen, Bögen)</option>
                        <option value="circle">Kreis (Durchmesser)</option>
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
                  {PIPE_TYPES.includes(selected.type) && (
                    <label className="field">
                      <span>Nennweite (DN)</span>
                      <select
                        value={selected.props?.dn ?? ''}
                        onChange={(e) =>
                          updateSelected({
                            props: {
                              ...selected.props,
                              dn: e.target.value ? Number(e.target.value) : undefined,
                            },
                          })
                        }
                        data-testid="plan-dn"
                      >
                        <option value="">– ohne –</option>
                        {DN_OPTIONS.map((dn) => (
                          <option key={dn} value={dn}>
                            DN {dn}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {TYPES[selected.type].kind === 'line' && selected.type !== 'fence' && (
                    <label className="field">
                      <span>Verlegetiefe (m)</span>
                      <input
                        key={selected.id}
                        defaultValue={
                          selected.props?.depth !== undefined ? number(selected.props.depth, 2) : ''
                        }
                        onBlur={(e) => {
                          const raw = e.target.value.trim().replace(',', '.');
                          const depth = raw ? Number(raw) : undefined;
                          if (depth !== undefined && (!Number.isFinite(depth) || depth < 0 || depth > 20)) {
                            setError('Verlegetiefe bitte in Metern zwischen 0 und 20 angeben.');
                            return;
                          }
                          if (depth !== selected.props?.depth)
                            updateSelected({ props: { ...selected.props, depth } });
                        }}
                        inputMode="decimal"
                        placeholder="Standard 0,50"
                        data-testid="plan-depth"
                      />
                    </label>
                  )}
                  {(TYPES[selected.type].kind === 'area' || selected.type === 'height_point') && (
                    <label className="field">
                      <span>Höhe über Bezug (m, unter Bezug mit −)</span>
                      <input
                        key={`h-${selected.id}`}
                        defaultValue={
                          selected.props?.height !== undefined ? number(selected.props.height, 2) : ''
                        }
                        onBlur={(e) => {
                          const raw = e.target.value.trim().replace(',', '.').replace('−', '-');
                          const height = raw ? Number(raw) : undefined;
                          if (height !== undefined && (!Number.isFinite(height) || Math.abs(height) > 100)) {
                            setError('Höhe bitte in Metern angeben (z. B. 0,15 oder −0,30).');
                            return;
                          }
                          if (height !== selected.props?.height)
                            updateSelected({ props: { ...selected.props, height } });
                        }}
                        inputMode="decimal"
                        placeholder="Standard 0"
                        data-testid="plan-height"
                      />
                    </label>
                  )}
                  {TYPES[selected.type].kind !== 'text' && TYPES[selected.type].kind !== 'symbol' && (
                    <div className="field">
                      <span>Größe ändern</span>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <input
                          value={scalePercent}
                          onChange={(e) => setScalePercent(e.target.value)}
                          inputMode="decimal"
                          style={{ width: 80 }}
                          aria-label="Größe in Prozent"
                          data-testid="plan-scale"
                        />
                        <button
                          type="button"
                          className="btn btn-sm"
                          disabled={!!selected.props?.locked || !!selected.props?.fixed?.length}
                          title={
                            selected.props?.locked || selected.props?.fixed?.length
                              ? 'Fixierte Objekte lassen sich nicht skalieren'
                              : undefined
                          }
                          onClick={() => {
                            const factor = Number(scalePercent.replace(',', '.')) / 100;
                            if (!Number.isFinite(factor) || factor <= 0 || factor > 100) {
                              setError('Größe bitte in Prozent angeben, z. B. 150 oder 50.');
                              return;
                            }
                            updateSelected(scaleObject(selected, factor));
                          }}
                          data-testid="plan-scale-apply"
                        >
                          % anwenden
                        </button>
                      </div>
                    </div>
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

          <div className="job-card no-print" style={{ display: 'block' }} data-testid="plan-layers">
            <strong>Ebenen</strong>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 12px', marginTop: 6 }}>
              {GROUPS.map((group) => (
                <label
                  key={group}
                  className="list-item-meta"
                  style={{ display: 'flex', gap: 4, alignItems: 'center' }}
                >
                  <input
                    type="checkbox"
                    checked={!hidden.includes(group)}
                    onChange={(e) =>
                      setHidden(e.target.checked ? hidden.filter((g) => g !== group) : [...hidden, group])
                    }
                    data-testid={`plan-layer-${group}`}
                  />
                  {group}
                </label>
              ))}
              <label className="list-item-meta" style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                <input
                  type="checkbox"
                  checked={paleAreas}
                  onChange={(e) => setPaleAreas(e.target.checked)}
                  data-testid="plan-pale-areas"
                />
                Flächen blass
              </label>
            </div>
          </div>

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
            {quantities.length > 0 && (
              <button
                className="btn btn-sm no-print"
                onClick={() => {
                  // Einkaufsliste für Excel: Semikolon, Dezimalkomma, BOM für Umlaute
                  const lines = [
                    'Position;Menge;Einheit',
                    ...quantities.map(
                      ([, row]) =>
                        `"${row.label.replace(/"/g, '""')}";${number(row.quantity, row.unit === 'Stk' ? 0 : 2)};${row.unit}`,
                    ),
                  ];
                  const url = URL.createObjectURL(
                    new Blob(['\ufeff' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }),
                  );
                  const link = document.createElement('a');
                  link.href = url;
                  link.download = `${name || 'Lageplan'} – Mengenliste.csv`;
                  link.click();
                  setTimeout(() => URL.revokeObjectURL(url), 60_000);
                }}
                data-testid="plan-quantities-csv"
              >
                Mengenliste als CSV (Einkaufsliste)
              </button>
            )}
            {canQuote && quantities.length > 0 && !quoteOpen && (
              <button
                className="btn no-print"
                disabled={dirty}
                title={dirty ? 'Bitte zuerst speichern' : undefined}
                onClick={() => setQuoteOpen(true)}
                data-testid="plan-to-quote"
              >
                Ins Angebot übernehmen{dirty ? ' (erst speichern)' : ''}
              </button>
            )}
            <p className="list-item-meta">
              Maßstab: {number(unitsPerMeter, 1)} Einheiten je Meter
              {!plan.background && ' (Raster 1 m)'}
            </p>
          </div>

          {quoteOpen && !dirty && (
            <QuoteFromPlan planId={plan.id} projectId={plan.projectId} onClose={() => setQuoteOpen(false)} />
          )}

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
