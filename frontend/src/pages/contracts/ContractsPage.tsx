import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { formatEuro } from '../../format';
import { ContractCard } from './ContractCard';
import { Contract, ContractStatus, STATUS_LABELS } from './types';

const inDays = (days: number) => {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

const MONTHLY_FACTOR = { monthly: 1, quarterly: 1 / 3, halfyearly: 1 / 6, yearly: 1 / 12 } as const;

// Alle Pflegeverträge: fällige Einsätze planen, fällige Zeiträume abrechnen
export function ContractsPage() {
  const { hasPermission } = useAuth();
  const [contracts, setContracts] = useState<Contract[] | null>(null);
  const [filter, setFilter] = useState<ContractStatus | 'due'>('active');
  const [until, setUntil] = useState(inDays(28));
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    api
      .get<Contract[]>('/contracts')
      .then(setContracts)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Verträge konnten nicht geladen werden.'),
      );
  }, []);
  useEffect(load, [load]);

  const run = async (action: () => Promise<string>) => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      setMessage(await action());
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const active = contracts?.filter((c) => c.status === 'active') ?? [];
  const visible = (contracts ?? []).filter((c) =>
    filter === 'due' ? c.status === 'active' && (c.billingDue || c.tasksDue) : c.status === filter,
  );
  const monthly = active.reduce(
    (sum, c) => sum + (c.netPerPeriod ? Number(c.netPerPeriod) * MONTHLY_FACTOR[c.billingInterval] : 0),
    0,
  );
  const showPrices = hasPermission('price.sale.read');

  return (
    <div>
      <header className="page-header">
        <div>
          <h2>Pflegeverträge</h2>
          <p>Wiederkehrende Pflege und Wartung: Einsätze als Termine, Vergütung je Zeitraum als Rechnung.</p>
        </div>
      </header>

      <div className="stat-grid" style={{ marginBottom: 16 }}>
        <div className="stat">
          <div className="stat-label">Aktive Verträge</div>
          <div className="stat-value" data-testid="contracts-active">
            {active.length}
          </div>
        </div>
        {showPrices && (
          <div className="stat">
            <div className="stat-label">Vergütung pro Monat (netto)</div>
            <div className="stat-value" data-testid="contracts-monthly">
              {formatEuro(monthly)}
            </div>
          </div>
        )}
        <div className="stat">
          <div className="stat-label">Rechnung fällig</div>
          <div className="stat-value">{active.filter((c) => c.billingDue).length}</div>
        </div>
        <div className="stat">
          <div className="stat-label">Einsätze zu planen</div>
          <div className="stat-value">{active.filter((c) => c.tasksDue).length}</div>
        </div>
      </div>

      <div className="card">
        <div className="toolbar" style={{ marginBottom: 0 }}>
          {hasPermission('customer.write') && (
            <>
              <label className="inline-field">
                Termine planen bis
                <input
                  type="date"
                  value={until}
                  onChange={(e) => setUntil(e.target.value)}
                  data-testid="contracts-until"
                />
              </label>
              <button
                className="btn btn-primary"
                disabled={busy || !until}
                onClick={() =>
                  run(async () => {
                    const r = await api.post<{ created: number; unassigned: number }>('/contracts/schedule', {
                      until,
                    });
                    return `${r.created} Termin${r.created === 1 ? '' : 'e'} geplant${r.unassigned ? `, ${r.unassigned} ohne Mitarbeiter (Überschneidung)` : ''}.`;
                  })
                }
                data-testid="contracts-schedule"
              >
                Einsätze planen
              </button>
            </>
          )}
          {hasPermission('invoice.create') && (
            <button
              className="btn"
              disabled={busy}
              onClick={() =>
                run(async () => {
                  const r = await api.post<{ created: number }>('/contracts/invoice-due', {});
                  return r.created
                    ? `${r.created} Rechnungsentwurf${r.created === 1 ? '' : 'e'} erstellt – im Projekt prüfen und ausstellen.`
                    : 'Keine fälligen Zeiträume.';
                })
              }
              data-testid="contracts-invoice-due"
            >
              Fällige Rechnungen erstellen
            </button>
          )}
        </div>
      </div>

      {message && (
        <p className="notice" data-testid="contracts-message">
          {message}
        </p>
      )}
      {error && <p className="field-error">{error}</p>}

      <div className="chip-group" style={{ marginBottom: 14 }} role="group" aria-label="Filter">
        {(['active', 'due', 'paused', 'ended'] as const).map((key) => (
          <button key={key} className="chip" aria-pressed={filter === key} onClick={() => setFilter(key)}>
            {key === 'due' ? 'Fällig' : STATUS_LABELS[key]}
          </button>
        ))}
      </div>

      {contracts && visible.length === 0 && (
        <div className="empty-state">
          <strong>Keine Verträge</strong>
          Verträge werden am Projekt angelegt (Abschnitt „Pflegeverträge“).
        </div>
      )}
      {visible.map((contract) => (
        <ContractCard key={contract.id} contract={contract} showProject />
      ))}
    </div>
  );
}
