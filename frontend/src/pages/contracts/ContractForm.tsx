import { FormEvent, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { formatEuro, parseAmount } from '../../format';
import {
  Assignee,
  BillingInterval,
  Contract,
  ContractStatus,
  day,
  INTERVAL_LABELS,
  MONTHS,
  STATUS_LABELS,
} from './types';

interface LineDraft {
  description: string;
  unit: string;
  quantity: string;
  unitPrice: string;
}

interface TaskDraft {
  id?: string;
  title: string;
  everyWeeks: string;
  seasonFrom: number;
  seasonTo: number;
  time: string;
  durationMinutes: number;
  assignedUserId: string;
  nextDue: string;
}

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const toTime = (minutes: number) =>
  `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
const toMinutes = (time: string) => {
  const [h, m] = time.split(':').map(Number);
  return h * 60 + m;
};
const german = (value: string) => String(value).replace('.', ',');

const emptyLine = (): LineDraft => ({ description: '', unit: 'psch', quantity: '1', unitPrice: '' });
const emptyTask = (): TaskDraft => ({
  title: '',
  everyWeeks: '2',
  seasonFrom: 4,
  seasonTo: 10,
  time: '08:00',
  durationMinutes: 120,
  assignedUserId: '',
  nextDue: today(),
});

const DURATIONS = [30, 60, 90, 120, 180, 240, 360, 480];

// Anlegen und Bearbeiten eines Pflegevertrags: Vergütung je Zeitraum
// (Positionen) und wiederkehrende Einsätze
export function ContractForm({
  projectId,
  contract,
  assignees,
  onSaved,
  onCancel,
}: {
  projectId: string;
  contract?: Contract;
  assignees: Assignee[];
  onSaved: () => void;
  onCancel: () => void;
}) {
  const [title, setTitle] = useState(contract?.title ?? '');
  const [status, setStatus] = useState<ContractStatus>(contract?.status ?? 'active');
  const [startDate, setStartDate] = useState(contract ? day(contract.startDate) : today());
  const [endDate, setEndDate] = useState(contract?.endDate ? day(contract.endDate) : '');
  const [billingInterval, setBillingInterval] = useState<BillingInterval>(
    contract?.billingInterval ?? 'monthly',
  );
  const [billInAdvance, setBillInAdvance] = useState(contract?.billInAdvance ?? true);
  const [notes, setNotes] = useState(contract?.notes ?? '');
  const [lines, setLines] = useState<LineDraft[]>(
    contract?.lines.map((l) => ({
      description: l.description,
      unit: l.unit,
      quantity: german(l.quantity),
      unitPrice: l.unitPrice === undefined ? '' : german(Number(l.unitPrice).toFixed(2)),
    })) ?? [emptyLine()],
  );
  const [tasks, setTasks] = useState<TaskDraft[]>(
    contract?.tasks.map((t) => ({
      id: t.id,
      title: t.title,
      everyWeeks: String(t.everyWeeks),
      seasonFrom: t.seasonFrom,
      seasonTo: t.seasonTo,
      time: toTime(t.startMinutes),
      durationMinutes: t.durationMinutes,
      assignedUserId: t.assignedUserId ?? '',
      nextDue: day(t.nextDue),
    })) ?? [emptyTask()],
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const lineTotal = (l: LineDraft) => {
    const total = parseAmount(l.quantity) * parseAmount(l.unitPrice);
    return Number.isFinite(total) ? Math.round(total * 100) / 100 : 0;
  };
  const netPerPeriod = lines.reduce((sum, l) => sum + lineTotal(l), 0);

  const setLine = (index: number, patch: Partial<LineDraft>) =>
    setLines(lines.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  const setTask = (index: number, patch: Partial<TaskDraft>) =>
    setTasks(tasks.map((t, i) => (i === index ? { ...t, ...patch } : t)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const body = {
      projectId,
      title,
      startDate,
      endDate: endDate || null,
      billingInterval,
      billInAdvance,
      notes: notes || null,
      ...(contract ? { status } : {}),
      lines: lines
        .filter((l) => l.description.trim())
        .map((l) => ({
          description: l.description,
          unit: l.unit,
          quantity: parseAmount(l.quantity),
          unitPrice: parseAmount(l.unitPrice || '0'),
        })),
      tasks: tasks
        .filter((t) => t.title.trim())
        .map((t) => ({
          ...(t.id ? { id: t.id } : {}),
          title: t.title,
          everyWeeks: Number(t.everyWeeks),
          seasonFrom: t.seasonFrom,
          seasonTo: t.seasonTo,
          startMinutes: toMinutes(t.time),
          durationMinutes: t.durationMinutes,
          assignedUserId: t.assignedUserId || null,
          nextDue: t.nextDue,
        })),
    };
    if (body.lines.some((l) => !Number.isFinite(l.quantity) || !Number.isFinite(l.unitPrice))) {
      setError('Menge und Preis als Zahl angeben, z.B. 2,5 und 48,50.');
      return;
    }
    setSaving(true);
    try {
      if (contract) await api.put(`/contracts/${contract.id}`, body);
      else await api.post('/contracts', body);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Vertrag konnte nicht gespeichert werden.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} className="contract-form" data-testid="contract-form">
      <div className="form-grid">
        <label className="field form-grid-full">
          <span>Bezeichnung</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="z.B. Grünpflege Wohnanlage 2026"
            required
            minLength={2}
            data-testid="contract-title"
          />
        </label>
        <label className="field">
          <span>Beginn</span>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            required
            data-testid="contract-start"
          />
        </label>
        <label className="field">
          <span>Ende (leer = unbefristet)</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />
        </label>
        <label className="field">
          <span>Abrechnung</span>
          <select
            value={billingInterval}
            onChange={(e) => setBillingInterval(e.target.value as BillingInterval)}
            data-testid="contract-interval"
          >
            {Object.entries(INTERVAL_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <div className="field">
          <span>Zeitpunkt</span>
          <div className="segmented" role="group" aria-label="Zeitpunkt der Abrechnung">
            <button type="button" aria-pressed={billInAdvance} onClick={() => setBillInAdvance(true)}>
              im Voraus
            </button>
            <button type="button" aria-pressed={!billInAdvance} onClick={() => setBillInAdvance(false)}>
              nachträglich
            </button>
          </div>
        </div>
        {contract && (
          <label className="field">
            <span>Status</span>
            <select
              value={status}
              onChange={(e) => setStatus(e.target.value as ContractStatus)}
              data-testid="contract-status"
            >
              {Object.entries(STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <h4 className="contract-form-heading">Vergütung je Zeitraum (netto)</h4>
      <div className="contract-rows">
        {lines.map((line, index) => (
          <div key={index} className="contract-line" data-testid="contract-line">
            <input
              className="grow"
              value={line.description}
              onChange={(e) => setLine(index, { description: e.target.value })}
              placeholder="Leistung, z.B. Rasenpflege pauschal"
              aria-label="Leistung"
              data-testid="contract-line-description"
            />
            <input
              className="narrow"
              value={line.quantity}
              onChange={(e) => setLine(index, { quantity: e.target.value })}
              inputMode="decimal"
              aria-label="Menge"
              data-testid="contract-line-quantity"
            />
            <input
              className="narrow"
              value={line.unit}
              onChange={(e) => setLine(index, { unit: e.target.value })}
              aria-label="Einheit"
            />
            <input
              className="narrow"
              value={line.unitPrice}
              onChange={(e) => setLine(index, { unitPrice: e.target.value })}
              inputMode="decimal"
              placeholder="Preis"
              aria-label="Preis je Einheit"
              data-testid="contract-line-price"
            />
            <span className="contract-line-total">{formatEuro(lineTotal(line))}</span>
            <button
              type="button"
              className="btn btn-sm btn-ghost"
              onClick={() => setLines(lines.filter((_, i) => i !== index))}
              aria-label="Position entfernen"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      <div className="btn-row" style={{ justifyContent: 'space-between', marginTop: 8 }}>
        <button type="button" className="btn btn-sm" onClick={() => setLines([...lines, emptyLine()])}>
          + Position
        </button>
        <strong data-testid="contract-form-total">
          {formatEuro(netPerPeriod)} {INTERVAL_LABELS[billingInterval]}
        </strong>
      </div>

      <h4 className="contract-form-heading">Einsätze</h4>
      <div className="contract-rows">
        {tasks.map((task, index) => (
          <div key={task.id ?? `new-${index}`} className="contract-task" data-testid="contract-task">
            <div className="contract-row">
              <input
                className="grow"
                value={task.title}
                onChange={(e) => setTask(index, { title: e.target.value })}
                placeholder="z.B. Rasen mähen"
                aria-label="Einsatz"
                data-testid="contract-task-title"
              />
              <label className="inline-field">
                alle
                <input
                  className="tiny"
                  type="number"
                  min={1}
                  max={52}
                  value={task.everyWeeks}
                  onChange={(e) => setTask(index, { everyWeeks: e.target.value })}
                  aria-label="Rhythmus in Wochen"
                  data-testid="contract-task-weeks"
                />
                Wochen
              </label>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setTasks(tasks.filter((_, i) => i !== index))}
                aria-label="Einsatz entfernen"
              >
                ✕
              </button>
            </div>
            <div className="contract-row">
              <label className="inline-field">
                Saison
                <select
                  value={task.seasonFrom}
                  onChange={(e) => setTask(index, { seasonFrom: Number(e.target.value) })}
                  aria-label="Saison von"
                >
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
                –
                <select
                  value={task.seasonTo}
                  onChange={(e) => setTask(index, { seasonTo: Number(e.target.value) })}
                  aria-label="Saison bis"
                >
                  {MONTHS.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m}
                    </option>
                  ))}
                </select>
              </label>
              <label className="inline-field">
                ab
                <input
                  type="date"
                  value={task.nextDue}
                  onChange={(e) => setTask(index, { nextDue: e.target.value })}
                  required
                  aria-label="Nächster Termin"
                  data-testid="contract-task-next"
                />
              </label>
              <label className="inline-field">
                um
                <input
                  type="time"
                  value={task.time}
                  onChange={(e) => setTask(index, { time: e.target.value })}
                  aria-label="Uhrzeit"
                />
              </label>
              <select
                value={task.durationMinutes}
                onChange={(e) => setTask(index, { durationMinutes: Number(e.target.value) })}
                aria-label="Dauer"
              >
                {DURATIONS.map((d) => (
                  <option key={d} value={d}>
                    {d < 60 ? `${d} min` : `${(d / 60).toLocaleString('de-DE')} h`}
                  </option>
                ))}
              </select>
              <select
                value={task.assignedUserId}
                onChange={(e) => setTask(index, { assignedUserId: e.target.value })}
                aria-label="Mitarbeiter"
                data-testid="contract-task-assignee"
              >
                <option value="">ohne Mitarbeiter</option>
                {assignees.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.firstName} {a.lastName}
                  </option>
                ))}
              </select>
            </div>
          </div>
        ))}
      </div>
      <button
        type="button"
        className="btn btn-sm"
        style={{ marginTop: 8 }}
        onClick={() => setTasks([...tasks, emptyTask()])}
      >
        + Einsatz
      </button>

      <label className="field" style={{ marginTop: 14 }}>
        <span>Notizen</span>
        <textarea value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>

      {error && (
        <p className="field-error" data-testid="contract-error">
          {error}
        </p>
      )}
      <div className="btn-row" style={{ marginTop: 14 }}>
        <button type="submit" className="btn btn-primary" disabled={saving} data-testid="contract-save">
          {contract ? 'Speichern' : 'Vertrag anlegen'}
        </button>
        <button type="button" className="btn btn-ghost" onClick={onCancel}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
