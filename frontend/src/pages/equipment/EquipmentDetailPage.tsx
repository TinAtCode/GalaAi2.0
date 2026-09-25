import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import {
  DAMAGE_STATUS,
  Damage,
  DamageSeverity,
  DamageStatus,
  dayText,
  Equipment,
  EquipmentKind,
  KIND,
  Maintenance,
  SEVERITY,
  STATUS,
  today,
} from './types';

type Detail = Equipment & { damages: Damage[]; maintenance: Maintenance[] };

const money = (value: number) => value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const num = (value: string) => (value.trim() ? Number(value.replace(',', '.')) : null);

// Ein Gerät: Schaden melden (jeder), Schäden erledigen und Wartungen pflegen
// (Büro/Werkstatt), Stammdaten bearbeiten.
export function EquipmentDetailPage() {
  const { id } = useParams();
  const { hasPermission } = useAuth();
  const canManage = hasPermission('masterdata.write');
  const [detail, setDetail] = useState<Detail | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const load = useCallback(() => {
    api
      .get<Detail>(`/equipment/${id}`)
      .then(setDetail)
      .catch(() => setMessage({ ok: false, text: 'Gerät konnte nicht geladen werden.' }));
  }, [id]);
  useEffect(load, [load]);

  const run = async (action: () => Promise<unknown>, ok: string) => {
    try {
      await action();
      setMessage({ ok: true, text: ok });
      load();
      return true;
    } catch (err) {
      setMessage({ ok: false, text: err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.' });
      return false;
    }
  };

  if (!detail) return <p>{message?.text ?? 'Lädt …'}</p>;

  return (
    <div data-testid="equipment-detail">
      <header className="page-header">
        <div>
          <div className="list-item-meta" style={{ marginBottom: 4 }}>
            <Link to="/geraete">Geräte und Fahrzeuge</Link>
          </div>
          <h2>{detail.name}</h2>
        </div>
        <span
          className={`status-badge ${detail.retired ? '' : STATUS[detail.status].badge}`}
          data-testid="equipment-status"
        >
          {detail.retired ? 'ausgemustert' : STATUS[detail.status].label}
        </span>
      </header>
      {message && (
        <p className={message.ok ? 'notice' : 'field-error'} data-testid="equipment-message">
          {message.text}
        </p>
      )}

      <section className="card">
        <p className="list-item-meta">
          {KIND[detail.kind]}
          {detail.inventoryNumber && ` · Inventarnummer ${detail.inventoryNumber}`}
          {detail.licensePlate && ` · ${detail.licensePlate}`}
          {detail.serialNumber && ` · Serien-Nr. ${detail.serialNumber}`}
          {detail.location && ` · Standort ${detail.location}`}
          {detail.machine && ` · Kalkulation: ${detail.machine.name}`}
          {detail.lastInventoryAt &&
            ` · zuletzt inventarisiert ${new Date(detail.lastInventoryAt).toLocaleDateString('de-DE')}`}
        </p>
        {detail.notes && <p>{detail.notes}</p>}
        {canManage && (
          <EditForm
            detail={detail}
            onSave={(body) => run(() => api.put(`/equipment/${id}`, body), 'Gespeichert.')}
          />
        )}
      </section>

      <section className="card">
        <h3>Schäden</h3>
        {!detail.retired && (
          <DamageForm
            onReport={(body) => run(() => api.post(`/equipment/${id}/damages`, body), 'Schaden gemeldet.')}
          />
        )}
        {detail.damages.length === 0 && <p className="list-item-meta">Keine Schäden gemeldet.</p>}
        <div className="list">
          {detail.damages.map((d) => (
            <DamageRow
              key={d.id}
              damage={d}
              canManage={canManage}
              onUpdate={(body) =>
                run(() => api.put(`/equipment/damages/${d.id}`, body), 'Schaden aktualisiert.')
              }
            />
          ))}
        </div>
      </section>

      <section className="card">
        <h3>Wartung und Prüfungen</h3>
        {detail.maintenance.length === 0 && <p className="list-item-meta">Keine Wartungen hinterlegt.</p>}
        <div className="list">
          {detail.maintenance.map((m) => (
            <MaintenanceRow
              key={m.id}
              maintenance={m}
              canManage={canManage}
              onDone={(body) =>
                run(() => api.post(`/equipment/maintenance/${m.id}/done`, body), `${m.title} erledigt.`)
              }
              onToggle={() =>
                run(
                  () =>
                    api.put(`/equipment/maintenance/${m.id}`, {
                      title: m.title,
                      intervalMonths: m.intervalMonths,
                      nextDue: m.nextDue,
                      notes: m.notes,
                      active: !m.active,
                    }),
                  m.active ? 'Wartung beendet.' : 'Wartung wieder aktiv.',
                )
              }
            />
          ))}
        </div>
        {canManage && (
          <MaintenanceForm
            onAdd={(body) => run(() => api.post(`/equipment/${id}/maintenance`, body), 'Wartung angelegt.')}
          />
        )}
      </section>
    </div>
  );
}

function EditForm({ detail, onSave }: { detail: Detail; onSave: (body: unknown) => Promise<boolean> }) {
  const [open, setOpen] = useState(false);
  const [machines, setMachines] = useState<{ id: string; name: string }[]>([]);
  const [form, setForm] = useState({
    name: detail.name,
    kind: detail.kind,
    inventoryNumber: detail.inventoryNumber ?? '',
    licensePlate: detail.licensePlate ?? '',
    serialNumber: detail.serialNumber ?? '',
    location: detail.location ?? '',
    machineId: detail.machineId ?? '',
    notes: detail.notes ?? '',
    retired: detail.retired,
  });
  useEffect(() => {
    if (!open) return;
    api
      .get<{ id: string; name: string }[]>('/machines')
      .then(setMachines)
      .catch(() => setMachines([]));
  }, [open]);

  if (!open)
    return (
      <button className="btn btn-sm" onClick={() => setOpen(true)} data-testid="equipment-edit">
        Bearbeiten
      </button>
    );
  const text = (key: keyof typeof form, label: string) => (
    <label className="field">
      <span>{label}</span>
      <input value={form[key] as string} onChange={(e) => setForm({ ...form, [key]: e.target.value })} />
    </label>
  );
  return (
    <form
      className="login-form"
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onSave({ ...form, machineId: form.machineId || null })) setOpen(false);
      }}
    >
      {text('name', 'Bezeichnung')}
      <label className="field">
        <span>Art</span>
        <select
          value={form.kind}
          onChange={(e) => setForm({ ...form, kind: e.target.value as EquipmentKind })}
        >
          {Object.entries(KIND).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      {text('inventoryNumber', 'Inventarnummer')}
      {text('licensePlate', 'Kennzeichen')}
      {text('serialNumber', 'Seriennummer')}
      {text('location', 'Standort')}
      <label className="field">
        <span>Maschine in der Kalkulation (Stundensatz)</span>
        <select value={form.machineId} onChange={(e) => setForm({ ...form, machineId: e.target.value })}>
          <option value="">– keine –</option>
          {machines.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </select>
      </label>
      {text('notes', 'Notiz')}
      <label style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
        <input
          type="checkbox"
          checked={form.retired}
          onChange={(e) => setForm({ ...form, retired: e.target.checked })}
        />
        ausgemustert
      </label>
      <div className="btn-row">
        <button type="submit" className="btn btn-primary">
          Speichern
        </button>
        <button type="button" className="btn btn-ghost" onClick={() => setOpen(false)}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}

function DamageForm({ onReport }: { onReport: (body: unknown) => Promise<boolean> }) {
  const [description, setDescription] = useState('');
  const [severity, setSeverity] = useState<DamageSeverity>('limited');
  return (
    <form
      className="login-form"
      style={{ marginBottom: 12 }}
      onSubmit={async (e) => {
        e.preventDefault();
        if (await onReport({ description, severity })) setDescription('');
      }}
      data-testid="damage-form"
    >
      <label className="field">
        <span>Schaden melden</span>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          required
          minLength={3}
          rows={2}
          placeholder="Was ist kaputt? Wo, seit wann?"
          data-testid="damage-description"
        />
      </label>
      <label className="field">
        <span>Nutzbarkeit</span>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as DamageSeverity)}
          data-testid="damage-severity"
        >
          {Object.entries(SEVERITY).map(([key, label]) => (
            <option key={key} value={key}>
              {label}
            </option>
          ))}
        </select>
      </label>
      <button type="submit" className="btn btn-primary" data-testid="damage-report">
        Melden
      </button>
    </form>
  );
}

