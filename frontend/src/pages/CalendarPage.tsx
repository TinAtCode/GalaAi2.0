import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface CalendarEvent {
  id: string;
  scope: 'company' | 'personal';
  title: string;
  startTime: string;
  endTime: string | null;
  allDay: boolean;
  notes: string | null;
  editable: boolean;
}

interface Board {
  assignees: { id: string; firstName: string; lastName: string }[];
  appointments: {
    id: string;
    title: string;
    startTime: string;
    endTime: string | null;
    assignedUserId: string | null;
    project: { id: string; title: string };
  }[];
  absences: { id: string; userId: string; startDate: string; endDate: string; kind: string }[];
}

interface Maintenance {
  id: string;
  title: string;
  due: string;
  overdue: boolean;
  equipment: { id: string; name: string };
}

type Layer = 'company' | 'site' | 'team' | 'personal' | 'maintenance';
const LAYERS: { key: Layer; label: string; color: string }[] = [
  { key: 'company', label: 'Firma', color: '#7a3fb0' },
  { key: 'site', label: 'Baustellen', color: '#1f6fd1' },
  { key: 'team', label: 'Team (Abwesenheiten)', color: '#b0372c' },
  { key: 'personal', label: 'Persönlich', color: '#2f6b2f' },
  { key: 'maintenance', label: 'Wartung', color: '#b07a1f' },
];
const COLOR = Object.fromEntries(LAYERS.map((l) => [l.key, l.color])) as Record<Layer, string>;
const ABSENCE: Record<string, string> = {
  vacation: 'Urlaub',
  sick: 'krank',
  training: 'Schulung',
  other: 'abwesend',
  absent: 'abwesend',
};

interface Item {
  key: string;
  layer: Layer;
  label: string;
  time?: string;
  link?: string;
  event?: CalendarEvent;
}

// Tage als JJJJ-MM-TT (Datumsrechnung in UTC, ohne Zeitzonen-Sprünge)
const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};
const localDay = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const today = () => localDay(new Date().toISOString());
const time = (iso: string) =>
  new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
const daysBetween = (from: string, to: string) => {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 400; d = addDays(d, 1)) out.push(d);
  return out;
};

const EMPTY_FORM = {
  title: '',
  allDay: false,
  start: '08:00',
  end: '',
  endDay: '',
  scope: 'personal',
  notes: '',
};

