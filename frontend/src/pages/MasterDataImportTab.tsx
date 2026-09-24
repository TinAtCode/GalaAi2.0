import { ChangeEvent, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client';
import { formatEuro } from '../format';

type EntityType = 'customers' | 'suppliers' | 'articles' | 'machines';
type Mapping = Record<string, string | null>;
type Value = string | number | boolean | null;
type Status = 'new' | 'update' | 'unchanged' | 'duplicate' | 'invalid';

interface Session {
  sessionId: string;
  source: string;
  headers: string[];
  rowCount: number;
  sample: string[][];
  entity: EntityType;
  entities: {
    type: EntityType;
    label: string;
    fields: { key: string; label: string; required: boolean }[];
    suggested: Mapping;
  }[];
}

interface PreviewRow {
  index: number;
  status: Status;
  values: Record<string, Value>;
  errors: string[];
  changes: { field: string; label: string; old: Value; new: Value }[];
  matchLabel: string | null;
  matchedBy: string | null;
  similar: { id: string; label: string }[];
  preselected: boolean;
}

interface Preview {
  summary: Record<Status | 'total', number>;
  rows: PreviewRow[];
}

const STATUS: Record<Status, { label: string; badge: string }> = {
  new: { label: 'Neu', badge: 'status-planned' },
  update: { label: 'Geändert', badge: 'status-in_progress' },
  duplicate: { label: 'Mögliche Dublette', badge: 'status-draft' },
  unchanged: { label: 'Unverändert', badge: '' },
  invalid: { label: 'Fehler', badge: 'status-cancelled' },
};
const MONEY = new Set(['purchasePrice', 'salePrice', 'hourlyRate']);
const SHOWN = 300;

const show = (field: string, value: Value) => {
  if (value === null || value === undefined || value === '') return '–';
  if (typeof value === 'boolean') return value ? 'ja' : 'nein';
  if (MONEY.has(field)) return formatEuro(value);
  return String(value);
};

// Stammdaten aus beliebigen Quellen: Excel, CSV, eingefügter Text, JSON,
// vCard. Spalten zuordnen, mit dem Bestand abgleichen, Zeilen auswählen.
export function MasterDataImportTab() {
  const [session, setSession] = useState<Session | null>(null);
  const [entity, setEntity] = useState<EntityType>('customers');
  const [mapping, setMapping] = useState<Mapping>({});
  const [preview, setPreview] = useState<Preview | null>(null);
  const [accepted, setAccepted] = useState<Set<number>>(new Set());
  const [filter, setFilter] = useState<Status | 'all'>('all');
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const definition = session?.entities.find((e) => e.type === entity);
  const complete = !!definition && definition.fields.every((f) => !f.required || mapping[f.key]);

  const start = (next: Session) => {
    setSession(next);
    setEntity(next.entity);
    setMapping(next.entities.find((e) => e.type === next.entity)!.suggested);
    setPreview(null);
    setFilter('all');
  };

  const run = async (action: () => Promise<void>, fallback: string) => {
    setBusy(true);
    setError(null);
    try {
      await action();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : fallback);
    } finally {
      setBusy(false);
    }
  };

  const upload = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setResult(null);
    void run(
      async () => start(await api.upload<Session>('/master-data-import/upload', file)),
      'Die Datei konnte nicht gelesen werden.',
    );
  };

  const readText = () => {
    setResult(null);
    void run(async () => {
      start(await api.post<Session>('/master-data-import/text', { text }));
      setText('');
    }, 'Der Text konnte nicht gelesen werden.');
  };

  // Vorschau neu berechnen, sobald Datenart oder Zuordnung sich ändern
  useEffect(() => {
    if (!session || !definition) return;
    if (definition.fields.some((f) => f.required && !mapping[f.key])) return;
    let current = true;
    api
      .post<Preview>(`/master-data-import/${session.sessionId}/preview`, { entity, mapping })
      .then((next) => {
        if (!current) return;
        setPreview(next);
        setError(null);
        setAccepted(new Set(next.rows.filter((r) => r.preselected).map((r) => r.index)));
      })
      .catch((err) => {
        if (!current) return;
        setPreview(null);
        setError(err instanceof ApiError ? err.message : 'Vorschau fehlgeschlagen.');
      });
    return () => {
      current = false;
    };
  }, [session, definition, entity, mapping]);

  const changeEntity = (next: EntityType) => {
    setEntity(next);
    setMapping(session!.entities.find((e) => e.type === next)!.suggested);
    setFilter('all');
  };

  const apply = () =>
    run(async () => {
      const res = await api.post<{
        created: number;
        updated: number;
        skipped: { row: number; reason: string }[];
      }>(`/master-data-import/${session!.sessionId}/apply`, { entity, mapping, accept: [...accepted] });
      setResult(
        `Übernommen: ${res.created} neu, ${res.updated} geändert${res.skipped.length ? `, ${res.skipped.length} ausgelassen` : ''}.`,
      );
      setSession(null);
      setPreview(null);
    }, 'Die Übernahme ist fehlgeschlagen – es wurde nichts geändert.');

  const discard = () => {
    if (session) void api.delete(`/master-data-import/${session.sessionId}`).catch(() => undefined);
    setSession(null);
    setPreview(null);
  };

  const rows = useMemo(
    () => (preview?.rows ?? []).filter((r) => filter === 'all' || r.status === filter),
    [preview, filter],
  );
  const selectable = (row: PreviewRow) => row.status !== 'invalid' && row.status !== 'unchanged';
  const toggle = (index: number) => {
    const next = new Set(accepted);
    if (next.has(index)) next.delete(index);
    else next.add(index);
    setAccepted(next);
  };
  const title = (row: PreviewRow) =>
    [row.values.articleNumber, row.values.name].filter(Boolean).join(' · ') || `Zeile ${row.index + 2}`;

  return (
    <div data-testid="masterdata-import">
      {!session && (
        <section className="card">
          <h3>Stammdaten importieren</h3>
          <p className="list-item-meta" style={{ marginTop: 4 }}>
            Kunden, Lieferanten, Artikel oder Maschinen aus einer Excel-Datei (.xlsx), CSV, JSON, Kontakten
            (vCard aus Outlook oder dem Handy) oder aus Excel kopiert. Vor der Übernahme siehst du, was neu
            ist, was sich ändert und was es schon gibt.
          </p>
          <div className="btn-row" style={{ marginTop: 12 }}>
            <label className="btn btn-primary">
              {busy ? 'Liest …' : 'Datei wählen …'}
              <input
                type="file"
                accept=".csv,.txt,.tsv,.xlsx,.json,.vcf,text/csv,text/plain,application/json,text/vcard,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                onChange={upload}
                style={{ display: 'none' }}
                disabled={busy}
                data-testid="import-file"
              />
            </label>
          </div>
          <label className="field" style={{ marginTop: 14 }}>
            <span>… oder Tabelle hier einfügen (mit Kopfzeile)</span>
            <textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'Name\tE-Mail\tPLZ\tOrt\nMüller GmbH\tinfo@mueller.de\t50667\tKöln'}
              rows={5}
              data-testid="import-text"
            />
          </label>
          <button
            className="btn"
            style={{ marginTop: 8 }}
            disabled={busy || !text.trim()}
            onClick={readText}
            data-testid="import-text-read"
          >
            Einlesen
          </button>
          {result && (
            <p className="notice" style={{ marginTop: 12 }} data-testid="import-result">
              {result}
            </p>
          )}
          {error && (
            <p className="field-error" style={{ marginTop: 10 }}>
              {error}
            </p>
          )}
        </section>
      )}

      {session && definition && (
        <section className="card" data-testid="import-mapping">
          <div className="card-header">
            <h3>
              {session.source} <span className="list-item-meta">({session.rowCount} Zeilen)</span>
            </h3>
            <button className="btn btn-sm btn-ghost" onClick={discard}>
              Andere Quelle
            </button>
          </div>
          <div
            className="segmented"
            role="group"
            aria-label="Was wird importiert?"
            style={{ marginBottom: 14 }}
          >
            {session.entities.map((e) => (
              <button
                key={e.type}
                aria-pressed={entity === e.type}
                onClick={() => changeEntity(e.type)}
                data-testid={`import-entity-${e.type}`}
              >
                {e.label}
              </button>
            ))}
          </div>
          <div className="import-mapping">
            {definition.fields.map((field) => (
              <label key={field.key} className="field">
                <span>
                  {field.label}
                  {field.required ? ' *' : ''}
                </span>
                <select
                  value={mapping[field.key] ?? ''}
                  onChange={(e) => setMapping({ ...mapping, [field.key]: e.target.value || null })}
                  data-testid={`import-map-${field.key}`}
                >
                  <option value="">– nicht übernehmen –</option>
                  {session.headers.map((h) => (
                    <option key={h} value={h}>
                      {h}
                      {session.sample[0]?.[session.headers.indexOf(h)]
                        ? ` (z.B. ${session.sample[0][session.headers.indexOf(h)].slice(0, 24)})`
                        : ''}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
          {definition.fields.some((f) => f.required && !mapping[f.key]) && (
            <p className="list-item-meta" style={{ marginTop: 10 }}>
              Pflichtfelder (*) zuordnen, dann erscheint die Vorschau.
            </p>
          )}
          {error && (
            <p className="field-error" style={{ marginTop: 10 }}>
              {error}
            </p>
          )}
        </section>
      )}

      {session && preview && complete && (
        <section className="card" data-testid="import-preview">
          <div className="chip-group" role="group" aria-label="Filter" style={{ marginBottom: 12 }}>
            {(['all', 'new', 'update', 'duplicate', 'invalid', 'unchanged'] as const).map((key) => (
              <button
                key={key}
                className="chip"
                aria-pressed={filter === key}
                onClick={() => setFilter(key)}
                data-testid={`import-filter-${key}`}
              >
                {key === 'all' ? 'Alle' : STATUS[key].label}{' '}
                {key === 'all' ? preview.summary.total : preview.summary[key]}
              </button>
            ))}
          </div>
          <div className="table-scroll">
            <table className="data-table import-table">
              <thead>
                <tr>
                  <th style={{ width: 36 }} />
                  <th>Zeile</th>
                  <th>Eintrag</th>
                  <th>Abgleich</th>
                </tr>
              </thead>
              <tbody>
                {rows.slice(0, SHOWN).map((row) => (
                  <tr key={row.index} data-testid="import-row" data-status={row.status}>
                    <td>
                      <input
                        type="checkbox"
                        checked={accepted.has(row.index)}
                        disabled={!selectable(row)}
                        onChange={() => toggle(row.index)}
                        aria-label={`Zeile ${row.index + 2} übernehmen`}
                      />
                    </td>
                    <td className="list-item-meta">{row.index + 2}</td>
                    <td style={{ textAlign: 'left' }}>
                      <div className="list-item-name">{title(row)}</div>
                      <div className="list-item-meta">
                        {definition!.fields
                          .filter(
                            (f) => !['name', 'articleNumber'].includes(f.key) && row.values[f.key] != null,
                          )
                          .map((f) => `${f.label}: ${show(f.key, row.values[f.key])}`)
                          .join(' · ')}
                      </div>
                    </td>
                    <td style={{ textAlign: 'left' }}>
                      <span className={`status-badge ${STATUS[row.status].badge}`}>
                        {STATUS[row.status].label}
                      </span>
                      {row.matchLabel && (
                        <div className="list-item-meta">
                          {row.matchLabel} (über {row.matchedBy})
                        </div>
                      )}
                      {row.changes.map((c) => (
                        <div key={c.field} className="import-change">
                          {c.label}: <s>{show(c.field, c.old)}</s> → <strong>{show(c.field, c.new)}</strong>
                        </div>
                      ))}
                      {row.similar.length > 0 && (
                        <div className="list-item-meta">
                          ähnlich wie {row.similar.map((s) => s.label).join(', ')} – nur übernehmen, wenn es
                          ein anderer Eintrag ist
                        </div>
                      )}
                      {row.errors.map((e) => (
                        <div key={e} className="field-error">
                          {e}
                        </div>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {rows.length > SHOWN && (
            <p className="list-item-meta" style={{ marginTop: 8 }}>
              {rows.length - SHOWN} weitere Zeilen – die Auswahl gilt auch für sie.
            </p>
          )}
          <div className="btn-row" style={{ marginTop: 16 }}>
            <button
              className="btn btn-primary"
              disabled={busy || accepted.size === 0}
              onClick={apply}
              data-testid="import-apply"
            >
              {accepted.size} {accepted.size === 1 ? 'Eintrag' : 'Einträge'} übernehmen
            </button>
            <button className="btn btn-ghost" onClick={discard}>
              Verwerfen
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
