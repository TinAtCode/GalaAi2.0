import { useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { TimeTrackingWidget } from './TimeTrackingWidget';
import { OfficeOverview } from './OfficeOverview';

interface MyDayItem {
  id: string;
  time: string;
  task: string;
  site: string;
  customer: string;
  address: string;
  status: 'planned' | 'done' | 'cancelled';
  notes: string | null;
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
}

export function MyDayPage() {
  const [items, setItems] = useState<MyDayItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<MyDayItem[]>('/appointments/my-day')
      .then(setItems)
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Termine konnten nicht geladen werden.'),
      );
  }, []);

  const today = new Date().toLocaleDateString('de-DE', { weekday: 'long', day: 'numeric', month: 'long' });

  return (
    <div>
      <header className="my-day-header">
        <h2>Mein Tag</h2>
        <p>{today}</p>
      </header>
      <OfficeOverview />

      <TimeTrackingWidget />

      {error && <p className="field-error">{error}</p>}

      {!error && items === null && <p>Lädt …</p>}

      {items?.length === 0 && (
        <div className="empty-state">
          <strong>Heute ist nichts geplant.</strong>
          Termine werden im Büro angelegt und erscheinen automatisch hier.
        </div>
      )}

      {items?.map((item) => (
        <article key={item.id} className="job-card appointment-card">
          <div className="job-card-time">{formatTime(item.time)}</div>
          <div className="job-card-task">{item.task}</div>
          <div className="job-card-meta">
            {item.site} · {item.customer}
          </div>
          {item.address && <div className="job-card-meta">{item.address}</div>}
        </article>
      ))}
    </div>
  );
}
