import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { formatEuro, parseAmount } from '../format';

interface Invoice {
  id: string;
  orderId: string | null;
  contractId?: string | null;
  kind: 'partial' | 'final' | 'cancellation' | 'periodic';
  status: 'draft' | 'issued' | 'cancelled';
  number: string | null;
  issueDate: string | null;
  totalNet: string;
  totalGross: string;
  payments?: Payment[];
  // offene Forderung laut Backend (Rechnungsbetrag, Mahnkosten, Zinsen)
  claims?: {
    principalOpen: string;
    costs: string;
    interest: string;
    waived: string;
    chargesOpen: string;
    totalOpen: string;
  };
}

interface Payment {
  id: string;
  amount: string;
  costsAmount?: string;
  interestAmount?: string;
  paidOn: string;
  method: 'bank' | 'cash' | 'other';
  note: string | null;
}

const METHOD_LABELS: Record<Payment['method'], string> = {
  bank: 'Überweisung',
  cash: 'bar',
  other: 'sonstige',
};

const todayIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// Offen einer ausgestellten Rechnung: Rechnungsbetrag und daneben Mahnkosten/Zinsen
function paymentState(invoice: Invoice) {
  if (invoice.claims)
    return {
      open: Number(invoice.claims.principalOpen),
      charges: Number(invoice.claims.chargesOpen),
      total: Number(invoice.claims.totalOpen),
    };
  const cents = (v: string) => Math.round(Number(v) * 100);
  const paid = (invoice.payments ?? []).reduce((sum, p) => sum + cents(p.amount), 0);
  const open = (cents(invoice.totalGross) - paid) / 100;
  return { open, charges: 0, total: open };
}

const payable = (invoice: Invoice) =>
  invoice.status === 'issued' && invoice.kind !== 'cancellation' && Number(invoice.totalGross) > 0;

