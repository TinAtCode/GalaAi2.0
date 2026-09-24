import { useMemo, useState } from 'react';
import { GROUPS, ObjectType, PlanObject, TYPES } from './catalog';
import { DxfDrawing, guessType, toPlanObjects } from './dxf';

const UNITS: [number, string][] = [
  [0.001, 'Millimeter'],
  [0.01, 'Zentimeter'],
  [0.1, 'Dezimeter'],
  [1, 'Meter'],
];

// Zuordnung der CAD-Layer zu Objektarten und Übernahme in den Plan
export function DxfImport({
  fileName,
  drawing,
  unitsPerMeter,
  newId,
  onImport,
  onCancel,
}: {
  fileName: string;
  drawing: DxfDrawing;
  unitsPerMeter: number;
  newId: () => string;
  onImport: (objects: PlanObject[], dropped: number) => void;
  onCancel: () => void;
}) {
  const layers = useMemo(() => {
    const map = new Map<string, DxfDrawing['entities']>();
    for (const e of drawing.entities) map.set(e.layer, [...(map.get(e.layer) ?? []), e]);
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b, 'de'));
  }, [drawing]);
  const [types, setTypes] = useState<Record<string, ObjectType | null>>(() =>
    Object.fromEntries(
      layers.map(([layer, entities]) => [
        layer,
        guessType(
          layer,
          entities.map((e) => e.kind),
        ),
      ]),
    ),
  );
  const [metersPerUnit, setMetersPerUnit] = useState(drawing.metersPerUnit ?? 1);

  const preview = useMemo(
    () => toPlanObjects(drawing, { metersPerUnit, unitsPerMeter, types, newId: () => 'preview' }),
    [drawing, metersPerUnit, unitsPerMeter, types],
  );

  const counts = (entities: DxfDrawing['entities']) => {
    const n = (kind: string) => entities.filter((e) => e.kind === kind).length;
    return [
      n('polyline') && `${n('polyline')} Linien`,
      n('circle') && `${n('circle')} Kreise`,
      n('point') && `${n('point')} Punkte`,
      n('text') && `${n('text')} Texte`,
    ]
      .filter(Boolean)
      .join(', ');
  };

  return (
    <div className="job-card" style={{ display: 'block' }} data-testid="dxf-import">
      <strong>DXF übernehmen: {fileName}</strong>
      <p className="list-item-meta" style={{ margin: '4px 0 10px' }}>
        Je Layer die Objektart wählen; „auslassen“ übernimmt den Layer nicht.
        {drawing.skipped > 0 &&
          ` ${drawing.skipped} nicht unterstützte Elemente (z. B. Schraffuren, Blöcke).`}
      </p>
      <label className="field">
        <span>
          Zeichnungseinheit{drawing.metersPerUnit === null ? ' (in der Datei nicht angegeben)' : ''}
        </span>
        <select
          value={metersPerUnit}
          onChange={(e) => setMetersPerUnit(Number(e.target.value))}
          data-testid="dxf-unit"
        >
          {UNITS.map(([value, label]) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <div style={{ marginTop: 8 }}>
        {layers.map(([layer, entities]) => (
          <label key={layer} className="field" style={{ marginBottom: 6 }}>
            <span>
              <strong style={{ color: 'var(--color-ink)' }}>{layer}</strong> · {counts(entities)}
            </span>
            <select
              value={types[layer] ?? ''}
              onChange={(e) => setTypes({ ...types, [layer]: (e.target.value || null) as ObjectType | null })}
              data-testid="dxf-layer"
              data-layer={layer}
            >
              <option value="">– auslassen –</option>
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
        ))}
      </div>
      <p className="list-item-meta" data-testid="dxf-summary">
        {preview.objects.length} Objekte werden übernommen
        {preview.dropped > 0
          ? `, ${preview.dropped} passen nicht zur gewählten Art (z. B. offene Linie als Fläche)`
          : ''}
        .
      </p>
      <div className="btn-row">
        <button
          className="btn btn-primary"
          disabled={!preview.objects.length}
          onClick={() => {
            const result = toPlanObjects(drawing, { metersPerUnit, unitsPerMeter, types, newId });
            onImport(result.objects, result.dropped);
          }}
          data-testid="dxf-apply"
        >
          Übernehmen
        </button>
        <button className="btn" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </div>
  );
}
