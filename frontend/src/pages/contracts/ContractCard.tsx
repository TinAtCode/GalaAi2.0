import { Link } from 'react-router-dom';
import { formatEuro } from '../../format';
import { Contract, formatDay, INTERVAL_LABELS, STATUS_LABELS, taskSummary } from './types';

// Ein Vertrag als Karte: Vergütung, nächster Zeitraum, Einsätze und Aktionen
export function ContractCard({
  contract,
  showProject,
  actions,
}: {
  contract: Contract;
  showProject?: boolean;
  actions?: React.ReactNode;
}) {
  return (
    <article className="job-card contract-card" data-testid="contract-card" data-contract-id={contract.id}>
      <div className="card-header" style={{ marginBottom: 4 }}>
        <div>
          <div className="list-item-name" data-testid="contract-card-title">
            {contract.title}
          </div>
          {showProject && (
            <div className="list-item-meta">
              <Link to={`/projekte/${contract.project.id}`}>{contract.project.title}</Link> ·{' '}
              {contract.project.property.customer.name}
            </div>
          )}
        </div>
        <div className="btn-row">
          {contract.billingDue && (
            <span className="status-badge status-overdue" data-testid="contract-billing-due">
              Rechnung fällig
            </span>
          )}
          {contract.tasksDue && (
            <span className="status-badge status-planned" data-testid="contract-tasks-due">
              Einsätze zu planen
            </span>
          )}
          <span
            className={`status-badge status-contract-${contract.status}`}
            data-testid="contract-status-badge"
          >
            {STATUS_LABELS[contract.status]}
          </span>
        </div>
      </div>
      <p className="list-item-meta" style={{ margin: '0 0 8px' }}>
        {contract.netPerPeriod !== undefined && (
          <>
            <strong data-testid="contract-net">{formatEuro(contract.netPerPeriod)}</strong> netto{' '}
          </>
        )}
        {INTERVAL_LABELS[contract.billingInterval]}, {contract.billInAdvance ? 'im Voraus' : 'nachträglich'} ·
        seit {formatDay(contract.startDate)}
        {contract.endDate ? ` bis ${formatDay(contract.endDate)}` : ''}
        {contract.nextPeriod && contract.status === 'active' && (
          <>
            {' '}
            · nächster Zeitraum{' '}
            <span data-testid="contract-next-period">
              {formatDay(contract.nextPeriod.start)}–{formatDay(contract.nextPeriod.end)}
            </span>
          </>
        )}
      </p>
      {contract.tasks.length > 0 && (
        <ul className="contract-task-list">
          {contract.tasks.map((task) => (
            <li key={task.id}>
              <span className="list-item-name">{task.title}</span>{' '}
              <span className="list-item-meta">{taskSummary(task)}</span>
            </li>
          ))}
        </ul>
      )}
      {actions && (
        <div className="btn-row" style={{ marginTop: 10 }}>
          {actions}
        </div>
      )}
    </article>
  );
}