// Kalender: Firma, Baustellen (Einsätze), Team (Abwesenheiten) und
// Persönliches in einer Monatsansicht; jede Ebene einzeln ein- und ausblenden
export function CalendarPage() {
  const { user, hasPermission } = useAuth();
  const [month, setMonth] = useState(() => today().slice(0, 7));
  const [layers, setLayers] = useState<Record<Layer, boolean>>({
    company: true,
    site: true,
    team: true,
    personal: true,
    maintenance: true,
  });
  const [onlyMine, setOnlyMine] = useState(false);
  const [events, setEvents] = useState<CalendarEvent[]>([]);
  const [maintenance, setMaintenance] = useState<Maintenance[]>([]);
  const [canWriteCompany, setCanWriteCompany] = useState(false);
  const [board, setBoard] = useState<Board | null>(null);
  const [selected, setSelected] = useState(today);
  const [form, setForm] = useState(EMPTY_FORM);
  const [editing, setEditing] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const first = `${month}-01`;
  const weekday = (new Date(`${first}T12:00:00Z`).getUTCDay() + 6) % 7;
  const gridStart = addDays(first, -weekday);
  const grid = useMemo(() => Array.from({ length: 42 }, (_, i) => addDays(gridStart, i)), [gridStart]);
  const gridEnd = grid[41];

  const load = useCallback(() => {
    api
      .get<{ events: CalendarEvent[]; maintenance?: Maintenance[]; canWriteCompany: boolean }>(
        `/calendar/events?from=${gridStart}&to=${gridEnd}`,
      )
      .then((r) => {
        setError(null);
        setEvents(r.events);
        setMaintenance(r.maintenance ?? []);
        setCanWriteCompany(r.canWriteCompany);
      })
      .catch(() => setError('Kalender konnte nicht geladen werden.'));
    if (hasPermission('customer.read')) {
      api
        .get<Board>(`/appointments/board?from=${gridStart}&days=42`)
        .then(setBoard)
        .catch(() => setBoard(null));
    }
  }, [gridStart, gridEnd, hasPermission]);
  useEffect(load, [load]);

  const byDay = useMemo(() => {
    const map = new Map<string, Item[]>();
    const push = (day: string, item: Item) => {
      if (day < gridStart || day > gridEnd) return;
      map.set(day, [...(map.get(day) ?? []), item]);
    };
    for (const e of events) {
      const layer: Layer = e.scope === 'company' ? 'company' : 'personal';
      const from = localDay(e.startTime);
      const to = e.endTime ? localDay(e.endTime) : from;
      for (const d of daysBetween(from, to))
        push(d, {
          key: `${e.id}:${d}`,
          layer,
          label: e.title,
          time: e.allDay ? undefined : time(e.startTime),
          event: e,
        });
    }
    const names = new Map((board?.assignees ?? []).map((a) => [a.id, `${a.firstName} ${a.lastName}`]));
    for (const a of board?.appointments ?? []) {
      if (onlyMine && a.assignedUserId !== user?.id) continue;
      push(localDay(a.startTime), {
        key: a.id,
        layer: 'site',
        label: `${a.project.title}: ${a.title}${a.assignedUserId ? ` (${names.get(a.assignedUserId) ?? '–'})` : ''}`,
        time: time(a.startTime),
        link: `/projekte/${a.project.id}`,
      });
    }
    for (const ab of board?.absences ?? []) {
      for (const d of daysBetween(ab.startDate, ab.endDate))
        push(d, {
          key: `${ab.id}:${d}`,
          layer: 'team',
          label: `${names.get(ab.userId) ?? 'Mitarbeiter'}: ${ABSENCE[ab.kind] ?? 'abwesend'}`,
        });
    }
    for (const m of maintenance)
      push(m.due, {
        key: `m:${m.id}`,
        layer: 'maintenance',
        label: `${m.equipment.name}: ${m.title}${m.overdue ? ' (überfällig)' : ''}`,
        link: `/geraete/${m.equipment.id}`,
      });
    for (const list of map.values()) list.sort((a, b) => (a.time ?? '').localeCompare(b.time ?? ''));
    return map;
  }, [events, maintenance, board, onlyMine, user?.id, gridStart, gridEnd]);

  const visible = (day: string) => (byDay.get(day) ?? []).filter((i) => layers[i.layer]);

  const startEdit = (e: CalendarEvent) => {
    setEditing(e.id);
    setForm({
      title: e.title,
      allDay: e.allDay,
      start: e.allDay ? '08:00' : time(e.startTime),
      end: e.endTime && !e.allDay ? time(e.endTime) : '',
      endDay: e.endTime ? localDay(e.endTime) : '',
      scope: e.scope,
      notes: e.notes ?? '',
    });
    setSelected(localDay(e.startTime));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const at = (day: string, hm: string) => new Date(`${day}T${hm}:00`).toISOString();
    const endDay = form.endDay || selected;
    const body = {
      scope: form.scope,
      title: form.title,
      allDay: form.allDay,
      startTime: at(selected, form.allDay ? '00:00' : form.start),
      endTime: form.allDay
        ? at(endDay, '23:59')
        : form.end
          ? at(endDay, form.end)
          : form.endDay
            ? at(endDay, form.start)
            : null,
      notes: form.notes,
    };
    try {
      if (editing) await api.put(`/calendar/events/${editing}`, body);
      else await api.post('/calendar/events', body);
      setForm(EMPTY_FORM);
      setEditing(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.');
    }
  };

  const remove = async (id: string) => {
    if (!window.confirm('Termin löschen?')) return;
    await api.delete(`/calendar/events/${id}`).catch(() => setError('Löschen fehlgeschlagen.'));
    setEditing(null);
    setForm(EMPTY_FORM);
    load();
  };

  const monthTitle = new Date(`${first}T12:00:00Z`).toLocaleDateString('de-DE', {
    month: 'long',
    year: 'numeric',
  });
  const shiftMonth = (n: number) => {
    const [y, m] = month.split('-').map(Number);
    const d = new Date(Date.UTC(y, m - 1 + n, 1));
    setMonth(d.toISOString().slice(0, 7));
  };

  return (
    <div data-testid="calendar">
      <header className="page-header">
        <h2>Kalender</h2>
        <div className="btn-row">
          <button className="btn btn-sm" onClick={() => shiftMonth(-1)} aria-label="Voriger Monat">
            ‹
          </button>
          <strong style={{ minWidth: 140, textAlign: 'center' }} data-testid="calendar-month">
            {monthTitle}
          </strong>
          <button className="btn btn-sm" onClick={() => shiftMonth(1)} aria-label="Nächster Monat">
            ›
          </button>
          <button
            className="btn btn-sm"
            onClick={() => {
              setMonth(today().slice(0, 7));
              setSelected(today());
            }}
          >
            Heute
          </button>
        </div>
      </header>
      <div className="btn-row" style={{ marginBottom: 8, flexWrap: 'wrap' }}>
        {LAYERS.map((l) => (
          <label key={l.key} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <input
              type="checkbox"
              checked={layers[l.key]}
              onChange={(e) => setLayers({ ...layers, [l.key]: e.target.checked })}
              data-testid={`calendar-layer-${l.key}`}
            />
            <span style={{ width: 10, height: 10, borderRadius: 2, background: l.color }} />
            {l.label}
          </label>
        ))}
        <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input type="checkbox" checked={onlyMine} onChange={(e) => setOnlyMine(e.target.checked)} />
          nur meine Einsätze
        </label>
      </div>
      {error && <p className="field-error">{error}</p>}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-start' }}>
        <div
          style={{
            flex: '3 1 480px',
            minWidth: 0,
            display: 'grid',
            gridTemplateColumns: 'repeat(7, minmax(0, 1fr))',
            gap: 2,
          }}
          data-testid="calendar-grid"
        >
          {['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'].map((d) => (
            <div key={d} className="list-item-meta" style={{ textAlign: 'center' }}>
              {d}
            </div>
          ))}
          {grid.map((day) => {
            const items = visible(day);
            const inMonth = day.startsWith(month);
            return (
              <button
                key={day}
                type="button"
                onClick={() => setSelected(day)}
                className="card"
                style={{
                  minHeight: 84,
                  padding: 4,
                  textAlign: 'left',
                  opacity: inMonth ? 1 : 0.5,
                  outline: day === selected ? '2px solid var(--accent, #2f6b2f)' : undefined,
                  overflow: 'hidden',
                }}
                data-testid="calendar-day"
                data-day={day}
              >
                <div style={{ fontWeight: day === today() ? 700 : 400, fontSize: '0.8rem' }}>
                  {Number(day.slice(8))}
                </div>
                {items.slice(0, 3).map((i) => (
                  <div
                    key={i.key}
                    style={{
                      fontSize: '0.7rem',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      borderLeft: `3px solid ${COLOR[i.layer]}`,
                      paddingLeft: 3,
                      marginTop: 2,
                    }}
                  >
                    {i.time ? `${i.time} ` : ''}
                    {i.label}
                  </div>
                ))}
                {items.length > 3 && <div style={{ fontSize: '0.7rem' }}>+{items.length - 3} weitere</div>}
              </button>
            );
          })}
        </div>
        <aside className="card" style={{ flex: '1 1 260px' }} data-testid="calendar-panel">
          <h3 style={{ marginTop: 0 }}>
            {new Date(`${selected}T12:00:00Z`).toLocaleDateString('de-DE', {
              weekday: 'long',
              day: 'numeric',
              month: 'long',
            })}
          </h3>
          {visible(selected).length === 0 && <p className="list-item-meta">Nichts eingetragen.</p>}
          {visible(selected).map((i) => (
            <div
              key={i.key}
              style={{ borderLeft: `3px solid ${COLOR[i.layer]}`, paddingLeft: 6, marginBottom: 6 }}
            >
              <div data-testid="calendar-item">
                {i.time ? `${i.time} · ` : ''}
                {i.link ? <Link to={i.link}>{i.label}</Link> : i.label}
              </div>
              {i.event?.notes && <div className="list-item-meta">{i.event.notes}</div>}
              {i.event?.editable && (
                <div className="btn-row">
                  <button className="btn btn-sm btn-ghost" onClick={() => startEdit(i.event!)}>
                    Bearbeiten
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => void remove(i.event!.id)}>
                    Löschen
                  </button>
                </div>
              )}
            </div>
          ))}
          <form onSubmit={save} className="login-form" style={{ marginTop: 12 }} data-testid="calendar-form">
            <strong>{editing ? 'Termin bearbeiten' : 'Neuer Termin'}</strong>
            <label className="field">
              <span>Titel</span>
              <input
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                required
                minLength={2}
                maxLength={200}
                data-testid="calendar-title"
              />
            </label>
            <label className="field">
              <span>Kalender</span>
              <select
                value={form.scope}
                onChange={(e) => setForm({ ...form, scope: e.target.value })}
                data-testid="calendar-scope"
              >
                <option value="personal">Persönlich (nur ich)</option>
                {canWriteCompany && <option value="company">Firma (alle)</option>}
              </select>
            </label>
            <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="checkbox"
                checked={form.allDay}
                onChange={(e) => setForm({ ...form, allDay: e.target.checked })}
                data-testid="calendar-allday"
              />
              ganztägig
            </label>
            {!form.allDay && (
              <div style={{ display: 'flex', gap: 8 }}>
                <label className="field" style={{ flex: 1 }}>
                  <span>von</span>
                  <input
                    type="time"
                    value={form.start}
                    onChange={(e) => setForm({ ...form, start: e.target.value })}
                    data-testid="calendar-start"
                  />
                </label>
                <label className="field" style={{ flex: 1 }}>
                  <span>bis</span>
                  <input
                    type="time"
                    value={form.end}
                    onChange={(e) => setForm({ ...form, end: e.target.value })}
                  />
                </label>
              </div>
            )}
            <label className="field">
              <span>bis Tag (mehrtägig, optional)</span>
              <input
                type="date"
                value={form.endDay}
                min={selected}
                onChange={(e) => setForm({ ...form, endDay: e.target.value })}
                data-testid="calendar-endday"
              />
            </label>
            <label className="field">
              <span>Notiz</span>
              <input
                value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })}
                maxLength={2000}
              />
            </label>
            <div className="btn-row">
              <button type="submit" className="btn btn-primary" data-testid="calendar-save">
                Speichern
              </button>
              {editing && (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => {
                    setEditing(null);
                    setForm(EMPTY_FORM);
                  }}
                >
                  Abbrechen
                </button>
              )}
            </div>
          </form>
        </aside>
      </div>
    </div>
  );
}
