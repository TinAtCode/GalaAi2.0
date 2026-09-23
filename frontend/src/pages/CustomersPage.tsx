import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { usePagedList } from '../api/usePagedList';
import { LoadMore } from '../layout/LoadMore';

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export function CustomersPage() {
  const {
    items: customers,
    total,
    error,
    hasMore,
    loadMore,
    loadingMore,
  } = usePagedList<Customer>('/customers', 'Kunden konnten nicht geladen werden.');
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
      <header className="my-day-header">
        <h2>Kunden</h2>
      </header>

      {hasPermission('customer.write') && (
        <form onSubmit={createCustomer} className="form-row" style={{ marginBottom: 16 }}>
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

      {customers?.length === 0 && (
        <div className="empty-state">
          <strong>Noch keine Kunden angelegt.</strong>
          Lege oben den ersten Kunden an.
        </div>
      )}

      {customers?.map((customer) => (
        <Link
          key={customer.id}
          to={`/kunden/${customer.id}`}
          className="list-item list-item-link"
          data-testid="customer-list-item"
        >
          <div>
            <div className="list-item-name">{customer.name}</div>
            {customer.email && <div className="list-item-meta">{customer.email}</div>}
          </div>
        </Link>
      ))}

      {hasMore && customers && (
        <LoadMore shown={customers.length} total={total} onLoadMore={loadMore} loading={loadingMore} />
      )}
    </div>
  );
}
