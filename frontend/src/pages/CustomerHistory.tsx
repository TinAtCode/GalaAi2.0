import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { formatDay, formatEuro } from '../format';

type ProjectRef = { id: string; number: string | null; title: string };

interface History {
  quotes: {
    id: string;
    number: string | null;
    status: 'draft' | 'approved' | 'sent' | 'accepted' | 'rejected' | 'expired';
    date: string;
    totalNet: string | null; // ohne Verkaufspreis-Recht null
    project: ProjectRef;
  }[];
  // ohne Rechnungsrecht null
  invoices:
    | {
        id: string;
        number: string | null;
        kind: 'partial' | 'final' | 'cancellation' | 'periodic';
        status: 'issued' | 'cancelled';
        date: string | null;
        totalNet: string;
        project: ProjectRef;
      }[]
    | null;
  revenueByYear: { year: number; net: number }[] | null;
}

const QUOTE_STATUS: Record<History['quotes'][number]['status'], string> = {
  draft: 'Entwurf',
  approved: 'Freigegeben',
  sent: 'Versendet',
  accepted: 'Angenommen',
  rejected: 'Abgelehnt',
  expired: 'Abgelaufen',
};
const INVOICE_KIND: Record<NonNullable<History['invoices']>[number]['kind'], string> = {
  partial: 'Abschlag',
  final: 'Schlussrechnung',
  cancellation: 'Storno',
  periodic: 'Pflegevertrag',
};

// Wie lief es bisher mit dem Kunden? Angebote (mit Annahmequote),
// Rechnungen und Umsatz je Jahr – vor dem nächsten Angebot auf einen Blick
export function CustomerHistory({ customerId }: { customerId: string }) {
  const [history, setHistory] = useState<History | null>(null);
  const [showAll, setShowAll] = useState(false);

  useEffect(() => {
    let current = true;
    api
      .get<History>(`/customers/${customerId}/history`)
      .then((h) => current && setHistory(h))
      .catch(() => current && setHistory(null));
    return () => {
      current = false;
    };
  }, [customerId]);

  if (!history || (history.quotes.length === 0 && !history.invoices?.length)) return null;
  const decided = history.quotes.filter((q) => q.status === 'accepted' || q.status === 'rejected');
  const accepted = decided.filter((q) => q.status === 'accepted').length;
  const limit = showAll ? Infinity : 5;

  return (
    <section className="settings-section" data-testid="customer-history">
      <h3>Verlauf</h3>
      {history.revenueByYear && history.revenueByYear.length > 0 && (
        <p className="list-item-meta" data-testid="customer-revenue">
          Umsatz (netto):{' '}
          {history.revenueByYear.map((r, index) => (
            <span key={r.year}>
              {index > 0 && ' · '}
              {r.year}: <strong>{formatEuro(r.net)}</strong>
            </span>
          ))}
        </p>
      )}
      {decided.length > 0 && (
        <p className="list-item-meta" data-testid="customer-acceptance">
          {accepted} von {decided.length} entschiedenen Angeboten angenommen
        </p>
      )}

      {history.quotes.length > 0 && (
        <>
          <div className="list-item-name" style={{ marginTop: 8 }}>
            Angebote
          </div>
          {history.quotes.slice(0, limit).map((q) => (
            <Link
              key={q.id}
              to={`/projekte/${q.project.id}#angebote`}
              className="list-item list-item-link"
              data-testid="customer-quote"
            >
              <div>
                <div className="list-item-name">
                  {q.number ?? 'Entwurf'} · {q.project.title}
                </div>
                <div className="list-item-meta">
                  {formatDay(q.date)} · {QUOTE_STATUS[q.status]}
                </div>
              </div>
              {q.totalNet !== null && <span style={{ whiteSpace: 'nowrap' }}>{formatEuro(q.totalNet)}</span>}
            </Link>
          ))}
        </>
      )}

      {history.invoices && history.invoices.length > 0 && (
        <>
          <div className="list-item-name" style={{ marginTop: 8 }}>
            Rechnungen
          </div>
          {history.invoices.slice(0, limit).map((i) => (
            <Link
              key={i.id}
              to={`/projekte/${i.project.id}#rechnungen`}
              className="list-item list-item-link"
              data-testid="customer-invoice"
            >
              <div>
                <div className="list-item-name">
                  {i.number ?? 'Rechnung'} · {i.project.title}
                </div>
                <div className="list-item-meta">
                  {i.date ? `${formatDay(i.date)} · ` : ''}
                  {INVOICE_KIND[i.kind]}
                  {i.status === 'cancelled' && ' · storniert'}
                </div>
              </div>
              <span style={{ whiteSpace: 'nowrap' }}>{formatEuro(i.totalNet)}</span>
            </Link>
          ))}
        </>
      )}

      {!showAll && (history.quotes.length > 5 || (history.invoices?.length ?? 0) > 5) && (
        <button
          className="btn btn-sm btn-ghost"
          onClick={() => setShowAll(true)}
          data-testid="customer-history-all"
        >
          Alle anzeigen
        </button>
      )}
    </section>
  );
}
