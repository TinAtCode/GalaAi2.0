import { DragEvent, FormEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface BoardAppointment {
  id: string;
  title: string;
  startTime: string;
  endTime: string | null;
  status: 'planned' | 'done' | 'cancelled';
  assignedUserId: string | null;
  contractTaskId: string | null;
  project: { id: string; title: string; property: { city: string | null; customer: { name: string } } };
}

type AbsenceKind = 'vacation' | 'sick' | 'training' | 'other' | 'absent';
interface Absence {
  id: string;
  userId: string;
  startDate: string;
  endDate: string;
  kind: AbsenceKind;
  note: string | null;
}

interface Board {
  from: string;
  days: number;
  assignees: { id: string; firstName: string; lastName: string }[];
  appointments: BoardAppointment[];
  absences: Absence[];
}

// „absent“: ohne Recht für Mitarbeiterdaten ist die Art nicht zu sehen
const ABSENCE_LABELS: Record<AbsenceKind, string> = {
  vacation: 'Urlaub',
  sick: 'Krank',
  training: 'Schulung',
  other: 'Abwesend',
  absent: 'Abwesend',
};

const UNASSIGNED = 'none';
const WEEKDAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseDay = (day: string) => {
  const [y, m, d] = day.split('-').map(Number);
  return new Date(y, m - 1, d);
};
const addDays = (day: string, n: number) => {
  const d = parseDay(day);
  d.setDate(d.getDate() + n);
  return iso(d);
};
const mondayOf = (d: Date) => {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  copy.setDate(copy.getDate() - ((copy.getDay() + 6) % 7));
  return iso(copy);
};
const time = (value: string) =>
  new Date(value).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const hhmm = (value: string) => {
  const d = new Date(value);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};
// gleicher Termin an einem anderen Tag (Uhrzeit bleibt)
const onDay = (value: string, day: string) => {
  const d = new Date(value);
  const target = parseDay(day);
  target.setHours(d.getHours(), d.getMinutes(), 0, 0);
  return target.toISOString();
};

// Plantafel: Mitarbeiter × Wochentage. Termine per Ziehen auf einen anderen
// Tag oder Mitarbeiter verschieben (Maus), per Antippen bearbeiten (Touch).
export function PlanBoardPage() {
  const { hasPermission } = useAuth();
  const canEdit = hasPermission('customer.write');
  const canManageAbsences = hasPermission('employee.data.read');
  const [absenceOpen, setAbsenceOpen] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [from, setFrom] = useState(() => mondayOf(new Date()));
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<BoardAppointment | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);

  // nur die Antwort der letzten Anfrage zählt (schnell von Woche zu Woche)
  const latest = useRef(0);
  const load = useCallback(() => {
    const request = ++latest.current;
    api
      .get<Board>(`/appointments/board?from=${from}&days=7`)
      .then((result) => {
        if (request === latest.current) setBoard(result);
      })
      .catch((err) => {
        if (request !== latest.current) return;
        setError(err instanceof ApiError ? err.message : 'Plantafel konnte nicht geladen werden.');
      });
  }, [from]);
  useEffect(load, [load]);

  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(from, i)), [from]);
  const today = iso(new Date());
  const rows = [
    ...(board?.assignees.map((a) => ({ id: a.id, label: `${a.firstName} ${a.lastName}` })) ?? []),
    { id: UNASSIGNED, label: 'Nicht zugeteilt' },
  ];
  const cell = (rowId: string, day: string) =>
    (board?.appointments ?? []).filter(
      (a) => (a.assignedUserId ?? UNASSIGNED) === rowId && iso(new Date(a.startTime)) === day,
    );
  const absenceOf = (rowId: string, day: string) =>
    (board?.absences ?? []).find((a) => a.userId === rowId && a.startDate <= day && a.endDate >= day);
  const plannedHours = (rowId: string, day: string) =>
    cell(rowId, day).reduce((sum, a) => {
      const end = a.endTime ? new Date(a.endTime) : new Date(new Date(a.startTime).getTime() + 3_600_000);
      return sum + (end.getTime() - new Date(a.startTime).getTime()) / 3_600_000;
    }, 0);

  const move = async (appointment: BoardAppointment, patch: Record<string, unknown>) => {
    setError(null);
    try {
      await api.patch(`/appointments/${appointment.id}`, patch);
      load();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Termin konnte nicht verschoben werden.');
      return false;
    }
  };

  const onDrop = (event: DragEvent, rowId: string, day: string) => {
    event.preventDefault();
    setDropTarget(null);
    const appointment = board?.appointments.find((a) => a.id === event.dataTransfer.getData('text/plain'));
    if (!appointment) return;
    const sameRow = (appointment.assignedUserId ?? UNASSIGNED) === rowId;
    const sameDay = iso(new Date(appointment.startTime)) === day;
    if (sameRow && sameDay) return;
    void move(appointment, {
      startTime: onDay(appointment.startTime, day),
      assignedUserId: rowId === UNASSIGNED ? null : rowId,
    });
  };

  const weekLabel = `${parseDay(days[0]).toLocaleDateString('de-DE', { day: 'numeric', month: 'short' })} – ${parseDay(days[6]).toLocaleDateString('de-DE', { day: 'numeric', month: 'short', year: 'numeric' })}`;

  return (
    <div>
      <header className="page-header">
        <div>
          <h2>Plantafel</h2>
          <p>Wer ist wann wo? Termine auf einen anderen Tag oder Mitarbeiter ziehen oder antippen.</p>
        </div>
        <div className="btn-row">
          <button className="btn btn-sm" onClick={() => setFrom(addDays(from, -7))} aria-label="Vorige Woche">
            ←
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setFrom(mondayOf(new Date()))}
            data-testid="board-today"
          >
            Heute
          </button>
          <button
            className="btn btn-sm"
            onClick={() => setFrom(addDays(from, 7))}
            aria-label="Nächste Woche"
            data-testid="board-next"
          >
            →
          </button>
          <strong data-testid="board-week">{weekLabel}</strong>
          {canManageAbsences && (
            <button className="btn btn-sm" onClick={() => setAbsenceOpen(true)} data-testid="absence-open">
              Abwesenheit eintragen
            </button>
          )}
        </div>
      </header>

      {notice && (
        <p className="list-item-meta" data-testid="board-notice">
          {notice}
        </p>
      )}
      {error && (
        <p className="field-error" role="alert" data-testid="board-error">
          {error}
        </p>
      )}

      <div className="board-scroll">
        <table className="board" data-testid="plan-board">
          <thead>
            <tr>
              <th className="board-person">Mitarbeiter</th>
              {days.map((day) => (
                <th key={day} className={day === today ? 'board-today' : undefined}>
                  {WEEKDAYS[parseDay(day).getDay()]}{' '}
                  {parseDay(day).toLocaleDateString('de-DE', { day: 'numeric', month: 'numeric' })}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} data-testid="board-row" data-row={row.id}>
                <th className="board-person" scope="row">
                  {row.label}
                </th>
                {days.map((day) => {
                  const key = `${row.id}|${day}`;
                  const hours = plannedHours(row.id, day);
                  const absence = row.id === UNASSIGNED ? undefined : absenceOf(row.id, day);
                  return (
                    <td
                      key={day}
                      className={[
                        day === today ? 'board-today' : '',
                        dropTarget === key ? 'board-drop' : '',
                        absence ? 'board-absent' : '',
                      ].join(' ')}
                      onDragOver={
                        canEdit
                          ? (e) => {
                              e.preventDefault();
                              setDropTarget(key);
                            }
                          : undefined
                      }
                      onDragLeave={() => setDropTarget((t) => (t === key ? null : t))}
                      onDrop={canEdit ? (e) => onDrop(e, row.id, day) : undefined}
                      data-testid="board-cell"
                      data-day={day}
                    >
                      {absence && (
                        <span
                          className="board-absence"
                          data-testid="board-absence"
                          title={absence.note ?? undefined}
                        >
                          {ABSENCE_LABELS[absence.kind]}
                          {canManageAbsences && day === absence.startDate && (
                            <button
                              type="button"
                              className="board-absence-remove"
                              aria-label="Abwesenheit löschen"
                              onClick={async () => {
                                if (!window.confirm('Abwesenheit löschen?')) return;
                                try {
                                  await api.delete(`/absences/${absence.id}`);
                                  load();
                                } catch (err) {
                                  setError(err instanceof ApiError ? err.message : 'Löschen fehlgeschlagen.');
                                }
                              }}
                            >
                              ×
                            </button>
                          )}
                        </span>
                      )}
                      {cell(row.id, day).map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          className={`board-item${a.status === 'done' ? ' is-done' : ''}${a.contractTaskId ? ' is-contract' : ''}`}
                          draggable={canEdit}
                          onDragStart={(e) => e.dataTransfer.setData('text/plain', a.id)}
                          onClick={() => setEditing(a)}
                          data-testid="board-item"
                          title={`${a.project.title} – ${a.project.property.customer.name}`}
                        >
                          <span className="board-item-time">
                            {time(a.startTime)}
                            {a.endTime ? `–${time(a.endTime)}` : ''}
                          </span>
                          <span className="board-item-title">{a.title}</span>
                          <span className="board-item-meta">
                            {a.project.property.customer.name}
                            {a.project.property.city ? `, ${a.project.property.city}` : ''}
                          </span>
                        </button>
                      ))}
                      {row.id !== UNASSIGNED && hours > 8 && (
                        <span className="board-over" title="Mehr als 8 Stunden verplant">
                          {hours.toLocaleString('de-DE', { maximumFractionDigits: 1 })} h
                        </span>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {absenceOpen && board && (
        <AbsenceDialog
          assignees={board.assignees}
          defaultDay={from}
          onClose={() => setAbsenceOpen(false)}
          onSaved={(conflicts) => {
            setAbsenceOpen(false);
            setNotice(
              conflicts.length
                ? `Abwesenheit eingetragen. Noch zugeteilt in dieser Zeit: ${conflicts.map((c) => c.title).join(', ')} – bitte neu verteilen.`
                : 'Abwesenheit eingetragen.',
            );
            load();
          }}
        />
      )}

      {editing && board && (
        <AppointmentDialog
          appointment={editing}
          assignees={board.assignees}
          canEdit={canEdit}
          onClose={() => setEditing(null)}
          onSave={async (patch) => {
            if (await move(editing, patch)) setEditing(null);
          }}
        />
      )}
    </div>
  );
}

function AppointmentDialog({
  appointment,
  assignees,
  canEdit,
  onClose,
  onSave,
}: {
  appointment: BoardAppointment;
  assignees: Board['assignees'];
  canEdit: boolean;
  onClose: () => void;
  onSave: (patch: Record<string, unknown>) => Promise<void>;
}) {
  const [day, setDay] = useState(iso(new Date(appointment.startTime)));
  const [start, setStart] = useState(hhmm(appointment.startTime));
  const [end, setEnd] = useState(appointment.endTime ? hhmm(appointment.endTime) : '');
  const [assignee, setAssignee] = useState(appointment.assignedUserId ?? '');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const at = (t: string) => {
      const [h, m] = t.split(':').map(Number);
      const d = parseDay(day);
      d.setHours(h, m, 0, 0);
      return d.toISOString();
    };
    void onSave({ startTime: at(start), endTime: end ? at(end) : null, assignedUserId: assignee || null });
  };

  return (
    <>
      <div className="nav-sheet-backdrop" onClick={onClose} />
      <form
        className="board-dialog"
        role="dialog"
        aria-label={`Termin ${appointment.title}`}
        onSubmit={submit}
        data-testid="board-dialog"
      >
        <h3>{appointment.title}</h3>
        <p className="list-item-meta">
          <Link to={`/projekte/${appointment.project.id}`}>{appointment.project.title}</Link> ·{' '}
          {appointment.project.property.customer.name}
        </p>
        <div className="form-grid">
          <label className="field form-grid-full">
            <span>Tag</span>
            <input
              type="date"
              value={day}
              onChange={(e) => setDay(e.target.value)}
              disabled={!canEdit}
              required
              data-testid="board-dialog-day"
            />
          </label>
          <label className="field">
            <span>Von</span>
            <input
              type="time"
              value={start}
              onChange={(e) => setStart(e.target.value)}
              disabled={!canEdit}
              required
            />
          </label>
          <label className="field">
            <span>Bis</span>
            <input type="time" value={end} onChange={(e) => setEnd(e.target.value)} disabled={!canEdit} />
          </label>
          <label className="field form-grid-full">
            <span>Mitarbeiter</span>
            <select
              value={assignee}
              onChange={(e) => setAssignee(e.target.value)}
              disabled={!canEdit}
              data-testid="board-dialog-assignee"
            >
              <option value="">nicht zugeteilt</option>
              {assignees.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.firstName} {a.lastName}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="btn-row" style={{ marginTop: 16 }}>
          {canEdit && (
            <button type="submit" className="btn btn-primary" data-testid="board-dialog-save">
              Speichern
            </button>
          )}
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            {canEdit ? 'Abbrechen' : 'Schließen'}
          </button>
        </div>
      </form>
    </>
  );
}

function AbsenceDialog({
  assignees,
  defaultDay,
  onClose,
  onSaved,
}: {
  assignees: Board['assignees'];
  defaultDay: string;
  onClose: () => void;
  onSaved: (conflicts: { title: string }[]) => void;
}) {
  const [userId, setUserId] = useState(assignees[0]?.id ?? '');
  const [kind, setKind] = useState<AbsenceKind>('vacation');
  const [startDate, setStartDate] = useState(defaultDay);
  const [endDate, setEndDate] = useState(defaultDay);
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    try {
      const result = await api.post<{ conflicts: { title: string }[] }>('/absences', {
        userId,
        kind,
        startDate,
        endDate,
        ...(note.trim() ? { note } : {}),
      });
      onSaved(result.conflicts);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.');
    }
  };

  return (
    <>
      <div className="nav-sheet-backdrop" onClick={onClose} />
      <form
        className="board-dialog"
        onSubmit={submit}
        role="dialog"
        aria-label="Abwesenheit eintragen"
        data-testid="absence-dialog"
      >
        <h3>Abwesenheit eintragen</h3>
        <label className="field">
          <span>Mitarbeiter</span>
          <select value={userId} onChange={(e) => setUserId(e.target.value)} data-testid="absence-user">
            {assignees.map((a) => (
              <option key={a.id} value={a.id}>
                {a.firstName} {a.lastName}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Art</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as AbsenceKind)}
            data-testid="absence-kind"
          >
            <option value="vacation">Urlaub</option>
            <option value="sick">Krank</option>
            <option value="training">Schulung</option>
            <option value="other">Sonstiges</option>
          </select>
        </label>
        <div className="btn-row">
          <label className="field">
            <span>Von</span>
            <input
              type="date"
              value={startDate}
              onChange={(e) => {
                setStartDate(e.target.value);
                if (e.target.value > endDate) setEndDate(e.target.value);
              }}
              data-testid="absence-from"
            />
          </label>
          <label className="field">
            <span>Bis</span>
            <input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              data-testid="absence-to"
            />
          </label>
        </div>
        <label className="field">
          <span>Notiz (optional)</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} />
        </label>
        {error && <p className="field-error">{error}</p>}
        <div className="btn-row">
          <button type="submit" className="btn btn-primary" data-testid="absence-save">
            Eintragen
          </button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>
            Abbrechen
          </button>
        </div>
      </form>
    </>
  );
}
