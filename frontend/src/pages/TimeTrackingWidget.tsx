import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

interface TimeEntry {
  id: string;
  startTime: string;
  endTime: string | null;
  breakMinutes: number;
  activity: string | null;
  status: 'open' | 'completed' | 'approved';
}

interface OvertimeSummary {
  workedMinutes: number;
  regularMinutes: number;
  overtimeMinutes: number;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  return `${h}h ${m}min`;
}

export function TimeTrackingWidget() {
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [overtime, setOvertime] = useState<OvertimeSummary | null>(null);
  const [activity, setActivity] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    api
      .get<TimeEntry[]>('/time-entries/mine')
      .then(setEntries)
      .catch((err) => setError(err instanceof ApiError ? err.message : 'Zeiterfassung nicht verfügbar.'));
    api
      .get<OvertimeSummary>('/time-entries/overtime/mine')
      .then(setOvertime)
      .catch(() => {
        /* still show start/stop even if overtime summary fails */
      });
  };

  useEffect(() => {
    load();
  }, []);

  const openEntry = entries?.find((e) => e.status === 'open') ?? null;

  const start = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.post('/time-entries/start', activity ? { activity } : {});
      setActivity('');
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Start fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const stop = async () => {
    setError(null);
    setBusy(true);
    try {
      await api.post('/time-entries/stop', {});
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Stopp fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  if (entries === null && !error) return null; // still loading, no flash of empty widget

  return (
    <div className="time-widget">
      {error && <p className="field-error">{error}</p>}

      {openEntry ? (
        <>
          <div>
            <div className="time-widget-label">Zeiterfassung läuft seit</div>
            <div className="time-widget-time">{formatTime(openEntry.startTime)} Uhr</div>
            {openEntry.activity && <div className="job-card-meta">{openEntry.activity}</div>}
          </div>
          <button className="btn btn-primary" onClick={stop} disabled={busy}>
            Arbeit beenden
          </button>
        </>
      ) : (
        <>
          <input
            className="time-widget-input"
            placeholder="Tätigkeit (optional)"
            value={activity}
            onChange={(e) => setActivity(e.target.value)}
          />
          <button className="btn btn-primary" onClick={start} disabled={busy}>
            Arbeit starten
          </button>
        </>
      )}

      {overtime && overtime.workedMinutes > 0 && (
        <div className="time-widget-overtime">
          Heute: {formatDuration(overtime.workedMinutes)}
          {overtime.overtimeMinutes > 0 && (
            <> · davon {formatDuration(overtime.overtimeMinutes)} Überstunden</>
          )}
        </div>
      )}
    </div>
  );
}
