import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { InventorySection } from './InventorySection';
import {
  DAMAGE_STATUS,
  Damage,
  dayText,
  DueMaintenance,
  Equipment,
  EquipmentKind,
  KIND,
  SEVERITY,
  STATUS,
} from './types';

type Tab = 'geraete' | 'schaeden' | 'wartung' | 'inventur';
const TABS: [Tab, string][] = [
  ['geraete', 'Geräte'],
  ['schaeden', 'Schäden'],
  ['wartung', 'Wartung'],
  ['inventur', 'Inventur'],
];

// Geräte und Fahrzeuge: Übersicht mit Zustand, offene Schäden, fällige
// Wartungen und Inventur. Anlegen und pflegen darf, wer Stammdaten pflegt.
export function EquipmentPage() {
  const { hasPermission } = useAuth();
  const canManage = hasPermission('masterdata.write');
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find(([key]) => key === params.get('tab'))?.[0] ?? 'geraete') as Tab;

  return (
    <div data-testid="equipment">
      <header className="page-header">
        <h2>Geräte und Fahrzeuge</h2>
      </header>
      <div className="tab-bar" role="tablist">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            role="tab"
            className={tab === key ? 'active' : ''}
            aria-selected={tab === key}
            onClick={() => setParams(key === 'geraete' ? {} : { tab: key })}
            data-testid={`equipment-tab-${key}`}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === 'geraete' && <EquipmentList canManage={canManage} />}
      {tab === 'schaeden' && <OpenDamages />}
      {tab === 'wartung' && <DueList />}
      {tab === 'inventur' && <InventorySection canManage={canManage} />}
    </div>
  );
}

const EMPTY = {
  name: '',
  kind: 'machine' as EquipmentKind,
  inventoryNumber: '',
  licensePlate: '',
  location: '',
};

