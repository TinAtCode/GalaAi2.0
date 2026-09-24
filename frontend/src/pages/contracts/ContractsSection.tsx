import { useEffect, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { useAuth } from '../../auth/AuthContext';
import { ContractCard } from './ContractCard';
import { ContractForm } from './ContractForm';
import { Assignee, Contract } from './types';

const inWeeks = (weeks: number) => {
  const d = new Date();
  d.setDate(d.getDate() + weeks * 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Pflege- und Wartungsverträge am Projekt. onChange: Termine oder Rechnungen
// haben sich geändert (die Projektseite lädt sie neu).
export function ContractsSection({
  projectId,
  contracts,
  onChange,
}: {
  projectId: string;
  contracts: Contract[];
  onChange: () => void;
}) {
  const { hasPermission } = useAuth();
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const canEdit = hasPermission('customer.write') && hasPermission('price.sale.read');
  const canPlan = hasPermission('customer.write');
  const canInvoice = hasPermission('invoice.create');

  useEffect(() => {
    if (!canPlan) return;
    api
      .get<Assignee[]>('/appointments/assignees')
      .then(setAssignees)
      .catch(() => setAssignees([]));
  }, [canPlan]);

  const run = async (action: () => Promise<string>) => {
    setError(null);
    setMessage(null);
    setBusy(true);
    try {
      setMessage(await action());
      onChange();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const plan = (contract: Contract) =>
    run(async () => {
      const result = await api.post<{ created: number; unassigned: number }>('/contracts/schedule', {
        contractId: contract.id,
        until: inWeeks(4),
      });
      return result.created
        ? `${result.created} Termin${result.created === 1 ? '' : 'e'} für die nächsten 4 Wochen geplant${result.unassigned ? `, ${result.unassigned} ohne Mitarbeiter (Überschneidung)` : ''}.`
        : 'In den nächsten 4 Wochen ist nichts mehr zu planen.';
    });

  const invoice = (contract: Contract) =>
    run(async () => {
      await api.post(`/contracts/${contract.id}/invoice`, {});
      return 'Rechnungsentwurf für den nächsten Zeitraum erstellt (siehe Rechnungen).';
    });

  const remove = (contract: Contract) => {
    if (!window.confirm(`Vertrag „${contract.title}“ löschen? Geplante künftige Termine werden abgesagt.`))
      return;
    void run(async () => {
      await api.delete(`/contracts/${contract.id}`);
      return 'Vertrag gelöscht.';
    });
  };

  const saved = () => {
    setEditing(null);
    onChange();
  };

  return (
    <>
      <div className="card-header">
        <h3>Pflegeverträge</h3>
        {canEdit && editing === null && (
          <button className="btn btn-sm" onClick={() => setEditing('new')} data-testid="contract-new">
            + Vertrag
          </button>
        )}
      </div>
      {editing === 'new' && (
        <ContractForm
          projectId={projectId}
          assignees={assignees}
          onSaved={saved}
          onCancel={() => setEditing(null)}
        />
      )}
      {contracts.length === 0 && editing !== 'new' && (
        <p className="list-item-meta">
          Kein Pflegevertrag. Wiederkehrende Arbeiten (z.B. Rasen mähen alle 2 Wochen) werden daraus als
          Termine geplant und je Zeitraum abgerechnet.
        </p>
      )}
      {message && (
        <p className="notice" data-testid="contract-message">
          {message}
        </p>
      )}
      {error && <p className="field-error">{error}</p>}
      {contracts.map((contract) =>
        editing === contract.id ? (
          <ContractForm
            key={contract.id}
            projectId={projectId}
            contract={contract}
            assignees={assignees}
            onSaved={saved}
            onCancel={() => setEditing(null)}
          />
        ) : (
          <ContractCard
            key={contract.id}
            contract={contract}
            actions={
              <>
                {canPlan && contract.status === 'active' && contract.tasks.length > 0 && (
                  <button
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => plan(contract)}
                    data-testid="contract-plan"
                  >
                    Termine planen (4 Wochen)
                  </button>
                )}
                {canInvoice && contract.status === 'active' && contract.nextPeriod && (
                  <button
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => invoice(contract)}
                    data-testid="contract-invoice"
                  >
                    Nächsten Zeitraum abrechnen
                  </button>
                )}
                {canEdit && (
                  <button
                    className="btn btn-sm btn-ghost"
                    onClick={() => setEditing(contract.id)}
                    data-testid="contract-edit"
                  >
                    Bearbeiten
                  </button>
                )}
                {canPlan && (
                  <button className="btn btn-sm btn-ghost btn-danger" onClick={() => remove(contract)}>
                    Löschen
                  </button>
                )}
              </>
            }
          />
        ),
      )}
    </>
  );
}
