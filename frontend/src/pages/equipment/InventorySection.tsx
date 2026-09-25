import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { KIND, EquipmentKind } from './types';

interface Count {
  id: string;
  title: string;
  createdAt: string;
  closedAt: string | null;
  _count: { items: number };
}

interface CountDetail {
  id: string;
  title: string;
  closedAt: string | null;
  rows: {
    equipment: {
      id: string;
      name: string;
      kind: EquipmentKind;
      inventoryNumber: string | null;
      location: string | null;
    };
    item: { found: boolean; location: string | null; note: string | null } | null;
  }[];
  summary: { total: number; found: number; missing: number; open: number };
}

// Inventur: Durchgang starten (Büro), jedes Gerät als vorhanden oder fehlend
// abhaken (auch auf dem Handy), abschließen übernimmt Datum und Standort.
export function InventorySection({ canManage }: { canManage: boolean }) {
  const [counts, setCounts] = useState<Count[] | null>(null);
  const [detail, setDetail] = useState<CountDetail | null>(null);
  const [title, setTitle] = useState(`Inventur ${new Date().getFullYear()}`);
  const [error, setError] = useState<string | null>(null);

  const open = useCallback((id: string) => {
    api
      .get<CountDetail>(`/inventory-counts/${id}`)
      .then(setDetail)
      .catch(() => setError('Inventur konnte nicht geladen werden.'));
  }, []);

  const load = useCallback(() => {
    api
      .get<Count[]>('/inventory-counts')
      .then((list) => {
        setCounts(list);
        const running = list.find((c) => !c.closedAt);
        if (running) open(running.id);
      })
      .catch(() => setError('Inventuren konnten nicht geladen werden.'));
  }, [open]);
  useEffect(load, [load]);

  const start = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api.post('/inventory-counts', { title });
      setError(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Starten fehlgeschlagen.');
    }
  };

  const mark = async (equipmentId: string, found: boolean, location?: string) => {
    if (!detail) return;
    try {
      await api.put(`/inventory-counts/${detail.id}/items/${equipmentId}`, { found, location });
      open(detail.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.');
    }
  };

  const close = async () => {
    if (!detail) return;
    if (
      detail.summary.open > 0 &&
      !window.confirm(`${detail.summary.open} Geräte sind noch nicht gezählt. Trotzdem abschließen?`)
    )
      return;
    try {
      await api.post(`/inventory-counts/${detail.id}/close`);
      open(detail.id);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Abschließen fehlgeschlagen.');
    }
  };

  const running = counts?.find((c) => !c.closedAt);

  return (
    <div data-testid="inventory">
      {error && <p className="field-error">{error}</p>}
      {counts === null && !error && <p>Lädt …</p>}
      {counts && !running && canManage && (
        <form className="toolbar" onSubmit={start}>
          <label className="inline-field">
            <span>Neue Inventur</span>
            <input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} />
          </label>
          <button className="btn btn-primary" type="submit" data-testid="inventory-start">
            Inventur starten
          </button>
        </form>
      )}
      {counts && !running && !canManage && <p className="list-item-meta">Zurzeit läuft keine Inventur.</p>}

      {detail && (
        <div className="card" style={{ marginBottom: 16 }}>
          <div className="toolbar" style={{ marginBottom: 8 }}>
            <strong>{detail.title}</strong>
            <span className="list-item-meta" data-testid="inventory-summary">
              {detail.summary.found} vorhanden · {detail.summary.missing} fehlen · {detail.summary.open} offen
              {detail.closedAt &&
                ` · abgeschlossen am ${new Date(detail.closedAt).toLocaleDateString('de-DE')}`}
            </span>
            {!detail.closedAt && canManage && (
              <button className="btn" onClick={() => void close()} data-testid="inventory-close">
                Abschließen
              </button>
            )}
          </div>
          <div className="list">
            {detail.rows.map(({ equipment: e, item }) => (
              <div key={e.id} className="list-item" data-testid="inventory-row">
                <div>
                  <div className="list-item-name">
                    {e.name}
                    {e.inventoryNumber && <span className="list-item-meta"> · {e.inventoryNumber}</span>}
                  </div>
                  <div className="list-item-meta">
                    {KIND[e.kind]}
                    {(item?.location || e.location) && ` · ${item?.location || e.location}`}
                    {item && (item.found ? ' · vorhanden' : ' · fehlt')}
                  </div>
                </div>
                {!detail.closedAt && (
                  <div className="btn-row">
                    <button
                      className={`btn btn-sm ${item?.found ? 'btn-primary' : ''}`}
                      onClick={() => void mark(e.id, true, item?.location ?? undefined)}
                      data-testid="inventory-found"
                    >
                      Vorhanden
                    </button>
                    <button
                      className={`btn btn-sm ${item && !item.found ? 'btn-primary' : ''}`}
                      onClick={() => void mark(e.id, false)}
                      data-testid="inventory-missing"
                    >
                      Fehlt
                    </button>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {counts && counts.filter((c) => c.closedAt).length > 0 && (
        <>
          <h3>Frühere Inventuren</h3>
          <div className="list">
            {counts
              .filter((c) => c.closedAt)
              .map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className="list-item list-item-link"
                  onClick={() => open(c.id)}
                >
                  <div className="list-item-name">{c.title}</div>
                  <div className="list-item-meta">
                    {c._count.items} gezählt · abgeschlossen am{' '}
                    {new Date(c.closedAt!).toLocaleDateString('de-DE')}
                  </div>
                </button>
              ))}
          </div>
        </>
      )}
    </div>
  );
}
