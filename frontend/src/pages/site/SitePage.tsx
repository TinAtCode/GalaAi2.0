import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { offlineDb } from '../../offline/db';
import { isNetworkError, subscribeOffline, useOnline } from '../../offline/sync';
import { SiteThread } from './SiteThread';
import { DiarySection } from './DiarySection';
import { PushToggle } from '../../push/PushToggle';

interface SiteAppointment {
  id: string;
  title: string;
  startTime: string;
  endTime: string | null;
  status: 'planned' | 'done' | 'cancelled';
  notes: string | null;
  projectId: string;
  projectTitle: string;
  customer: string;
  place: string;
  address: string;
  unread: number;
}

interface SiteDay {
  appointments: SiteAppointment[];
  running: { id: string; startTime: string; projectId: string | null; activity: string | null } | null;
  unread: { projectId: string; projectTitle: string; count: number }[];
}

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const time = (value: string) =>
  new Date(value).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const dayWithOffset = (offset: number) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d;
};
// Navigation mit der Karten-App des Handys (Google Maps öffnet auf allen Geräten)
const mapsUrl = (address: string) =>
  `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;

// Baustelle: die eigenen Termine des Tages mit Navigation, Zeiterfassung je
// Baustelle, Fotos und Nachrichten, „Erledigt“. Der zuletzt geladene Tag
// bleibt auf dem Gerät und ist auch ohne Netz da.
export function SitePage() {
  const { user } = useAuth();
  const online = useOnline();
  const [offset, setOffset] = useState(0); // 0 = heute, 1 = morgen
  const [day, setDay] = useState<SiteDay | null>(null);
  const [fromCache, setFromCache] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const dateKey = iso(dayWithOffset(offset));
  const dateLabel = dayWithOffset(offset).toLocaleDateString('de-DE', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const cacheKey = `site-day:${user?.id}:${dateKey}`;

  // nur die Antwort der letzten Anfrage zählt (Heute/Morgen schnell hintereinander)
  const latest = useRef(0);
  const load = useCallback(() => {
    const request = ++latest.current;
    api
      .get<SiteDay>(`/site/today?date=${dateKey}`)
      .then((result) => {
        if (request !== latest.current) return;
        setDay(result);
        setFromCache(null);
        setError(null);
        void offlineDb.putCache(cacheKey, result).catch(() => undefined);
      })
      .catch(async (err) => {
        if (request !== latest.current) return;
        if (!isNetworkError(err)) {
          setError(err instanceof ApiError ? err.message : 'Der Tag konnte nicht geladen werden.');
          return;
        }
        const cached = await offlineDb.getCache<SiteDay>(cacheKey).catch(() => undefined);
        if (request !== latest.current) return;
        if (cached) {
          setDay(cached.value);
          setFromCache(cached.savedAt);
        } else setError('Keine Verbindung und noch nichts auf dem Gerät gespeichert.');
      });
  }, [dateKey, cacheKey]);

  useEffect(() => {
    load();
    const unsubscribe = subscribeOffline(load);
    return () => {
      unsubscribe();
    };
  }, [load]);

  const act = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      load();
    } catch (err) {
      setError(
        isNetworkError(err)
          ? 'Keine Verbindung – das geht nur mit Netz.'
          : err instanceof ApiError
            ? err.message
            : 'Aktion fehlgeschlagen.',
      );
    } finally {
      setBusy(false);
    }
  };

  // Arbeit an dieser Baustelle beginnen; läuft schon eine andere, wird sie beendet
  const startHere = (a: SiteAppointment) =>
    act(async () => {
      if (day?.running) await api.post('/time-entries/stop', {});
      await api.post('/time-entries/start', { projectId: a.projectId, activity: a.title });
    });

  const running = day?.running;
  const runningTitle =
    running &&
    (day?.appointments.find((a) => a.projectId === running.projectId)?.projectTitle ?? running.activity);
  const otherUnread = (day?.unread ?? []).filter(
    (u) => !day?.appointments.some((a) => a.projectId === u.projectId),
  );

  return (
    <div className="site-page" data-testid="site-page">
      <header className="page-header">
        <div>
          <h2>Baustelle</h2>
          <p>{dateLabel}</p>
        </div>
        <div className="segmented" role="group" aria-label="Tag">
          <button aria-pressed={offset === 0} onClick={() => setOffset(0)}>
            Heute
          </button>
          <button aria-pressed={offset === 1} onClick={() => setOffset(1)} data-testid="site-tomorrow">
            Morgen
          </button>
        </div>
      </header>

      <PushToggle />

      {fromCache && (
        <p className="site-offline-note" data-testid="site-cached">
          Ohne Netz – Stand von{' '}
          {new Date(fromCache).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' })} Uhr. Fotos
          und Nachrichten gehen trotzdem und werden später übertragen.
        </p>
      )}
      {error && <p className="field-error">{error}</p>}

      {running && offset === 0 && (
        <div className="time-widget site-running" data-testid="site-running">
          <div>
            <div className="time-widget-label">Arbeit läuft seit</div>
            <div className="time-widget-time">{time(running.startTime)} Uhr</div>
            {runningTitle && <div className="job-card-meta">{runningTitle}</div>}
          </div>
          <button
            className="btn btn-primary"
            disabled={busy || !online}
            onClick={() => act(() => api.post('/time-entries/stop', {}))}
            data-testid="site-stop"
          >
            Arbeit beenden
          </button>
        </div>
      )}

      {day && day.appointments.length === 0 && (
        <div className="empty-state">
          <strong>{offset === 0 ? 'Heute' : 'Morgen'} ist nichts geplant.</strong>
          Termine plant das Büro, sie erscheinen automatisch hier.
        </div>
      )}

      {day?.appointments.map((a) => {
        const here = running?.projectId === a.projectId;
        return (
          <article
            key={a.id}
            className={`job-card appointment-card site-card${a.status === 'done' ? ' is-done' : ''}`}
            data-testid="site-appointment"
          >
            <div className="site-card-head">
              <div className="job-card-time">
                {time(a.startTime)}
                {a.endTime ? `–${time(a.endTime)}` : ''}
              </div>
              {a.status === 'done' && <span className="status-badge status-done">Erledigt</span>}
            </div>
            <div className="job-card-task">{a.title}</div>
            <div className="job-card-meta">
              {a.customer} · {a.projectTitle}
            </div>
            {a.address && (
              <a className="site-address" href={mapsUrl(a.address)} target="_blank" rel="noreferrer">
                {a.place ? `${a.place}, ` : ''}
                {a.address} – Navigation
              </a>
            )}
            {a.notes && <div className="site-notes">{a.notes}</div>}
            <div className="site-actions">
              {offset === 0 &&
                a.status === 'planned' &&
                (here ? (
                  <span className="status-badge status-in_progress">Zeit läuft</span>
                ) : (
                  <button
                    className="btn btn-primary"
                    disabled={busy || !online}
                    onClick={() => startHere(a)}
                    data-testid="site-start"
                  >
                    Hier anfangen
                  </button>
                ))}
              <Link className="btn" to={`/baustelle/${a.projectId}`} data-testid="site-open">
                Fotos &amp; Nachrichten
                {a.unread > 0 && <span className="site-badge">{a.unread}</span>}
              </Link>
              {a.status === 'planned' && (
                <button
                  className="btn btn-ghost"
                  disabled={busy || !online}
                  onClick={() => act(() => api.post(`/site/appointments/${a.id}/done`, {}))}
                  data-testid="site-done"
                >
                  Erledigt
                </button>
              )}
            </div>
          </article>
        );
      })}

      {otherUnread.length > 0 && (
        <section className="card">
          <h3>Neue Nachrichten</h3>
          {otherUnread.map((u) => (
            <Link key={u.projectId} to={`/baustelle/${u.projectId}`} className="list-item list-item-link">
              <span className="list-item-name">{u.projectTitle}</span>
              <span className="site-badge">{u.count}</span>
            </Link>
          ))}
        </section>
      )}
    </div>
  );
}

// Fotos und Nachrichten einer Baustelle
export function SiteProjectPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const [title, setTitle] = useState<string | null>(null);
  useEffect(() => {
    api
      .get<{ project: { title: string } }>(`/site/projects/${projectId}/messages`)
      .then((res) => setTitle(res.project.title))
      .catch(() => undefined);
  }, [projectId]);
  return (
    <div className="site-page">
      <header className="page-header">
        <div>
          <div className="list-item-meta" style={{ marginBottom: 4 }}>
            <Link to="/baustelle">Baustelle</Link>
          </div>
          <h2 data-testid="site-project-title">{title ?? 'Baustelle'}</h2>
        </div>
      </header>
      <section className="card">{projectId && <SiteThread projectId={projectId} />}</section>
      <section className="card">{projectId && <DiarySection projectId={projectId} compact />}</section>
    </div>
  );
}
