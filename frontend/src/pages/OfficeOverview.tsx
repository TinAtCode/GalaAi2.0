import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { formatEuro } from '../format';

interface Numbers {
  inProgress?: number;
  open?: { count: number; sum: number; overdue: number };
  bank?: number;
}

// Kurzer Überblick für das Büro auf „Mein Tag“: laufende Projekte, offene
// Posten und noch nicht zugeordnete Zahlungseingänge (je nach Rechten)
export function OfficeOverview() {
  const { hasPermission } = useAuth();
  const canInvoice = hasPermission('invoice.create');
  const canRead = hasPermission('customer.read');
  const [numbers, setNumbers] = useState<Numbers>({});

  useEffect(() => {
    let current = true;
    const set = (patch: Numbers) => current && setNumbers((n) => ({ ...n, ...patch }));
    if (canRead)
      api
        .getPage('/projects?status=in_progress', 1, 0)
        .then((page) => set({ inProgress: page.total }))
        .catch(() => undefined);
    if (canInvoice) {
      api
        .get<{ open: string; daysOverdue: number }[]>('/open-items')
        .then((items) =>
          set({
            open: {
              count: items.length,
              sum: items.reduce((s, i) => s + Number(i.open), 0),
              overdue: items.filter((i) => i.daysOverdue > 0).reduce((s, i) => s + Number(i.open), 0),
            },
          }),
        )
        .catch(() => undefined);
      api
        .get<unknown[]>('/bank/transactions?status=open')
        .then((list) => set({ bank: list.length }))
        .catch(() => undefined);
    }
    return () => {
      current = false;
    };
  }, [canInvoice, canRead]);

  if (!canRead && !canInvoice) return null;
  return (
    <div className="stat-grid" data-testid="office-overview">
      {numbers.inProgress !== undefined && (
        <Link to="/projekte" className="stat">
          <div className="stat-label">Projekte in Arbeit</div>
          <div className="stat-value">{numbers.inProgress}</div>
        </Link>
      )}
      {numbers.open && (
        <Link to="/offene-posten" className="stat" data-testid="overview-open">
          <div className="stat-label">Offene Posten</div>
          <div className="stat-value">{formatEuro(numbers.open.sum)}</div>
          <div className="stat-meta">
            {numbers.open.count} Rechnung{numbers.open.count === 1 ? '' : 'en'}
            {numbers.open.overdue > 0 && (
              <span style={{ color: 'var(--color-danger)' }}>
                {' '}
                · {formatEuro(numbers.open.overdue)} überfällig
              </span>
            )}
          </div>
        </Link>
      )}
      {numbers.bank !== undefined && (
        <Link to="/bankabgleich" className="stat">
          <div className="stat-label">Zahlungseingänge zuordnen</div>
          <div className="stat-value">{numbers.bank}</div>
          <div className="stat-meta">aus dem Kontoauszug</div>
        </Link>
      )}
    </div>
  );
}
