import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { InlineEdit } from '../layout/InlineEdit';

interface Component {
  id: string;
  quantityPer: string;
  laborMinutes: number | null;
  machineMinutes: number | null;
  article: { name: string; unit: string } | null;
  machine: { name: string } | null;
}

interface Service {
  id: string;
  name: string;
  unit: string;
  components: Component[];
}

interface Option {
  id: string;
  name: string;
  unit?: string;
}

type ComponentKind = 'article' | 'labor' | 'machine';

function describe(c: Component): string {
  if (c.article)
    return `${Number(c.quantityPer).toLocaleString('de-DE')} ${c.article.unit} ${c.article.name}`;
  if (c.machine) return `${c.machineMinutes} Min. ${c.machine.name}`;
  return `${c.laborMinutes} Min. Arbeitszeit`;
}

// Leistungen mit Rezeptur: je Einheit Material, Arbeitszeit und Maschinen.
// Die Kalkulation rechnet daraus Kosten und Verkaufspreis.
export function ServicesTab({ canWrite }: { canWrite: boolean }) {
  const [services, setServices] = useState<Service[] | null>(null);
  const [articles, setArticles] = useState<Option[]>([]);
  const [machines, setMachines] = useState<Option[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [newService, setNewService] = useState({ name: '', unit: '' });
  const [draft, setDraft] = useState<Record<string, { kind: ComponentKind; refId: string; amount: string }>>(
    {},
  );

  const load = useCallback(
    () =>
      api
        .get<Service[]>('/services')
        .then(setServices)
        .catch((e) =>
          setError(e instanceof ApiError ? e.message : 'Leistungen konnten nicht geladen werden.'),
        ),
    [],
  );

  useEffect(() => {
    load();
    api
      .get<Option[]>('/articles')
      .then(setArticles)
      .catch(() => setArticles([]));
    api
      .get<Option[]>('/machines')
      .then(setMachines)
      .catch(() => setMachines([]));
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await load();
      return true;
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Speichern fehlgeschlagen.');
      return false;
    }
  };

  const createService = async (event: FormEvent) => {
    event.preventDefault();
    if (await run(() => api.post('/services', newService))) setNewService({ name: '', unit: '' });
  };

  const addComponent = async (event: FormEvent, serviceId: string) => {
    event.preventDefault();
    const d = draft[serviceId] ?? { kind: 'labor', refId: '', amount: '' };
    const amount = Number(d.amount.replace(',', '.'));
    const body =
      d.kind === 'article'
        ? { articleId: d.refId, quantityPer: amount }
        : d.kind === 'machine'
          ? { machineId: d.refId, machineMinutes: Math.round(amount) }
          : { laborMinutes: Math.round(amount) };
    if (await run(() => api.post(`/services/${serviceId}/components`, body))) {
      setDraft({ ...draft, [serviceId]: { kind: d.kind, refId: '', amount: '' } });
    }
  };

  return (
    <div>
      {error && <p className="field-error">{error}</p>}
      {services === null && <p>Lädt …</p>}
      {services?.length === 0 && <p className="list-item-meta">Noch keine Leistungen angelegt.</p>}

      {services?.map((service) => {
        const d = draft[service.id] ?? { kind: 'labor' as ComponentKind, refId: '', amount: '' };
        const setD = (patch: Partial<typeof d>) => setDraft({ ...draft, [service.id]: { ...d, ...patch } });
        const options = d.kind === 'article' ? articles : d.kind === 'machine' ? machines : [];
        return (
          <article key={service.id} className="job-card" data-testid="service-card">
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <div className="job-card-task">
                {service.name} <span className="list-item-meta">je {service.unit}</span>
              </div>
              {canWrite && (
                <InlineEdit
                  testId="service"
                  fields={[
                    { key: 'name', label: 'Bezeichnung' },
                    { key: 'unit', label: 'Einheit' },
                  ]}
                  initial={service}
                  onSave={async (values) => {
                    await run(() => api.patch(`/services/${service.id}`, values));
                  }}
                />
              )}
            </div>

            {service.components.length === 0 && <p className="list-item-meta">Noch keine Bestandteile.</p>}
            {service.components.map((c) => (
              <div key={c.id} className="list-item" data-testid="service-component">
                <div className="list-item-meta">{describe(c)}</div>
                {canWrite && (
                  <button
                    className="btn"
                    onClick={() => run(() => api.delete(`/services/${service.id}/components/${c.id}`))}
                    data-testid="service-component-remove"
                  >
                    Entfernen
                  </button>
                )}
              </div>
            ))}

            {canWrite && (
              <form
                onSubmit={(e) => addComponent(e, service.id)}
                className="form-row"
                style={{ marginTop: 10 }}
              >
                <select
                  value={d.kind}
                  onChange={(e) => setD({ kind: e.target.value as ComponentKind, refId: '' })}
                  data-testid="component-kind"
                >
                  <option value="labor">Arbeitszeit (Min.)</option>
                  <option value="article">Material</option>
                  <option value="machine">Maschine (Min.)</option>
                </select>
                {d.kind !== 'labor' && (
                  <select
                    value={d.refId}
                    onChange={(e) => setD({ refId: e.target.value })}
                    required
                    data-testid="component-ref"
                  >
                    <option value="">– auswählen –</option>
                    {options.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                        {o.unit ? ` (${o.unit})` : ''}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  placeholder={d.kind === 'article' ? 'Menge je Einheit' : 'Minuten je Einheit'}
                  inputMode="decimal"
                  value={d.amount}
                  onChange={(e) => setD({ amount: e.target.value })}
                  required
                  data-testid="component-amount"
                />
                <button type="submit" className="btn btn-primary" data-testid="component-add">
                  Hinzufügen
                </button>
              </form>
            )}
          </article>
        );
      })}

      {canWrite && (
        <form onSubmit={createService} className="form-row" style={{ marginTop: 20 }}>
          <input
            placeholder="Leistung, z.B. 1 m² Pflaster verlegen"
            value={newService.name}
            onChange={(e) => setNewService({ ...newService, name: e.target.value })}
            minLength={2}
            required
            data-testid="service-new-name"
          />
          <input
            placeholder="Einheit, z.B. m2"
            value={newService.unit}
            onChange={(e) => setNewService({ ...newService, unit: e.target.value })}
            required
            data-testid="service-new-unit"
          />
          <button type="submit" className="btn btn-primary" data-testid="service-new-submit">
            Leistung anlegen
          </button>
        </form>
      )}
    </div>
  );
}
