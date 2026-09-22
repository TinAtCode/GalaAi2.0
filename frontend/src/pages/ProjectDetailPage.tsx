import { FormEvent, useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { formatEuro } from '../format';

interface Appointment {
  id: string;
  title: string;
  startTime: string;
  status: 'planned' | 'done' | 'cancelled';
}

interface QuoteLineItem {
  id: string;
  description: string;
  unit: string;
  quantity: number;
  unitPrice?: number;
  lineTotal?: number;
}

interface Quote {
  id: string;
  number: string | null;
  status: 'draft' | 'approved' | 'sent' | 'accepted' | 'rejected' | 'expired';
  vatRate: number;
  totalNet?: number;
  totalGross?: number;
  createdAt: string;
  lineItems: QuoteLineItem[];
}

interface Order {
  id: string;
  quoteId: string;
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  totalNet: number;
  createdAt: string;
}

const QUOTE_STATUS_LABELS: Record<Quote['status'], string> = {
  draft: 'Entwurf',
  approved: 'Freigegeben',
  sent: 'Versendet',
  accepted: 'Angenommen',
  rejected: 'Abgelehnt',
  expired: 'Abgelaufen',
};

export function ProjectDetailPage() {
  const { projectId } = useParams<{ projectId: string }>();
  const { user } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [newAppointment, setNewAppointment] = useState({
    title: '',
    date: '',
    time: '08:00',
    assignToSelf: true,
  });

  const load = () => {
    if (!projectId) return;
    Promise.all([
      api.get<Appointment[]>(`/appointments/by-project/${projectId}`),
      api.get<Quote[]>(`/quotes/by-project/${projectId}`),
      api.get<Order[]>(`/orders/by-project/${projectId}`),
    ])
      .then(([a, q, o]) => {
        setAppointments(a);
        setQuotes(q);
        setOrders(o);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Daten konnten nicht geladen werden.'),
      );
  };

  useEffect(load, [projectId]);

  const createAppointment = async (e: FormEvent) => {
    e.preventDefault();
    if (!projectId || !newAppointment.date) return;
    setError(null);
    try {
      await api.post('/appointments', {
        projectId,
        title: newAppointment.title,
        startTime: new Date(`${newAppointment.date}T${newAppointment.time}:00`).toISOString(),
        assignedUserId: newAppointment.assignToSelf ? user?.id : undefined,
      });
      setNewAppointment({ title: '', date: '', time: '08:00', assignToSelf: true });
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Termin konnte nicht angelegt werden.');
    }
  };

  const hasOrderForQuote = (quoteId: string) => orders?.some((o) => o.quoteId === quoteId) ?? false;

  const runAction = async (action: () => Promise<unknown>) => {
    setError(null);
    setBusyId(action.name);
    try {
      await action();
      load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen.');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div>
      <header className="my-day-header">
        <h2>Projekt</h2>
      </header>

      {error && <p className="field-error">{error}</p>}

      <h3 style={{ marginBottom: 8 }}>Termine</h3>
      {appointments?.length === 0 && <p className="list-item-meta">Noch keine Termine.</p>}
      {appointments?.map((a) => (
        <div key={a.id} className="list-item" data-testid="appointment-item">
          <div>
            <div className="list-item-name">{a.title}</div>
            <div className="list-item-meta">
              {new Date(a.startTime).toLocaleString('de-DE', { dateStyle: 'medium', timeStyle: 'short' })}
            </div>
          </div>
          <span
            className={`status-badge status-${a.status === 'done' ? 'done' : a.status === 'cancelled' ? 'cancelled' : 'open'}`}
          >
            {a.status === 'planned' ? 'Geplant' : a.status === 'done' ? 'Erledigt' : 'Storniert'}
          </span>
        </div>
      ))}

      <form onSubmit={createAppointment} className="form-row" style={{ marginTop: 12, marginBottom: 28 }}>
        <input
          placeholder="Titel (z.B. Aufmaß nehmen)"
          value={newAppointment.title}
          onChange={(e) => setNewAppointment({ ...newAppointment, title: e.target.value })}
          required
          data-testid="appointment-title"
        />
        <input
          type="date"
          value={newAppointment.date}
          onChange={(e) => setNewAppointment({ ...newAppointment, date: e.target.value })}
          required
          data-testid="appointment-date"
        />
        <input
          type="time"
          value={newAppointment.time}
          onChange={(e) => setNewAppointment({ ...newAppointment, time: e.target.value })}
          required
          data-testid="appointment-time"
        />
        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem' }}>
          <input
            type="checkbox"
            checked={newAppointment.assignToSelf}
            onChange={(e) => setNewAppointment({ ...newAppointment, assignToSelf: e.target.checked })}
          />
          mir zuweisen
        </label>
        <button type="submit" className="btn btn-primary" data-testid="appointment-submit">
          Termin anlegen
        </button>
      </form>

      <h3 style={{ marginBottom: 8 }}>Angebote &amp; Aufträge</h3>
      {!error && quotes === null && <p>Lädt …</p>}

      {quotes?.length === 0 && (
        <div className="empty-state">
          <strong>Noch keine Angebote für dieses Projekt.</strong>
          Angebote werden aus einer Kalkulation heraus erstellt.
        </div>
      )}

      {quotes?.map((quote) => (
        <article key={quote.id} className="job-card" data-testid="quote-card" data-quote-id={quote.id}>
          <div className="job-card-task">
            Angebot <span data-testid="quote-number">{quote.number ?? ''}</span> vom{' '}
            {new Date(quote.createdAt).toLocaleDateString('de-DE')}
          </div>
          <div className="job-card-meta" style={{ marginBottom: 10 }}>
            <span
              className={`status-badge status-${quote.status === 'accepted' ? 'done' : quote.status === 'rejected' ? 'cancelled' : 'open'}`}
              data-testid="quote-status"
            >
              {QUOTE_STATUS_LABELS[quote.status]}
            </span>{' '}
            · {formatEuro(quote.totalNet)} netto
            {quote.totalGross !== undefined && (
              <>
                {' '}
                · {formatEuro(quote.totalGross)} brutto ({Number(quote.vatRate)} % USt)
              </>
            )}
          </div>

          <table className="calc-table">
            <tbody>
              {quote.lineItems.map((li) => (
                <tr key={li.id}>
                  <td>
                    {li.description} ({li.quantity} {li.unit})
                  </td>
                  <td>{formatEuro(li.lineTotal)}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
            {quote.status === 'draft' && (
              <button
                className="btn btn-primary"
                disabled={busyId !== null}
                onClick={() =>
                  runAction(function approve() {
                    return api.post(`/quotes/${quote.id}/approve`);
                  })
                }
                data-testid="quote-approve"
              >
                Freigeben
              </button>
            )}
            {quote.status === 'approved' && (
              <button
                className="btn btn-primary"
                disabled={busyId !== null}
                onClick={() =>
                  runAction(function send() {
                    return api.post(`/quotes/${quote.id}/send`);
                  })
                }
                data-testid="quote-send"
              >
                Versenden
              </button>
            )}
            {quote.status === 'sent' && (
              <>
                <button
                  className="btn btn-primary"
                  disabled={busyId !== null}
                  onClick={() =>
                    runAction(function accept() {
                      return api.post(`/quotes/${quote.id}/outcome`, { status: 'accepted' });
                    })
                  }
                  data-testid="quote-accept"
                >
                  Kunde hat angenommen
                </button>
                <button
                  className="btn"
                  style={{ background: 'transparent', border: '1px solid var(--color-border)' }}
                  disabled={busyId !== null}
                  onClick={() =>
                    runAction(function reject() {
                      return api.post(`/quotes/${quote.id}/outcome`, { status: 'rejected' });
                    })
                  }
                  data-testid="quote-reject"
                >
                  Kunde hat abgelehnt
                </button>
              </>
            )}
            {quote.status === 'accepted' && !hasOrderForQuote(quote.id) && (
              <button
                className="btn btn-primary"
                disabled={busyId !== null}
                onClick={() =>
                  runAction(function createOrder() {
                    return api.post('/orders', { quoteId: quote.id });
                  })
                }
                data-testid="quote-create-order"
              >
                Auftrag erzeugen
              </button>
            )}
          </div>
        </article>
      ))}

      {orders && orders.length > 0 && (
        <>
          <h3 style={{ marginTop: 28, marginBottom: 8 }}>Aufträge</h3>
          {orders.map((order) => (
            <div key={order.id} className="list-item">
              <div>
                <div className="list-item-name">
                  Auftrag vom {new Date(order.createdAt).toLocaleDateString('de-DE')}
                </div>
                <div className="list-item-meta">{formatEuro(order.totalNet)}</div>
              </div>
              <span className={`status-badge status-${order.status}`}>{order.status}</span>
            </div>
          ))}
        </>
      )}
    </div>
  );
}
