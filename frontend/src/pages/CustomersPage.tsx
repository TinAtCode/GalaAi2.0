import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { useDebounced, usePagedList } from '../api/usePagedList';
import { LoadMore } from '../layout/LoadMore';

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  city: string | null;
}

export function CustomersPage() {
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const {
    items: customers,
    total,
    error,
    hasMore,
    loadMore,
    loadingMore,
  } = usePagedList<Customer>(
    q ? `/customers?q=${encodeURIComponent(q)}` : '/customers',
    'Kunden konnten nicht geladen werden.',
  );
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [newName, setNewName] = useState('');
  const [createError, setCreateError] = useState<string | null>(null);

  // Neuer Kunde -> direkt zur Detailseite, dort Anschrift und Objekte ergänzen.
  const createCustomer = async (event: FormEvent) => {
    event.preventDefault();
    setCreateError(null);
    try {
      const customer = await api.post<{ id: string }>('/customers', { name: newName.trim() });
      navigate(`/kunden/${customer.id}`);
    } catch (err) {
      setCreateError(err instanceof ApiError ? err.message : 'Kunde konnte nicht angelegt werden.');
    }
  };

  return (
    <div>
      <header className="page-header">
        <div>
          <h2>Kunden</h2>
          {customers && (
            <p>
              {total} {total === 1 ? 'Kunde' : 'Kunden'}
              {q ? ' gefunden' : ''}
            </p>
          )}
        </div>
      </header>

      {hasPermission('customer.write') && (
        <form onSubmit={createCustomer} className="form-row card" style={{ marginBottom: 16 }}>
          <input
            placeholder="Neuer Kunde, z.B. Familie Berger"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            minLength={2}
            required
            data-testid="customer-new-name"
          />
          <button type="submit" className="btn btn-primary" data-testid="customer-new-submit">
            Kunde anlegen
          </button>
        </form>
      )}
      {createError && <p className="field-error">{createError}</p>}
      {error && <p className="field-error">{error}</p>}
      {!error && customers === null && <p>Lädt …</p>}

      <div className="toolbar">
        <input
          className="search-input"
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Name, E-Mail, Telefon oder Ort suchen"
          aria-label="Kunden durchsuchen"
          data-testid="customer-search"
        />
      </div>

      {customers?.length === 0 &&
        (q ? (
          <div className="empty-state">
            <strong>Keine passenden Kunden.</strong>
            Anderen Suchbegriff versuchen.
          </div>
        ) : (
          <div className="empty-state">
            <strong>Noch keine Kunden angelegt.</strong>
            Lege oben den ersten Kunden an.
          </div>
        ))}

      {!!customers?.length && (
        <div className="list-card">
          {customers.map((customer) => (
            <Link
              key={customer.id}
              to={`/kunden/${customer.id}`}
              className="list-item list-item-link"
              data-testid="customer-list-item"
            >
              <div>
                <div className="list-item-name">{customer.name}</div>
                {(customer.email || customer.city || customer.phone) && (
                  <div className="list-item-meta">
                    {[customer.city, customer.email, customer.phone].filter(Boolean).join(' · ')}
                  </div>
                )}
              </div>
            </Link>
          ))}
          {hasMore && (
            <LoadMore shown={customers.length} total={total} onLoadMore={loadMore} loading={loadingMore} />
          )}
        </div>
      )}
    </div>
  );
}