function EquipmentList({ canManage }: { canManage: boolean }) {
  const [items, setItems] = useState<Equipment[] | null>(null);
  const [filter, setFilter] = useState<'active' | 'defect' | 'retired'>('active');
  const [form, setForm] = useState(EMPTY);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    api
      .get<Equipment[]>('/equipment')
      .then(setItems)
      .catch(() => setError('Geräte konnten nicht geladen werden.'));
  }, []);
  useEffect(load, [load]);

  const create = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api.post('/equipment', form);
      setForm(EMPTY);
      setShowForm(false);
      setError(null);
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Anlegen fehlgeschlagen.');
    }
  };

  const shown = (items ?? []).filter((e) =>
    filter === 'retired' ? e.retired : !e.retired && (filter === 'active' || e.status !== 'ready'),
  );

  return (
    <>
      <div className="toolbar">
        <div className="chip-group" role="group" aria-label="Filter">
          {(
            [
              ['active', 'Im Einsatz'],
              ['defect', 'Defekt/eingeschränkt'],
              ['retired', 'Ausgemustert'],
            ] as const
          ).map(([key, label]) => (
            <button key={key} className="chip" aria-pressed={filter === key} onClick={() => setFilter(key)}>
              {label}
            </button>
          ))}
        </div>
        {canManage && (
          <button
            className="btn btn-primary"
            onClick={() => setShowForm(!showForm)}
            data-testid="equipment-new"
          >
            Neues Gerät
          </button>
        )}
      </div>
      {showForm && (
        <form
          className="card login-form"
          onSubmit={create}
          style={{ marginBottom: 16 }}
          data-testid="equipment-form"
        >
          <label className="field">
            <span>Bezeichnung</span>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              required
              minLength={2}
              data-testid="equipment-name"
            />
          </label>
          <label className="field">
            <span>Art</span>
            <select
              value={form.kind}
              onChange={(e) => setForm({ ...form, kind: e.target.value as EquipmentKind })}
              data-testid="equipment-kind"
            >
              {Object.entries(KIND).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span>Inventarnummer</span>
            <input
              value={form.inventoryNumber}
              onChange={(e) => setForm({ ...form, inventoryNumber: e.target.value })}
              data-testid="equipment-inventory"
            />
          </label>
          {(form.kind === 'vehicle' || form.kind === 'trailer') && (
            <label className="field">
              <span>Kennzeichen</span>
              <input
                value={form.licensePlate}
                onChange={(e) => setForm({ ...form, licensePlate: e.target.value })}
              />
            </label>
          )}
          <label className="field">
            <span>Standort</span>
            <input value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} />
          </label>
          <button type="submit" className="btn btn-primary" data-testid="equipment-save">
            Anlegen
          </button>
        </form>
      )}
      {error && <p className="field-error">{error}</p>}
      {items === null && !error && <p>Lädt …</p>}
      {items && shown.length === 0 && <div className="empty-state">Keine Geräte in dieser Ansicht.</div>}
      <div className="list">
        {shown.map((e) => (
          <Link
            key={e.id}
            to={`/geraete/${e.id}`}
            className="list-item list-item-link"
            data-testid="equipment-item"
          >
            <div>
              <div className="list-item-name">
                {e.name}
                {e.inventoryNumber && <span className="list-item-meta"> · {e.inventoryNumber}</span>}
              </div>
              <div className="list-item-meta">
                {KIND[e.kind]}
                {e.licensePlate && ` · ${e.licensePlate}`}
                {e.location && ` · ${e.location}`}
                {!!e.openDamages && ` · ${e.openDamages} offene Schäden`}
                {e.nextMaintenance && ` · ${e.nextMaintenance.title} am ${dayText(e.nextMaintenance.due)}`}
              </div>
            </div>
            <span className={`status-badge ${e.retired ? '' : STATUS[e.status].badge}`}>
              {e.retired ? 'ausgemustert' : STATUS[e.status].label}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}

function OpenDamages() {
  const [damages, setDamages] = useState<Damage[] | null>(null);
  useEffect(() => {
    api
      .get<Damage[]>('/equipment/damages')
      .then(setDamages)
      .catch(() => setDamages([]));
  }, []);
  if (damages === null) return <p>Lädt …</p>;
  if (damages.length === 0) return <div className="empty-state">Keine offenen Schäden.</div>;
  return (
    <div className="list" data-testid="equipment-damages">
      {damages.map((d) => (
        <Link key={d.id} to={`/geraete/${d.equipmentId}`} className="list-item list-item-link">
          <div>
            <div className="list-item-name">{d.equipment?.name}</div>
            <div className="list-item-meta">
              {new Date(d.createdAt).toLocaleDateString('de-DE')} · {SEVERITY[d.severity]} · {d.description}
            </div>
          </div>
          <span className={`status-badge ${DAMAGE_STATUS[d.status].badge}`}>
            {DAMAGE_STATUS[d.status].label}
          </span>
        </Link>
      ))}
    </div>
  );
}

function DueList() {
  const [due, setDue] = useState<DueMaintenance[] | null>(null);
  useEffect(() => {
    const until = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
    api
      .get<DueMaintenance[]>(`/equipment/maintenance/due?until=${until}`)
      .then(setDue)
      .catch(() => setDue([]));
  }, []);
  if (due === null) return <p>Lädt …</p>;
  return (
    <>
      <p className="list-item-meta">Wartungen und Prüfungen der nächsten 60 Tage und alles Überfällige.</p>
      {due.length === 0 && <div className="empty-state">Nichts fällig.</div>}
      <div className="list" data-testid="equipment-due">
        {due.map((m) => (
          <Link key={m.id} to={`/geraete/${m.equipment.id}`} className="list-item list-item-link">
            <div>
              <div className="list-item-name">{m.title}</div>
              <div className="list-item-meta">{m.equipment.name}</div>
            </div>
            <span className={`status-badge ${m.overdue ? 'status-overdue' : 'status-planned'}`}>
              {m.overdue ? 'überfällig seit ' : 'fällig '}
              {dayText(m.due)}
            </span>
          </Link>
        ))}
      </div>
    </>
  );
}