function DamageRow({
  damage: d,
  canManage,
  onUpdate,
}: {
  damage: Damage;
  canManage: boolean;
  onUpdate: (body: unknown) => Promise<boolean>;
}) {
  const [status, setStatus] = useState<DamageStatus>(d.status);
  const [cost, setCost] = useState(d.repairCost?.toString().replace('.', ',') ?? '');
  const [note, setNote] = useState(d.resolutionNote ?? '');
  return (
    <div className="list-item" style={{ flexWrap: 'wrap', gap: 8 }} data-testid="damage-row">
      <div style={{ flex: '1 1 240px' }}>
        <div className="list-item-name">{d.description}</div>
        <div className="list-item-meta">
          {new Date(d.createdAt).toLocaleDateString('de-DE')} · {SEVERITY[d.severity]}
          {d.repairCost !== null && ` · Reparatur ${money(d.repairCost)}`}
          {d.resolutionNote && ` · ${d.resolutionNote}`}
        </div>
      </div>
      {canManage ? (
        <form
          className="btn-row"
          onSubmit={(e) => {
            e.preventDefault();
            void onUpdate({ status, repairCost: num(cost), resolutionNote: note });
          }}
        >
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as DamageStatus)}
            data-testid="damage-status"
          >
            {Object.entries(DAMAGE_STATUS).map(([key, { label }]) => (
              <option key={key} value={key}>
                {label}
              </option>
            ))}
          </select>
          <input
            value={cost}
            onChange={(e) => setCost(e.target.value)}
            placeholder="Kosten €"
            inputMode="decimal"
            style={{ width: 90 }}
          />
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Was wurde gemacht?" />
          <button type="submit" className="btn btn-sm" data-testid="damage-save">
            Speichern
          </button>
        </form>
      ) : (
        <span className={`status-badge ${DAMAGE_STATUS[d.status].badge}`}>
          {DAMAGE_STATUS[d.status].label}
        </span>
      )}
    </div>
  );
}

