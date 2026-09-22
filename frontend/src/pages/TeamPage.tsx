import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

interface Employee {
  id: string;
  firstName: string;
  lastName: string;
  active: boolean;
}

interface TimeEntry {
  id: string;
  startTime: string;
  endTime: string | null;
  breakMinutes: number;
  activity: string | null;
  status: 'open' | 'completed' | 'approved';
}

const STATUS_LABELS: Record<TimeEntry['status'], string> = {
  open: 'Läuft',
  completed: 'Abgeschlossen',
  approved: 'Freigegeben',
};

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' });
}

function durationLabel(entry: TimeEntry): string {
  if (!entry.endTime) return 'läuft noch';
  const minutes =
    (new Date(entry.endTime).getTime() - new Date(entry.startTime).getTime()) / 60000 - entry.breakMinutes;
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  return `${hours}h ${rest}min`;
}

export function TeamPage() {
  const [employees, setEmployees] = useState<Employee[] | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [entries, setEntries] = useState<TimeEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Employee[]>('/employees')
      .then((list) => {
        setEmployees(list);
        if (list.length > 0) setSelectedId(list[0].id);
      })
      .catch((err) =>
        setError(
          err instanceof ApiError
            ? err.message
            : 'Mitarbeiterdaten konnten nicht geladen werden (fehlende Berechtigung?).',
        ),
      );
  }, []);

  const loadEntries = (employeeId: string) => {
    api
      .get<TimeEntry[]>(`/time-entries/by-employee/${employeeId}`)
      .then(setEntries)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Zeiteinträge konnten nicht geladen werden.'),
      );
  };

  useEffect(() => {
    if (selectedId) loadEntries(selectedId);
  }, [selectedId]);

  const approve = async (entryId: string) => {
    setBusyId(entryId);
    setError(null);
    try {
      await api.post(`/time-entries/${entryId}/approve`);
      if (selectedId) loadEntries(selectedId);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Freigabe fehlgeschlagen.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <header className="my-day-header">
        <h2>Team</h2>
      </header>

      {error && <p className="field-error">{error}</p>}

      {employees === null && !error && <p>Lädt …</p>}

      {employees && employees.length > 0 && (
        <div className="tab-bar">
          {employees.map((emp) => (
            <button
              key={emp.id}
              className={selectedId === emp.id ? 'active' : ''}
              onClick={() => setSelectedId(emp.id)}
              data-testid="team-employee-tab"
            >
              {emp.firstName} {emp.lastName}
            </button>
          ))}
        </div>
      )}

      {entries?.length === 0 && <p className="list-item-meta">Keine Zeiteinträge vorhanden.</p>}

      {entries?.map((entry) => (
        <div key={entry.id} className="list-item" data-testid="time-entry-item">
          <div>
            <div className="list-item-name">{formatDateTime(entry.startTime)}</div>
            <div className="list-item-meta">
              {durationLabel(entry)}
              {entry.activity ? ` · ${entry.activity}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              className={`status-badge status-${entry.status === 'approved' ? 'done' : entry.status === 'open' ? 'open' : ''}`}
              data-testid="time-entry-status"
            >
              {STATUS_LABELS[entry.status]}
            </span>
            {entry.status === 'completed' && (
              <button
                className="btn btn-primary"
                disabled={busyId === entry.id}
                onClick={() => approve(entry.id)}
                data-testid="time-entry-approve"
              >
                Freigeben
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
