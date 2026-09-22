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

      {hasMore && customers && (
        <LoadMore shown={customers.length} total={total} onLoadMore={loadMore} loading={loadingMore} />
      )}
    </div>
  );
}
