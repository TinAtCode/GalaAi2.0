import { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api, ApiError } from '../../api/client';

type Weather = 'sunny' | 'cloudy' | 'rain' | 'snow' | 'frost' | 'storm' | 'heat';
type Reason = 'weather' | 'material' | 'customer' | 'other_trade' | 'equipment' | 'plans' | 'staff' | 'other';

interface Entry {
  day: string;
  weather: Weather | null;
  temperature: number | null;
  crew: string | null;
  crewCount: number | null;
  work: string | null;
  delayHours: number | null;
  delayReason: Reason | null;
  delayNote: string | null;
  notes: string | null;
  photos: string[];
}

interface Diary {
  project: { title: string };
  entries: Entry[];
  delays: { hours: number; days: number; byReason: { reason: Reason; hours: number; days: number }[] };
}

export const WEATHER: Record<Weather, string> = {
  sunny: 'sonnig',
  cloudy: 'bewölkt',
  rain: 'Regen',
  snow: 'Schnee',
  frost: 'Frost',
  storm: 'Sturm',
  heat: 'Hitze',
};

export const REASONS: Record<Reason, string> = {
  weather: 'Wetter',
  material: 'Material / Lieferung',
  customer: 'Kunde / Bauherr',
  other_trade: 'andere Gewerke',
  equipment: 'Geräte / Maschinen',
  plans: 'Pläne / Freigaben',
  staff: 'Personal',
  other: 'Sonstiges',
};

const hours = (h: number) => `${h.toLocaleString('de-DE', { maximumFractionDigits: 2 })} h`;
const dayText = (day: string) =>
  new Date(`${day}T12:00:00Z`).toLocaleDateString('de-DE', {
    weekday: 'short',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  });
// lokales Datum (Gerät) als JJJJ-MM-TT
const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const EMPTY = {
  weather: '',
  temperature: '',
  crew: '',
  crewCount: '',
  work: '',
  delayHours: '',
  delayReason: '',
  delayNote: '',
  notes: '',
};
type Form = typeof EMPTY;

const formOf = (e?: Entry): Form =>
  e
    ? {
        weather: e.weather ?? '',
        temperature: e.temperature?.toString() ?? '',
        crew: e.crew ?? '',
        crewCount: e.crewCount?.toString() ?? '',
        work: e.work ?? '',
        delayHours: e.delayHours ? String(e.delayHours).replace('.', ',') : '',
        delayReason: e.delayReason ?? '',
        delayNote: e.delayNote ?? '',
        notes: e.notes ?? '',
      }
    : EMPTY;

const escape = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);

