import { FormEvent, useCallback, useEffect, useState, useRef } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';

interface Project {
  id: string;
  title: string;
  status: 'open' | 'in_progress' | 'done' | 'cancelled';
}

interface Property {
  id: string;
  label: string;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  projects: Project[];
}

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  street: string | null;
  postalCode: string | null;
  city: string | null;
  buyerReference: string | null;
  vatId: string | null;
  debtorNumber: number | null;
  isBusiness: boolean;
  properties: Property[];
}

const CUSTOMER_FIELDS: { key: keyof Customer; label: string; type?: string }[] = [
  { key: 'name', label: 'Name' },
  { key: 'email', label: 'E-Mail', type: 'email' },
  { key: 'phone', label: 'Telefon', type: 'tel' },
  { key: 'street', label: 'Straße (Rechnungsanschrift)' },
  { key: 'postalCode', label: 'PLZ' },
  { key: 'city', label: 'Ort' },
  // Für E-Rechnungen an Behörden Pflicht; sonst optional
  { key: 'buyerReference', label: 'Leitweg-ID / Käuferreferenz' },
  // Für E-Rechnungen nach § 13b UStG (Kunde schuldet die Umsatzsteuer)
  { key: 'vatId', label: 'USt-IdNr.' },
  // Debitorenkonto für den DATEV-Export (wird automatisch vergeben)
  { key: 'debtorNumber', label: 'Debitorennummer (DATEV)' },
];

const STATUS_LABELS: Record<Project['status'], string> = {
  open: 'Offen',
  in_progress: 'In Arbeit',
  done: 'Fertig',
  cancelled: 'Storniert',
};

// Nur gefüllte Felder schicken – leere Eingaben löschen keine Werte.
const filled = (values: Record<string, string>) =>
  Object.fromEntries(
    Object.entries(values)
      .filter(([, v]) => v.trim() !== '')
      .map(([k, v]) => [k, v.trim()]),
  );