const KIND_LABELS: Record<Invoice['kind'], string> = {
  partial: 'Abschlagsrechnung',
  final: 'Schlussrechnung',
  cancellation: 'Stornorechnung',
  periodic: 'Rechnung (Pflegevertrag)',
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
  // Zahlungsformular: für welche Rechnung, mit welchen Eingaben
  const [paymentFor, setPaymentFor] = useState<string | null>(null);
  const [payment, setPayment] = useState({
    amount: '',
    paidOn: todayIso(),
    method: 'bank',
    allocation: 'law' as 'law' | 'principal',
  });

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

  const openPaymentForm = (invoice: Invoice) => {
    setPaymentFor(invoice.id);
    setPayment({
      amount: paymentState(invoice).total.toFixed(2).replace('.', ','),
      paidOn: todayIso(),
      method: 'bank',
      allocation: 'law',
    });
  };

  const recordPayment = (event: FormEvent, invoice: Invoice) => {
    event.preventDefault();
    run(async () => {
      await api.post(`/invoices/${invoice.id}/payments`, {
        amount: parseAmount(payment.amount),
        paidOn: payment.paidOn,
        method: payment.method,
        allocation: payment.allocation,
      });
      setPaymentFor(null);
    });
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
      <h3 style={{ marginBottom: 8 }}>Rechnungen</h3>
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
              {payable(invoice) && (
                <span data-testid="invoice-open">
                  {paymentState(invoice).total <= 0
                    ? ' · bezahlt'
                    : paymentState(invoice).open > 0
                      ? ` · offen ${formatEuro(paymentState(invoice).open)}`
                      : ''}
                </span>
              )}
            </div>
            {payable(invoice) && paymentState(invoice).charges > 0 && (
              <div className="list-item-meta" data-testid="invoice-charges">
                <span style={{ color: 'var(--color-warning)' }}>
                  Mahnkosten und Zinsen offen: {formatEuro(paymentState(invoice).charges)}
                </span>{' '}
                <button
                  className="btn btn-sm btn-ghost"
                  disabled={busy}
                  onClick={() => {
                    const reason = window.prompt(
                      'Mahnkosten und Zinsen erlassen – Grund (optional):',
                      'Kulanz',
                    );
                    if (reason !== null)
                      run(() => api.post(`/invoices/${invoice.id}/charges/waive`, { reason }));
                  }}
                  data-testid="invoice-charges-waive"
                >
                  Erlassen
                </button>
              </div>
            )}
            {(invoice.payments ?? []).map((p) => (
              <div key={p.id} className="list-item-meta" data-testid="invoice-payment-entry">
                Zahlung {formatEuro(p.amount)} am {new Date(p.paidOn).toLocaleDateString('de-DE')} (
                {METHOD_LABELS[p.method]})
                {(Number(p.costsAmount ?? 0) > 0 || Number(p.interestAmount ?? 0) > 0) &&
                  `, davon ${[
                    Number(p.costsAmount) > 0 ? `${formatEuro(p.costsAmount)} Mahnkosten` : null,
                    Number(p.interestAmount) > 0 ? `${formatEuro(p.interestAmount)} Zinsen` : null,
                  ]
                    .filter(Boolean)
                    .join(' und ')}`}{' '}
                <button
                  className="btn"
                  style={{ padding: '0 6px', fontSize: '0.8rem' }}
                  disabled={busy}
                  onClick={() => {
                    if (window.confirm('Diese Zahlung löschen (Korrektur)?')) {
                      run(() => api.delete(`/invoices/${invoice.id}/payments/${p.id}`));
                    }
                  }}
                  data-testid="invoice-payment-delete"
                >
                  Löschen
                </button>
              </div>
            ))}
            {paymentFor === invoice.id && (
              <form
                onSubmit={(e) => recordPayment(e, invoice)}
                style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 8 }}
                data-testid="payment-form"
              >
                <label className="field" style={{ maxWidth: 140 }}>
                  <span>Betrag (€)</span>
                  <input
                    value={payment.amount}
                    onChange={(e) => setPayment({ ...payment, amount: e.target.value })}
                    inputMode="decimal"
                    required
                    data-testid="payment-amount"
                  />
                </label>
                <label className="field">
                  <span>Eingang am</span>
                  <input
                    type="date"
                    value={payment.paidOn}
                    onChange={(e) => setPayment({ ...payment, paidOn: e.target.value })}
                    required
                    data-testid="payment-date"
                  />
                </label>
                <label className="field">
                  <span>Art</span>
                  <select
                    value={payment.method}
                    onChange={(e) => setPayment({ ...payment, method: e.target.value })}
                    data-testid="payment-method"
                  >
                    <option value="bank">Überweisung</option>
                    <option value="cash">bar</option>
                    <option value="other">sonstige</option>
                  </select>
                </label>
                {paymentState(invoice).charges > 0 && (
                  <label className="field">
                    <span>Verrechnen</span>
                    <select
                      value={payment.allocation}
                      onChange={(e) => {
                        const allocation = e.target.value as 'law' | 'principal';
                        const state = paymentState(invoice);
                        // Betrag passend vorschlagen: alles oder nur der Rechnungsbetrag
                        const amount = allocation === 'law' ? state.total : state.open;
                        setPayment({ ...payment, allocation, amount: amount.toFixed(2).replace('.', ',') });
                      }}
                      data-testid="payment-allocation"
                    >
                      <option value="law">erst Mahnkosten und Zinsen (§ 367 BGB)</option>
                      <option value="principal">nur auf den Rechnungsbetrag</option>
                    </select>
                  </label>
                )}
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={busy}
                  data-testid="payment-submit"
                >
                  Buchen
                </button>
                <button type="button" className="btn" onClick={() => setPaymentFor(null)}>
                  Abbrechen
                </button>
              </form>
            )}
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
            {payable(invoice) && paymentState(invoice).total > 0 && paymentFor !== invoice.id && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => openPaymentForm(invoice)}
                data-testid="invoice-payment"
              >
                Zahlung
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