// Bautagebuch eines Projekts: Tag wählen, Eintrag schreiben; im Projekt
// zusätzlich die Liste, Verzögerungen je Ursache und eine Druckansicht.
export function DiarySection({ projectId, compact }: { projectId: string; compact?: boolean }) {
  const [diary, setDiary] = useState<Diary | null>(null);
  const [day, setDay] = useState(localToday);
  const [form, setForm] = useState<Form>(EMPTY);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  // Das Formular nur einmal aus dem ersten Laden füllen, im selben Schritt wie die Liste:
  // eine spätere Antwort (z.B. doppeltes Laden) darf Eingaben nicht überschreiben
  const formFilledFor = useRef<string | null>(null);
  const load = useCallback(
    (initForm = false) =>
      api
        .get<Diary>(`/projects/${projectId}/diary`)
        .then((d) => {
          setDiary(d);
          if (initForm && formFilledFor.current !== projectId) {
            formFilledFor.current = projectId;
            setForm(formOf(d.entries.find((e) => e.day === localToday())));
          }
          return d;
        })
        .catch(() => null),
    [projectId],
  );
  useEffect(() => {
    void load(true);
  }, [load]);

  const pick = (next: string) => {
    setDay(next);
    setMessage(null);
    setForm(formOf(diary?.entries.find((e) => e.day === next)));
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    const num = (v: string) => (v.trim() ? Number(v.replace(',', '.')) : null);
    setBusy(true);
    setMessage(null);
    try {
      await api.put(`/projects/${projectId}/diary/${day}`, {
        weather: form.weather || null,
        temperature: num(form.temperature),
        crew: form.crew,
        crewCount: num(form.crewCount),
        work: form.work,
        delayHours: num(form.delayHours),
        delayReason: form.delayReason || null,
        delayNote: form.delayNote,
        notes: form.notes,
      });
      await load();
      setMessage({ ok: true, text: `Bautagebuch für ${dayText(day)} gespeichert.` });
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.' });
    } finally {
      setBusy(false);
    }
  };

  // Druckansicht (oder als PDF speichern) in einem eigenen Fenster
  const print = () => {
    if (!diary) return;
    const rows = [...diary.entries]
      .reverse()
      .map(
        (e) =>
          `<tr><td>${dayText(e.day)}</td><td>${e.weather ? WEATHER[e.weather] : ''}${
            e.temperature !== null ? ` ${e.temperature} °C` : ''
          }</td><td>${escape(e.crew ?? '')}${e.crewCount ? ` (${e.crewCount})` : ''}</td><td>${escape(
            e.work ?? '',
          )}</td><td>${
            e.delayHours
              ? `${hours(e.delayHours)} ${e.delayReason ? REASONS[e.delayReason] : ''}: ${escape(e.delayNote ?? '')}`
              : ''
          }</td><td>${escape(e.notes ?? '')}</td></tr>`,
      )
      .join('');
    const w = window.open('', '_blank');
    if (!w) return;
    w.document.write(
      `<!doctype html><html lang="de"><head><meta charset="utf-8"><title>Bautagebuch ${escape(
        diary.project.title,
      )}</title><style>body{font-family:sans-serif;font-size:12px}table{border-collapse:collapse;width:100%}td,th{border:1px solid #999;padding:4px;vertical-align:top;text-align:left}</style></head><body><h2>Bautagebuch: ${escape(
        diary.project.title,
      )}</h2><p>Verzögerungen gesamt: ${hours(diary.delays.hours)} an ${diary.delays.days} Tagen</p><table><thead><tr><th>Tag</th><th>Wetter</th><th>Besetzung</th><th>Arbeiten</th><th>Verzögerung / Behinderung</th><th>Notizen</th></tr></thead><tbody>${rows}</tbody></table></body></html>`,
    );
    w.document.close();
    w.print();
  };

  const field = (key: keyof Form, label: string, props: Record<string, unknown> = {}) => (
    <label className="field" style={{ flex: '1 1 140px' }}>
      <span>{label}</span>
      <input
        value={form[key]}
        onChange={(e) => setForm({ ...form, [key]: e.target.value })}
        data-testid={`diary-${key}`}
        {...props}
      />
    </label>
  );

  return (
    <div data-testid="diary">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
        <h3 style={{ margin: 0 }}>Bautagebuch</h3>
        {!compact && !!diary?.entries.length && (
          <button className="btn btn-sm no-print" onClick={print} data-testid="diary-print">
            Drucken / PDF
          </button>
        )}
      </div>
      {!!diary?.delays.hours && (
        <p className="list-item-meta" data-testid="diary-delays">
          Verzögerungen gesamt: {hours(diary.delays.hours)} an {diary.delays.days}{' '}
          {diary.delays.days === 1 ? 'Tag' : 'Tagen'} (
          {diary.delays.byReason.map((r) => `${REASONS[r.reason]} ${hours(r.hours)}`).join(', ')})
        </p>
      )}
      {/* erst nach dem Laden: sonst überschreibt der geladene Stand schon Getipptes */}
      {!diary && <p className="list-item-meta">Lädt …</p>}
      {diary && (
        <form onSubmit={save} style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            <label className="field" style={{ flex: '1 1 140px' }}>
              <span>Tag</span>
              <input
                type="date"
                value={day}
                max={localToday()}
                onChange={(e) => e.target.value && pick(e.target.value)}
                data-testid="diary-day"
              />
            </label>
            <label className="field" style={{ flex: '1 1 140px' }}>
              <span>Wetter</span>
              <select
                value={form.weather}
                onChange={(e) => setForm({ ...form, weather: e.target.value })}
                data-testid="diary-weather"
              >
                <option value="">–</option>
                {Object.entries(WEATHER).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </select>
            </label>
            {field('temperature', 'Temperatur (°C)', { inputMode: 'numeric' })}
          </div>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {field('crew', 'Besetzung (wer war da)')}
            {field('crewCount', 'Personen', { inputMode: 'numeric' })}
          </div>
          <label className="field">
            <span>Ausgeführte Arbeiten</span>
            <textarea
              value={form.work}
              onChange={(e) => setForm({ ...form, work: e.target.value })}
              rows={3}
              maxLength={5000}
              data-testid="diary-work"
            />
          </label>
          <fieldset style={{ border: '1px solid var(--border, #ddd)', borderRadius: 8, padding: 8 }}>
            <legend>Verzögerung / Behinderung</legend>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              {field('delayHours', 'Stunden', { inputMode: 'decimal' })}
              <label className="field" style={{ flex: '1 1 160px' }}>
                <span>Ursache</span>
                <select
                  value={form.delayReason}
                  onChange={(e) => setForm({ ...form, delayReason: e.target.value })}
                  data-testid="diary-delayReason"
                >
                  <option value="">–</option>
                  {Object.entries(REASONS).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            {field('delayNote', 'Was ist passiert?')}
          </fieldset>
          {field('notes', 'Notizen (Anordnungen, Besuche, Abnahmen …)')}
          {message && (
            <p className={message.ok ? 'list-item-meta' : 'field-error'} data-testid="diary-message">
              {message.text}
            </p>
          )}
          <div>
            <button type="submit" className="btn btn-primary" disabled={busy} data-testid="diary-save">
              Speichern
            </button>
          </div>
        </form>
      )}
      {!compact && !!diary?.entries.length && (
        <div style={{ marginTop: 12 }} data-testid="diary-list">
          {diary.entries.map((e) => (
            <button
              key={e.day}
              type="button"
              className="list-item list-item-link"
              style={{ width: '100%', textAlign: 'left' }}
              onClick={() => pick(e.day)}
              data-testid="diary-entry"
            >
              <div>
                <div className="list-item-name">
                  {dayText(e.day)}
                  {e.weather ? ` · ${WEATHER[e.weather]}` : ''}
                  {e.temperature !== null ? ` ${e.temperature} °C` : ''}
                  {e.photos.length ? ` · ${e.photos.length} Foto${e.photos.length > 1 ? 's' : ''}` : ''}
                </div>
                {e.work && <div className="list-item-meta">{e.work}</div>}
                {!!e.delayHours && (
                  <div className="field-error">
                    Verzögerung {hours(e.delayHours)}
                    {e.delayReason ? ` (${REASONS[e.delayReason]})` : ''}
                    {e.delayNote ? `: ${e.delayNote}` : ''}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