function MaintenanceRow({
  maintenance: m,
  canManage,
  onDone,
  onToggle,
}: {
  maintenance: Maintenance;
  canManage: boolean;
  onDone: (body: unknown) => Promise<boolean>;
  onToggle: () => void;
}) {
  const [doneOn, setDoneOn] = useState(today);
  const [note, setNote] = useState('');
  const [cost, setCost] = useState('');
  const overdue = m.active && m.nextDue < today();
  return (
    <div
      className="list-item"
      style={{ flexWrap: 'wrap', gap: 8, opacity: m.active ? 1 : 0.6 }}
      data-testid="maintenance-row"
    >
      <div style={{ flex: '1 1 240px' }}>
        <div className="list-item-name">{m.title}</div>
        <div className="list-item-meta">
          {m.active ? (
            <span
              className={`status-badge ${overdue ? 'status-overdue' : 'status-planned'}`}
              data-testid="maintenance-due"
            >
              {overdue ? 'überfällig seit ' : 'fällig '}
              {dayText(m.nextDue)}
            </span>
          ) : (
            'beendet'
          )}
          {m.intervalMonths && ` · alle ${m.intervalMonths} Monate`}
          {m.lastDone && ` · zuletzt ${dayText(m.lastDone)}`}
        </div>
        {m.logs.length > 0 && (
          <div className="list-item-meta">
            {m.logs
              .map(
                (l) =>
                  `${dayText(l.doneOn)}${l.cost !== null ? ` (${money(l.cost)})` : ''}${l.note ? `: ${l.note}` : ''}`,
              )
              .join(' · ')}
          </div>
        )}
      </div>
      {canManage && (
        <form
          className="btn-row"
          onSubmit={async (e) => {
            e.preventDefault();
            if (await onDone({ doneOn, note, cost: num(cost) })) {
              setNote('');
              setCost('');
            }
          }}
        >
          {m.active && (
            <>
              <input type="date" value={doneOn} max={today()} onChange={(e) => setDoneOn(e.target.value)} />
              <input
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Notiz"
                style={{ width: 120 }}
              />
              <input
                value={cost}
                onChange={(e) => setCost(e.target.value)}
                placeholder="Kosten €"
                inputMode="decimal"
                style={{ width: 90 }}
              />
              <button type="submit" className="btn btn-sm btn-primary" data-testid="maintenance-done">
                Erledigt
              </button>
            </>
          )}
          <button type="button" className="btn btn-sm btn-ghost" onClick={onToggle}>
            {m.active ? 'Beenden' : 'Wieder aktiv'}
          </button>
        </form>
      )}
    </div>
  );
}

const PRESETS: [string, number][] = [
  ['HU/TÜV', 12],
  ['UVV-Prüfung', 12],
  ['Inspektion', 12],
  ['Ölwechsel', 6],
  ['Elektroprüfung (DGUV V3)', 12],
];

function MaintenanceForm({ onAdd }: { onAdd: (body: unknown) => Promise<boolean> }) {
  const [title, setTitle] = useState('');
  const [months, setMonths] = useState('12');
  const [nextDue, setNextDue] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (await onAdd({ title, intervalMonths: months ? Number(months) : null, nextDue })) {
      setTitle('');
      setNextDue('');
    }
  };
  return (
    <form className="login-form" onSubmit={submit} style={{ marginTop: 12 }} data-testid="maintenance-form">
      <strong>Neue Wartung oder Prüfung</strong>
      <div className="chip-group">
        {PRESETS.map(([label, presetMonths]) => (
          <button
            key={label}
            type="button"
            className="chip"
            onClick={() => {
              setTitle(label);
              setMonths(String(presetMonths));
            }}
          >
            {label}
          </button>
        ))}
      </div>
      <label className="field">
        <span>Bezeichnung</span>
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          required
          minLength={2}
          data-testid="maintenance-title"
        />
      </label>
      <label className="field">
        <span>Intervall in Monaten (leer = einmalig)</span>
        <input
          value={months}
          onChange={(e) => setMonths(e.target.value.replace(/\D/g, ''))}
          inputMode="numeric"
          data-testid="maintenance-interval"
        />
      </label>
      <label className="field">
        <span>Nächste Fälligkeit</span>
        <input
          type="date"
          value={nextDue}
          onChange={(e) => setNextDue(e.target.value)}
          required
          data-testid="maintenance-next"
        />
      </label>
      <button type="submit" className="btn btn-primary" data-testid="maintenance-add">
        Anlegen
      </button>
    </form>
  );
}
