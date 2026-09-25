import { FormEvent, useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { formatEuro } from '../format';
import { DocumentsSection } from './DocumentsSection';
import { PlansSection } from './plans/PlansSection';
import { InvoicesSection } from './InvoicesSection';
import { ContractsSection } from './contracts/ContractsSection';
import { SiteThread } from './site/SiteThread';
import { DiarySection } from './site/DiarySection';
import { ChecklistsSection } from './checklists/ChecklistsSection';
import { ProjectDeliverySection } from './delivery-notes/ProjectDeliverySection';
import { Contract } from './contracts/types';
import { QuoteForm } from './QuoteForm';
import { MaterialCard, PostCalculationCard } from './ProjectInsights';
import { quantityText, SOURCE_LABELS } from '../rounding';

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
  // Ordnungszahl aus einem GAEB-Leistungsverzeichnis
  gaebOz?: string | null;
  quantity: number;
  quantityExact?: number | string;
  roundingDecimals?: number | null;
  roundingMode?: 'half_up' | 'up' | 'down' | null;
  roundingSource?: string | null;
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
  gaeb?: { boqName: string | null } | null;
  lineItems: QuoteLineItem[];
}

interface ProjectInfo {
  id: string;
  title: string;
  number: string | null;
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
  totalNet?: number; // ohne Verkaufspreis-Recht nicht enthalten
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

// mögliche nächste Schritte je Auftragsstatus
const ORDER_ACTIONS: Record<Order['status'], [Order['status'], string][]> = {
  open: [
    ['in_progress', 'Beginnen'],
    ['cancelled', 'Stornieren'],
  ],
  in_progress: [
    ['done', 'Erledigt'],
    ['cancelled', 'Stornieren'],
  ],
  done: [],
  cancelled: [],
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
  const [gaebMessage, setGaebMessage] = useState<string | null>(null);
  // Sprung aus Suche oder „Zu erledigen“ (#angebote, #rechnungen …): erst
  // nach dem Laden scrollen, vorher gibt es den Abschnitt noch nicht
  const { hash } = useLocation();
  const scrolledTo = useRef<string | null>(null);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [contracts, setContracts] = useState<Contract[]>([]);
  // Rechnungen neu laden, wenn aus einem Vertrag abgerechnet wurde
  const [invoicesKey, setInvoicesKey] = useState(0);
  const [project, setProject] = useState<ProjectInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  // Nachkalkulation nach Änderungen (Material, Aufträge) neu laden
  const [insightsKey, setInsightsKey] = useState(0);
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
      api.get<Contract[]>(`/contracts?projectId=${projectId}`),
    ])
      .then(([a, q, o, p, c]) => {
        setAppointments(a);
        setQuotes(q);
        setOrders(o);
        setProject(p);
        setContracts(c);
        setInsightsKey((k) => k + 1);
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

  useEffect(() => {
    if (!hash || hash === scrolledTo.current || quotes === null) return;
    const target = document.getElementById(hash.slice(1));
    if (!target) return;
    target.scrollIntoView({ block: 'start' });
    scrolledTo.current = hash;
  }, [hash, quotes, orders]);

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

  const canWrite = hasPermission('customer.write');
  const showInvoices =
    !!projectId && (!!orders?.length || contracts.length > 0) && hasPermission('invoice.create');
  const sections: [string, string, boolean][] = [
    ['angebote', 'Angebote & Aufträge', true],
    ['vertraege', 'Pflegeverträge', true],
    ['rechnungen', 'Rechnungen', showInvoices],
    ['plaene', 'Lagepläne', hasPermission('plan.read')],
    ['dokumente', 'Dokumente', hasPermission('document.read')],
    ['lieferungen', 'Lieferungen', true],
    ['checklisten', 'Checklisten', hasPermission('site.use')],
    ['bautagebuch', 'Bautagebuch', hasPermission('site.use')],
    ['baustelle', 'Baustelle', hasPermission('site.use')],
    ['termine', 'Termine', true],
    ['nachkalkulation', 'Nachkalkulation', true],
    ['material', 'Material', true],
  ];

  return (
    <div>
      <header className="page-header">
        <div>
          <div className="list-item-meta" style={{ marginBottom: 4 }}>
            <Link to="/projekte">Projekte</Link>
            {project && (
              <>
                {' / '}
                <Link to={`/kunden/${project.property.customer.id}`}>{project.property.customer.name}</Link>
              </>
            )}
          </div>
          <h2 data-testid="project-heading">{project?.title ?? 'Projekt'}</h2>
          {project?.number && (
            <div className="list-item-meta" data-testid="project-number">
              Projektnummer <strong>{project.number}</strong>
            </div>
          )}
          {project && (
            <p className="list-item-meta">
              {project.property.label}
              {project.property.street ? `, ${project.property.street}` : ''}
              {project.property.city
                ? `, ${[project.property.postalCode, project.property.city].filter(Boolean).join(' ')}`
                : ''}
            </p>
          )}
        </div>
        {project &&
          (canWrite ? (
            <label className="field" style={{ minWidth: 180 }}>
              <span>Status</span>
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
          ) : (
            <span className={`status-badge status-${project.status}`}>
              {PROJECT_STATUS_LABELS[project.status]}
            </span>
          ))}
      </header>

      <nav className="section-nav no-print" aria-label="Abschnitte">
        {sections
          .filter(([, , visible]) => visible)
          .map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
      </nav>

      {error && <p className="field-error">{error}</p>}

      <div className="page-grid">
        <div>
          <section className="card" id="angebote">
            <h3 style={{ marginBottom: 12 }}>Angebote &amp; Aufträge</h3>
            {projectId && hasPermission('quote.create') && (
              <QuoteForm
                projectId={projectId}
                onCreated={load}
                showCost={hasPermission('price.purchase.read')}
              />
            )}
            {projectId && hasPermission('quote.create') && (
              <GaebImport
                projectId={projectId}
                onImported={(text) => {
                  setGaebMessage(text);
                  load();
                }}
                onError={setError}
              />
            )}
            {gaebMessage && (
              <p className="notice" data-testid="gaeb-message">
                {gaebMessage}
              </p>
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
                  <span className={`status-badge status-${quote.status}`} data-testid="quote-status">
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
                        <td data-testid="quote-line">
                          {li.gaebOz && (
                            <span className="list-item-meta" data-testid="quote-line-oz">
                              {li.gaebOz}{' '}
                            </span>
                          )}
                          {li.description} ({quantityText(li.quantity)} {li.unit})
                          {li.quantityExact != null && Number(li.quantityExact) !== Number(li.quantity) && (
                            <span
                              className="list-item-meta"
                              title={`Gerundet ${SOURCE_LABELS[li.roundingSource ?? ''] ?? ''}`}
                              data-testid="quote-line-exact"
                            >
                              {' '}
                              · genau {quantityText(li.quantityExact)} {li.unit}
                            </span>
                          )}
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
                  {hasPermission('price.sale.read') && (
                    <button
                      className="btn"
                      onClick={() =>
                        runAction(() =>
                          api.downloadFile(
                            `/quotes/${quote.id}/gaeb`,
                            `Angebot_${(quote.number ?? 'Entwurf').replace(/[^A-Za-z0-9-]/g, '')}.X84`,
                          ),
                        )
                      }
                      title="Angebotsabgabe im GAEB-Format (X84) für AVA-Programme der Auftraggeber"
                      data-testid="quote-gaeb"
                    >
                      GAEB X84
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
                  {quote.status === 'draft' &&
                    editingQuoteId !== quote.id &&
                    hasPermission('quote.approve') && (
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
                  {quote.status === 'approved' && hasPermission('quote.create') && (
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
                  {quote.status === 'sent' && hasPermission('quote.create') && (
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
                  {quote.status === 'accepted' &&
                    !hasOrderForQuote(quote.id) &&
                    hasPermission('order.create') && (
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
                <h3 style={{ marginTop: 20, marginBottom: 4 }}>Aufträge</h3>
                {orders.map((order) => (
                  <div key={order.id} className="list-item" data-testid="order-item">
                    <div>
                      <div className="list-item-name">
                        Auftrag vom {new Date(order.createdAt).toLocaleDateString('de-DE')}
                      </div>
                      {order.totalNet !== undefined && (
                        <div className="list-item-meta">{formatEuro(order.totalNet)} netto</div>
                      )}
                    </div>
                    <div className="btn-row">
                      {hasPermission('order.create') &&
                        ORDER_ACTIONS[order.status].map(([to, label]) => (
                          <button
                            key={to}
                            className={`btn btn-sm${to === 'cancelled' ? ' btn-danger' : ''}`}
                            disabled={busyId !== null}
                            onClick={() => {
                              if (to === 'cancelled' && !window.confirm('Auftrag wirklich stornieren?'))
                                return;
                              runAction(() => api.patch(`/orders/${order.id}/status`, { status: to }));
                            }}
                            data-testid={`order-${to}`}
                          >
                            {label}
                          </button>
                        ))}
                      <span className={`status-badge status-${order.status}`} data-testid="order-status">
                        {ORDER_STATUS_LABELS[order.status]}
                      </span>
                    </div>
                  </div>
                ))}
              </>
            )}
          </section>

          {projectId && (
            <section className="card" id="vertraege">
              <ContractsSection
                projectId={projectId}
                contracts={contracts}
                onChange={() => {
                  load();
                  setInvoicesKey((k) => k + 1);
                }}
              />
            </section>
          )}

          {showInvoices && orders && (
            <section className="card" id="rechnungen">
              <InvoicesSection key={invoicesKey} projectId={projectId!} orderIds={orders.map((o) => o.id)} />
            </section>
          )}

          {projectId && hasPermission('plan.read') && (
            <section className="card" id="plaene">
              <PlansSection projectId={projectId} canEdit={hasPermission('plan.write')} />
            </section>
          )}

          {projectId && hasPermission('document.read') && (
            <section className="card" id="dokumente">
              <DocumentsSection projectId={projectId} canDelete={hasPermission('document.delete')} />
            </section>
          )}

          {projectId && (
            <section className="card" id="lieferungen">
              <ProjectDeliverySection projectId={projectId} showNotes={hasPermission('document.read')} />
            </section>
          )}

          {projectId && hasPermission('site.use') && (
            <section className="card" id="checklisten">
              <ChecklistsSection projectId={projectId} />
            </section>
          )}

          {projectId && hasPermission('site.use') && (
            <section className="card" id="bautagebuch">
              <DiarySection projectId={projectId} />
            </section>
          )}
        </div>

        <aside>
          {projectId && hasPermission('site.use') && (
            <section className="card" id="baustelle">
              <h3 style={{ marginBottom: 8 }}>Baustelle: Fotos &amp; Nachrichten</h3>
              <SiteThread projectId={projectId} compact />
            </section>
          )}
          <section className="card" id="termine">
            <h3 style={{ marginBottom: 8 }}>Termine</h3>
            {appointments?.length === 0 && <p className="list-item-meta">Noch keine Termine.</p>}
            {appointments?.map((a) => (
              <div
                key={a.id}
                className="list-item"
                style={{ padding: '10px 0' }}
                data-testid="appointment-item"
              >
                <div>
                  <div className="list-item-name">{a.title}</div>
                  <div className="list-item-meta">
                    {new Date(a.startTime).toLocaleString('de-DE', {
                      dateStyle: 'medium',
                      timeStyle: 'short',
                    })}
                  </div>
                </div>
                {a.status === 'planned' && canWrite ? (
                  <div className="btn-row">
                    <button
                      className="btn btn-sm"
                      disabled={busyId !== null}
                      onClick={() =>
                        runAction(() => api.patch(`/appointments/${a.id}/status`, { status: 'done' }))
                      }
                      title="Als erledigt markieren"
                      data-testid="appointment-done"
                    >
                      Erledigt
                    </button>
                    <button
                      className="btn btn-sm btn-ghost"
                      disabled={busyId !== null}
                      onClick={() =>
                        runAction(() => api.patch(`/appointments/${a.id}/status`, { status: 'cancelled' }))
                      }
                      title="Termin absagen"
                      data-testid="appointment-cancel"
                    >
                      Absagen
                    </button>
                  </div>
                ) : (
                  <span className={`status-badge status-${a.status}`}>
                    {a.status === 'planned' ? 'Geplant' : a.status === 'done' ? 'Erledigt' : 'Abgesagt'}
                  </span>
                )}
              </div>
            ))}
            {canWrite && (
              <form onSubmit={createAppointment} style={{ display: 'grid', gap: 8, marginTop: 12 }}>
                <input
                  placeholder="Titel (z.B. Aufmaß nehmen)"
                  value={newAppointment.title}
                  onChange={(e) => setNewAppointment({ ...newAppointment, title: e.target.value })}
                  required
                  data-testid="appointment-title"
                />
                <div className="form-row">
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
                </div>
                <div className="form-row" style={{ justifyContent: 'space-between' }}>
                  <label className="checkbox-row">
                    <input
                      type="checkbox"
                      checked={newAppointment.assignToSelf}
                      onChange={(e) =>
                        setNewAppointment({ ...newAppointment, assignToSelf: e.target.checked })
                      }
                    />
                    mir zuweisen
                  </label>
                  <button type="submit" className="btn btn-primary" data-testid="appointment-submit">
                    Termin anlegen
                  </button>
                </div>
              </form>
            )}
          </section>

          {projectId && <PostCalculationCard projectId={projectId} reloadKey={insightsKey} />}
          {projectId && (
            <MaterialCard
              projectId={projectId}
              canWrite={canWrite}
              onChange={() => setInsightsKey((k) => k + 1)}
            />
          )}
        </aside>
      </div>
    </div>
  );
}

// GAEB-Leistungsverzeichnis (X83, auch X81/X82/X86) einlesen: daraus wird
// ein Angebotsentwurf mit den Ordnungszahlen und Mengen des LV
function GaebImport({
  projectId,
  onImported,
  onError,
}: {
  projectId: string;
  onImported: (text: string) => void;
  onError: (text: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const upload = async (file: File | undefined) => {
    if (!file) return;
    setBusy(true);
    try {
      const r = await api.upload<{
        number: string | null;
        imported: number;
        matched: number;
        skipped: { oz: string; reason: string }[];
      }>(`/quotes/gaeb-import/${projectId}`, file);
      const skipped = r.skipped.length
        ? ` Nicht übernommen: ${r.skipped.map((s) => `${s.oz} (${s.reason})`).join(', ')}.`
        : '';
      onImported(
        `Leistungsverzeichnis eingelesen: Angebot ${r.number ?? ''} mit ${r.imported} Positionen, davon ${r.matched} mit Preis aus dem Katalog. Die übrigen Preise im Entwurf eintragen („Bearbeiten“).${skipped}`,
      );
    } catch (err) {
      onError(err instanceof ApiError ? err.message : 'GAEB-Datei konnte nicht eingelesen werden.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <label className="btn" style={{ marginBottom: 12 }}>
      {busy ? 'Liest ein …' : 'GAEB-Leistungsverzeichnis einlesen'}
      <input
        type="file"
        accept=".x83,.x81,.x82,.x86,.xml,.X83,.X81,.X82,.X86"
        hidden
        onChange={(e) => {
          void upload(e.target.files?.[0]);
          e.target.value = '';
        }}
        data-testid="gaeb-upload"
      />
    </label>
  );
}
