import { FormEvent, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { formatEuro } from '../format';
import { DocumentsSection } from './DocumentsSection';
import { InvoicesSection } from './InvoicesSection';
import { QuoteForm } from './QuoteForm';

interface Appointment {
  id: string;
  title: string;
  startTime: string;
  status: 'planned' | 'done' | 'cancelled';
}

interface QuoteLineItem {
  id: string;
  serviceId?: string | null;
  description: string;
  unit: string;
  quantity: number;
  unitPrice?: number;
  costPerUnit?: number;
  lineTotal?: number;
}

interface Quote {
  id: string;
  number: string | null;
  status: 'draft' | 'approved' | 'sent' | 'accepted' | 'rejected' | 'expired';
  vatRate: number;
  vatTreatment: 'standard' | 'small_business' | 'reverse_charge';
  totalNet?: number;
  totalGross?: number;
  createdAt: string;
  lineItems: QuoteLineItem[];
}

interface ProjectInfo {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  property: {
    label: string;
    street: string | null;
    postalCode: string | null;
    city: string | null;
    customer: { id: string; name: string };
  };
}

interface Order {
  id: string;
  quoteId: string;
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
  totalNet: number;
  createdAt: string;
}

const PROJECT_STATUS_LABELS: Record<ProjectInfo['status'], string> = {
  open: 'Offen',
  in_progress: 'In Arbeit',
  done: 'Fertig',
  cancelled: 'Storniert',
};

const ORDER_STATUS_LABELS: Record<Order['status'], string> = {
  open: 'Offen',
  in_progress: 'In Arbeit',
  done: 'Erledigt',
  cancelled: 'Storniert',
};

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
  // Angebot, dessen Entwurf gerade bearbeitet wird
  const [editingQuoteId, setEditingQuoteId] = useState<string | null>(null);
  const { user, hasPermission } = useAuth();
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [quotes, setQuotes] = useState<Quote[] | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [project, setProject] = useState<ProjectInfo | null>(null);
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
      api.get<ProjectInfo>(`/projects/${projectId}`),
    ])
      .then(([a, q, o, p]) => {
        setAppointments(a);
        setQuotes(q);
        setOrders(o);
        setProject(p);
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
        <h2 data-testid="project-heading">{project?.title ?? 'Projekt'}</h2>
        {project && (
          <p className="list-item-meta">
            <Link to={`/kunden/${project.property.customer.id}`}>{project.property.customer.name}</Link>
            {' · '}
            {project.property.label}
            {project.property.street ? `, ${project.property.street}` : ''}
            {project.property.city
              ? `, ${[project.property.postalCode, project.property.city].filter(Boolean).join(' ')}`
              : ''}
          </p>
        )}
        {project && hasPermission('customer.write') && (
          <label className="list-item-meta" style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            Status
            <select
              value={project.status}
              onChange={(e) =>
                runAction(() => api.patch(`/projects/${project.id}/status`, { status: e.target.value }))
              }
              data-testid="project-status-select"
            >
              {Object.entries(PROJECT_STATUS_LABELS).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        )}
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
      {projectId && hasPermission('quote.create') && (
        <QuoteForm projectId={projectId} onCreated={load} showCost={hasPermission('price.purchase.read')} />
      )}
      {!error && quotes === null && <p>Lädt …</p>}

      {quotes?.length === 0 && (
        <div className="empty-state">
          <strong>Noch keine Angebote für dieses Projekt.</strong>
          Ein Angebot entsteht aus Leistungen mit Rezeptur; die Preise kommen aus der Kalkulation.
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
                · {formatEuro(quote.totalGross)} brutto (
                {quote.vatTreatment === 'small_business'
                  ? 'ohne USt, § 19 UStG'
                  : quote.vatTreatment === 'reverse_charge'
                    ? 'ohne USt, § 13b UStG'
                    : `${Number(quote.vatRate)} % USt`}
                )
              </>
            )}
          </div>

          {editingQuoteId === quote.id && quote.status === 'draft' && projectId && (
            <QuoteForm
              projectId={projectId}
              quote={quote}
              showCost={hasPermission('price.purchase.read')}
              onCreated={() => {
                setEditingQuoteId(null);
                load();
              }}
              onCancel={() => setEditingQuoteId(null)}
            />
          )}
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
            {hasPermission('price.sale.read') && (
              <button
                className="btn"
                onClick={() => runAction(() => api.openFile(`/quotes/${quote.id}/pdf`))}
                data-testid="quote-pdf"
              >
                PDF
              </button>
            )}
            {quote.status === 'draft' &&
              editingQuoteId !== quote.id &&
              hasPermission('quote.create') &&
              hasPermission('price.sale.read') &&
              hasPermission('price.purchase.read') && (
                <button
                  className="btn"
                  disabled={busyId !== null}
                  onClick={() => setEditingQuoteId(quote.id)}
                  data-testid="quote-edit"
                >
                  Bearbeiten
                </button>
              )}
            {quote.status === 'draft' && editingQuoteId !== quote.id && (
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
              <span className={`status-badge status-${order.status}`}>
                {ORDER_STATUS_LABELS[order.status]}
              </span>
            </div>
          ))}
        </>
      )}

      {projectId && orders && orders.length > 0 && hasPermission('invoice.create') && (
        <InvoicesSection projectId={projectId} orderIds={orders.map((o) => o.id)} />
      )}

      {projectId && hasPermission('document.read') && (
        <DocumentsSection projectId={projectId} canDelete={hasPermission('document.delete')} />
      )}
    </div>
  );
}
