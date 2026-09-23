import { useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { formatEuro } from '../format';

interface Invoice {
  id: string;
  orderId: string;
  kind: 'partial' | 'final' | 'cancellation';
  status: 'draft' | 'issued' | 'cancelled';
  number: string | null;
  issueDate: string | null;
  totalNet: string;
  totalGross: string;
}

const KIND_LABELS: Record<Invoice['kind'], string> = {
  partial: 'Abschlagsrechnung',
  final: 'Schlussrechnung',
  cancellation: 'Stornorechnung',
};

const STATUS_LABELS: Record<Invoice['status'], string> = {
  draft: 'Entwurf',
  issued: 'Ausgestellt',
  cancelled: 'Storniert',
};

// Rechnungen eines Projekts (nur mit invoice.create sichtbar, siehe
// ProjectDetailPage). Ausgestellte Rechnungen sind unveränderlich – korrigiert
// wird per Storno.
export function InvoicesSection({ projectId, orderIds }: { projectId: string; orderIds: string[] }) {
  const [invoices, setInvoices] = useState<Invoice[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api
        .get<Invoice[]>(`/invoices/by-project/${projectId}`)
        .then(setInvoices)
        .catch((err) =>
          setError(err instanceof ApiError ? err.message : 'Rechnungen konnten nicht geladen werden.'),
        ),
    [projectId],
  );

  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  const createPartial = (orderId: string) => {
    const input = window.prompt('Abschlag in Prozent der Auftragssumme:', '30');
    const percent = input ? Number(input.replace(',', '.')) : NaN;
    if (Number.isFinite(percent)) {
      run(() => api.post('/invoices/from-order', { orderId, kind: 'partial', percent }));
    }
  };

  // Versand per E-Mail: PDF und E-Rechnung im Anhang. Ohne Eingabe geht die
  // Mail an die E-Mail-Adresse des Kunden.
  const sendByEmail = (invoice: Invoice) => {
    const to = window.prompt(`${invoice.number} per E-Mail senden an (leer = E-Mail des Kunden):`, '');
    if (to === null) return;
    setNotice(null);
    run(async () => {
      const result = await api.post<{ to: string }>(
        `/invoices/${invoice.id}/send`,
        to.trim() ? { to: to.trim() } : {},
      );
      setNotice(`${invoice.number} wurde an ${result.to} gesendet (PDF und E-Rechnung).`);
    });
  };

  const cancel = (invoice: Invoice) => {
    const reason = window.prompt(`Grund für das Storno von ${invoice.number}:`);
    if (reason) run(() => api.post(`/invoices/${invoice.id}/cancel`, { reason }));
  };

  return (
    <>
      <h3 style={{ marginTop: 28, marginBottom: 8 }}>Rechnungen</h3>
      {error && <p className="field-error">{error}</p>}
      {notice && (
        <p className="list-item-meta" data-testid="invoice-notice">
          {notice}
        </p>
      )}

      {orderIds.map((orderId) => (
        <div key={orderId} style={{ display: 'flex', gap: 10, marginBottom: 12 }} data-order-id={orderId}>
          <button
            className="btn"
            disabled={busy}
            onClick={() => createPartial(orderId)}
            data-testid="invoice-new-partial"
          >
            Abschlagsrechnung
          </button>
          <button
            className="btn"
            disabled={busy}
            onClick={() => run(() => api.post('/invoices/from-order', { orderId, kind: 'final' }))}
            data-testid="invoice-new-final"
          >
            Schlussrechnung
          </button>
        </div>
      ))}

      {invoices?.length === 0 && <p className="list-item-meta">Noch keine Rechnungen.</p>}

      {invoices?.map((invoice) => (
        <div key={invoice.id} className="list-item" data-testid="invoice-item" data-invoice-id={invoice.id}>
          <div>
            <div className="list-item-name">
              {KIND_LABELS[invoice.kind]} <span data-testid="invoice-number">{invoice.number ?? ''}</span>
            </div>
            <div className="list-item-meta">
              {formatEuro(invoice.totalGross)} brutto
              {invoice.issueDate ? ` · vom ${new Date(invoice.issueDate).toLocaleDateString('de-DE')}` : ''}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span
              className={`status-badge ${invoice.status === 'issued' ? 'status-done' : invoice.status === 'cancelled' ? 'status-cancelled' : 'status-open'}`}
              data-testid="invoice-status"
            >
              {STATUS_LABELS[invoice.status]}
            </span>
            <button
              className="btn"
              disabled={busy}
              onClick={() => run(() => api.openFile(`/invoices/${invoice.id}/pdf`))}
              data-testid="invoice-pdf"
            >
              PDF
            </button>
            {invoice.status !== 'draft' && invoice.number && (
              <button
                className="btn"
                disabled={busy}
                onClick={() =>
                  run(() => api.downloadFile(`/invoices/${invoice.id}/xrechnung`, `${invoice.number}.xml`))
                }
                title="E-Rechnung im Format XRechnung (CII)"
                data-testid="invoice-xrechnung"
              >
                E-Rechnung
              </button>
            )}
            {invoice.status === 'draft' && (
              <>
                <button
                  className="btn btn-primary"
                  disabled={busy}
                  onClick={() => run(() => api.post(`/invoices/${invoice.id}/issue`, {}))}
                  data-testid="invoice-issue"
                >
                  Ausstellen
                </button>
                <button
                  className="btn"
                  disabled={busy}
                  onClick={() => run(() => api.delete(`/invoices/${invoice.id}`))}
                >
                  Löschen
                </button>
              </>
            )}
            {invoice.status !== 'draft' && invoice.number && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => sendByEmail(invoice)}
                data-testid="invoice-send"
              >
                Per E-Mail
              </button>
            )}
            {invoice.status === 'issued' && invoice.kind !== 'cancellation' && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => cancel(invoice)}
                data-testid="invoice-cancel"
              >
                Stornieren
              </button>
            )}
          </div>
        </div>
      ))}
    </>
  );
}
