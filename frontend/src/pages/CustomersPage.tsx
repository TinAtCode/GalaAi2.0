import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

interface Customer {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
}

export function CustomersPage() {
  const [customers, setCustomers] = useState<Customer[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<Customer[]>('/customers')
      .then(setCustomers)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Kunden konnten nicht geladen werden.'),
      );
  }, []);

  return (
    <div>
      <header className="my-day-header">
        <h2>Kunden</h2>
      </header>

      {error && <p className="field-error">{error}</p>}
      {!error && customers === null && <p>Lädt …</p>}

      {customers?.length === 0 && (
        <div className="empty-state">
          <strong>Noch keine Kunden angelegt.</strong>
          Neue Kunden werden im Büro erfasst.
        </div>
      )}

      {customers?.map((customer) => (
        <div key={customer.id} className="list-item">
          <div>
            <div className="list-item-name">{customer.name}</div>
            {customer.email && <div className="list-item-meta">{customer.email}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}
