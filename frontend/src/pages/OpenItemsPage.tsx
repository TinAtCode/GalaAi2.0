import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { formatEuro } from '../format';

interface OpenItem {
  invoiceId: string;
  number: string;
  kind: 'partial' | 'final';
  dueDate: string; // JJJJ-MM-TT
  daysOverdue: number;
  totalGross: string;
  paid: string;
  open: string;
  project: { id: string; title: string };
  customer: { id: string; name: string };
}

const KIND_LABELS: Record<OpenItem['kind'], string> = {
  partial: 'Abschlag',
  final: 'Rechnung',
};

const day = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString('de-DE');

// Offene Posten: ausgestellte Rechnungen, die noch nicht (vollständig)
// bezahlt sind – älteste Fälligkeit zuerst, Überfälliges hervorgehoben.
export function OpenItemsPage() {
  const [items, setItems] = useState<OpenItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<OpenItem[]>('/open-items')
      .then(setItems)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Offene Posten konnten nicht geladen werden.'),
      );
  }, []);

  const sum = (list: OpenItem[]) => list.reduce((total, item) => total + Number(item.open), 0);
  const overdue = items?.filter((i) => i.daysOverdue > 0) ?? [];

  return (
    <div>
      <header className="my-day-header">
        <h2>Offene Posten</h2>
      </header>
      {error && <p className="field-error">{error}</p>}
      {items === null && !error && <p>Lädt …</p>}
      {items && (
        <p className="list-item-meta" data-testid="open-items-summary">
          {items.length} offene Rechnung{items.length === 1 ? '' : 'en'} · {formatEuro(sum(items))} offen
          {overdue.length > 0 && ` · davon ${formatEuro(sum(overdue))} überfällig`}
        </p>
      )}
      {items?.length === 0 && (
        <div className="empty-state">
          <strong>Alles bezahlt.</strong>
          Zahlungseingänge werden an der Rechnung im Projekt erfasst.
        </div>
      )}
      {items?.map((item) => (
        <div
          key={item.invoiceId}
          className="list-item"
          data-testid="open-item"
          data-invoice-id={item.invoiceId}
        >
          <div>
            <div className="list-item-name">
              {KIND_LABELS[item.kind]} {item.number} · {item.customer.name}
            </div>
            <div className="list-item-meta">
              <Link to={`/projekte/${item.project.id}`}>{item.project.title}</Link> · fällig am{' '}
              {day(item.dueDate)}
              {Number(item.paid) > 0 &&
                ` · bezahlt ${formatEuro(item.paid)} von ${formatEuro(item.totalGross)}`}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <strong data-testid="open-item-amount">{formatEuro(item.open)}</strong>
            {item.daysOverdue > 0 && (
              <span className="status-badge status-cancelled" data-testid="open-item-overdue">
                {item.daysOverdue} Tag{item.daysOverdue === 1 ? '' : 'e'} überfällig
              </span>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