export function CustomerDetailPage() {
  const { customerId } = useParams();
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const canWrite = hasPermission('customer.write');
  const [customer, setCustomer] = useState<Customer | null>(null);
  const [form, setForm] = useState<Record<string, string>>({});
  const [newProperty, setNewProperty] = useState({ label: '', street: '', postalCode: '', city: '' });
  const [newProjectTitle, setNewProjectTitle] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [isBusiness, setIsBusiness] = useState(false);
  // Hat jemand schon getippt, überschreibt eine (spät eintreffende) Ladeantwort
  // die Eingaben nicht mehr – erst nach dem Speichern gilt wieder der Serverstand.
  const edited = useRef(false);

  const load = useCallback(
    () =>
      api
        .get<Customer>(`/customers/${customerId}`)
        .then((c) => {
          setCustomer(c);
          if (!edited.current) {
            setForm(Object.fromEntries(CUSTOMER_FIELDS.map((f) => [f.key, String(c[f.key] ?? '')])));
            setIsBusiness(c.isBusiness);
          }
        })
        .catch((err) =>
          setError(err instanceof ApiError ? err.message : 'Kunde konnte nicht geladen werden.'),
        ),
    [customerId],
  );

  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    setSaved(false);
    try {
      await action();
      await load();
      return true;
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.');
      return false;
    }
  };

  const saveCustomer = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await run(async () => {
      const { debtorNumber, ...rest } = filled(form);
      await api.patch(`/customers/${customerId}`, {
        ...rest,
        ...(debtorNumber ? { debtorNumber: Number(debtorNumber) } : {}),
        isBusiness,
      });
      edited.current = false;
    });
    if (ok) setSaved(true);
  };

  const addProperty = async (event: FormEvent) => {
    event.preventDefault();
    const ok = await run(() => api.post('/properties', { customerId, ...filled(newProperty) }));
    if (ok) setNewProperty({ label: '', street: '', postalCode: '', city: '' });
  };

  const addProject = async (event: FormEvent, propertyId: string) => {
    event.preventDefault();
    setError(null);
    try {
      const project = await api.post<{ id: string }>('/projects', {
        propertyId,
        title: newProjectTitle[propertyId],
      });
      navigate(`/projekte/${project.id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Projekt konnte nicht angelegt werden.');
    }
  };

  if (!customer) {
    return <div>{error ? <p className="field-error">{error}</p> : <p>Lädt …</p>}</div>;
  }

  return (
    <div>
      <header className="my-day-header">
        <h2 data-testid="customer-heading">{customer.name}</h2>
      </header>
      {error && <p className="field-error">{error}</p>}

      <section className="settings-section">
        <h3>Kundendaten</h3>
        <form onSubmit={saveCustomer} className="login-form">
          {CUSTOMER_FIELDS.map((field) => (
            <label key={field.key} className="field">
              <span>{field.label}</span>
              <input
                type={field.type ?? 'text'}
                value={form[field.key] ?? ''}
                onChange={(e) => {
                  edited.current = true;
                  setForm({ ...form, [field.key]: e.target.value });
                }}
                disabled={!canWrite}
                data-testid={`customer-${field.key}`}
              />
            </label>
          ))}
          <label className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <input
              type="checkbox"
              checked={isBusiness}
              onChange={(e) => {
                edited.current = true;
                setIsBusiness(e.target.checked);
              }}
              disabled={!canWrite}
              data-testid="customer-isBusiness"
            />
            <span>Geschäftskunde (Unternehmer) – für Verzugszinsen und -pauschale bei Mahnungen</span>
          </label>
          {saved && (
            <p className="list-item-meta" data-testid="customer-saved">
              Gespeichert.
            </p>
          )}
          {canWrite && (
            <button type="submit" className="btn btn-primary" data-testid="customer-save">
              Speichern
            </button>
          )}
        </form>
      </section>

      <h3 style={{ marginTop: 28, marginBottom: 8 }}>Objekte und Projekte</h3>
      {customer.properties.length === 0 && <p className="list-item-meta">Noch keine Objekte.</p>}
      {customer.properties.map((property) => (
        <article key={property.id} className="job-card" data-testid="property-card">
          <div className="job-card-task">{property.label}</div>
          <div className="job-card-meta">
            {[property.street, [property.postalCode, property.city].filter(Boolean).join(' ')]
              .filter(Boolean)
              .join(', ') || 'ohne Anschrift'}
          </div>
          {property.projects.map((project) => (
            <Link key={project.id} to={`/projekte/${project.id}`} className="list-item list-item-link">
              <div className="list-item-name">{project.title}</div>
              <span className={`status-badge status-${project.status}`}>{STATUS_LABELS[project.status]}</span>
            </Link>
          ))}
          {canWrite && (
            <form onSubmit={(e) => addProject(e, property.id)} className="form-row" style={{ marginTop: 10 }}>
              <input
                placeholder="Neues Projekt, z.B. Terrasse anlegen"
                value={newProjectTitle[property.id] ?? ''}
                onChange={(e) => setNewProjectTitle({ ...newProjectTitle, [property.id]: e.target.value })}
                minLength={2}
                required
                data-testid="project-new-title"
              />
              <button type="submit" className="btn btn-primary" data-testid="project-new-submit">
                Projekt anlegen
              </button>
            </form>
          )}
        </article>
      ))}

      {canWrite && (
        <form onSubmit={addProperty} className="form-row" style={{ marginTop: 16 }}>
          <input
            placeholder="Objekt, z.B. Hauptwohnsitz"
            value={newProperty.label}
            onChange={(e) => setNewProperty({ ...newProperty, label: e.target.value })}
            minLength={2}
            required
            data-testid="property-new-label"
          />
          <input
            placeholder="Straße"
            value={newProperty.street}
            onChange={(e) => setNewProperty({ ...newProperty, street: e.target.value })}
            data-testid="property-new-street"
          />
          <input
            placeholder="PLZ"
            value={newProperty.postalCode}
            onChange={(e) => setNewProperty({ ...newProperty, postalCode: e.target.value })}
            data-testid="property-new-postalCode"
          />
          <input
            placeholder="Ort"
            value={newProperty.city}
            onChange={(e) => setNewProperty({ ...newProperty, city: e.target.value })}
            data-testid="property-new-city"
          />
          <button type="submit" className="btn btn-primary" data-testid="property-new-submit">
            Objekt anlegen
          </button>
        </form>
      )}
    </div>
  );
}
