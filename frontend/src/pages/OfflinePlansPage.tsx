import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { CachedPlan, offlineDb } from '../offline/db';
import { flushOutbox, subscribeOffline, useOnline, useOutbox } from '../offline/sync';

// Lagepläne, die auf diesem Gerät gespeichert sind (zuletzt geöffnet), und
// Änderungen, die noch auf die Übertragung warten – auch ohne Netz erreichbar
export function OfflinePlansPage() {
  const online = useOnline();
  const outbox = useOutbox();
  const [plans, setPlans] = useState<CachedPlan[] | null>(null);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    let current = true;
    const load = () =>
      offlineDb
        .allPlans()
        .then((list) => current && setPlans(list.sort((a, b) => b.cachedAt - a.cachedAt)))
        .catch(() => {
          if (!current) return;
          setUnavailable(true);
          setPlans([]);
        });
    load();
    const unsubscribe = subscribeOffline(load);
    return () => {
      current = false;
      unsubscribe();
    };
  }, []);

  const waiting = outbox.filter((e) => !e.conflict).length;
  const conflicts = outbox.filter((e) => e.conflict).length;

  return (
    <div data-testid="offline-plans">
      <header className="page-header">
        <div>
          <h2>Offline-Pläne</h2>
          <p>
            Zuletzt geöffnete Lagepläne liegen auf diesem Gerät und lassen sich auf der Baustelle auch ohne
            Netz öffnen und bearbeiten. Änderungen werden übertragen, sobald wieder Netz da ist.
          </p>
        </div>
        <span
          className={`status-badge ${online ? 'status-done' : 'status-open'}`}
          data-testid="offline-status"
        >
          {online ? 'online' : 'offline'}
        </span>
      </header>

      {unavailable && (
        <p className="field-error">
          Dieser Browser erlaubt keinen Offline-Speicher (z. B. im privaten Fenster).
        </p>
      )}
      {(waiting > 0 || conflicts > 0) && (
        <div className="card" data-testid="offline-outbox">
          <strong>
            {waiting > 0 &&
              `${waiting} ${waiting === 1 ? 'Änderung wartet' : 'Änderungen warten'} auf die Übertragung`}
            {waiting > 0 && conflicts > 0 && ' · '}
            {conflicts > 0 && `${conflicts} mit Konflikt (im Plan entscheiden)`}
          </strong>
          {online && waiting > 0 && (
            <div style={{ marginTop: 8 }}>
              <button className="btn btn-sm" onClick={() => void flushOutbox()} data-testid="offline-sync">
                Jetzt übertragen
              </button>
            </div>
          )}
        </div>
      )}

      {plans?.length === 0 && !unavailable && (
        <div className="empty-state">
          <strong>Noch keine Pläne auf diesem Gerät.</strong>
          Einen Plan einmal mit Netz öffnen – danach steht er hier auch offline bereit.
        </div>
      )}
      {!!plans?.length && (
        <div className="list-card">
          {plans.map((p) => {
            const entry = outbox.find((e) => e.planId === p.id);
            return (
              <Link
                key={p.id}
                to={`/projekte/${p.projectId}/plaene/${p.id}`}
                className="list-item list-item-link"
                data-testid="offline-plan"
              >
                <div>
                  <div className="list-item-name">{entry?.name ?? p.name}</div>
                  <div className="list-item-meta">
                    Stand vom {new Date(p.cachedAt).toLocaleString('de-DE')}
                    {p.background ? ' · mit Hintergrund' : ''}
                  </div>
                </div>
                {entry && (
                  <span className={`status-badge ${entry.conflict ? 'status-cancelled' : 'status-open'}`}>
                    {entry.conflict ? 'Konflikt' : 'wartet'}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
