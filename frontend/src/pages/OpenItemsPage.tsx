import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, ApiError } from '../api/client';
import { formatEuro } from '../format';

interface DunningNotice {
  id: string;
  level: number;
  issuedOn: string; // JJJJ-MM-TT
  deadline: string;
  sentAt: string | null;
  fee: string;
  interest: string;
  lumpSum: string;
}

interface OpenItem {
  invoiceId: string;
  number: string;
  kind: 'partial' | 'final';
  dueDate: string; // JJJJ-MM-TT
  daysOverdue: number;
  totalGross: string;
  paid: string;
  open: string;
  // Mahnkosten und Zinsen neben dem Rechnungsbetrag
  charges?: { costs: string; interest: string; waived: string; open: string };
  totalOpen?: string;
  project: { id: string; title: string };
  customer: { id: string; name: string };
  dunning: DunningNotice[];
  // nächste mögliche Mahnstufe; null = derzeit keine (nicht überfällig,
  // Frist der letzten Mahnung läuft noch oder letzte Stufe erreicht)
  nextDunningLevel: number | null;
}

const KIND_LABELS: Record<OpenItem['kind'], string> = {
  partial: 'Abschlag',
  final: 'Rechnung',
};

const DUNNING_TITLES: Record<number, string> = {
  1: 'Zahlungserinnerung',
  2: '1. Mahnung',
  3: '2. Mahnung',
};

// JJJJ-MM-TT -> TT.MM.JJJJ (wie in den PDFs, unabhängig vom Browser)
const day = (iso: string) => iso.slice(0, 10).split('-').reverse().join('.');

// Offene Posten: ausgestellte Rechnungen, die noch nicht (vollständig)
// bezahlt sind – älteste Fälligkeit zuerst, Überfälliges hervorgehoben.
// Von hier aus wird gemahnt: Zahlungserinnerung, 1. und 2. Mahnung.
export function OpenItemsPage() {
  const [items, setItems] = useState<OpenItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(
    () =>
      api
        .get<OpenItem[]>('/open-items')
        .then(setItems)
        .catch((err) =>
          setError(err instanceof ApiError ? err.message : 'Offene Posten konnten nicht geladen werden.'),
        ),
    [],
  );

  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      await action();
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Aktion fehlgeschlagen.');
    } finally {
      setBusy(false);
    }
  };

  // Mahnung per E-Mail; ohne Eingabe an die E-Mail-Adresse des Kunden
  const sendDunning = (item: OpenItem, dunning: DunningNotice) => {
    const title = DUNNING_TITLES[dunning.level];
    const to = window.prompt(
      `${title} zu ${item.number} per E-Mail senden an (leer = E-Mail des Kunden):`,
      '',
    );
    if (to === null) return;
    run(async () => {
      const result = await api.post<{ to: string }>(
        `/invoices/${item.invoiceId}/dunning/${dunning.id}/send`,
        to.trim() ? { to: to.trim() } : {},
      );
      setNotice(`${title} zu ${item.number} an ${result.to} gesendet.`);
    });
  };

  const sum = (list: OpenItem[]) => list.reduce((total, item) => total + Number(item.open), 0);
  const charges = (list: OpenItem[]) =>
    list.reduce((total, item) => total + Number(item.charges?.open ?? 0), 0);
  const overdue = items?.filter((i) => i.daysOverdue > 0) ?? [];

  return (
    <div>
      <header className="page-header">
        <h2>Offene Posten</h2>
      </header>
      {error && <p className="field-error">{error}</p>}
      {notice && (
        <p className="list-item-meta" data-testid="open-items-notice">
          {notice}
        </p>
      )}
      {items === null && !error && <p>Lädt …</p>}
      {items && (
        <p className="list-item-meta" data-testid="open-items-summary">
          {items.length} offene Rechnung{items.length === 1 ? '' : 'en'} · {formatEuro(sum(items))} offen
          {overdue.length > 0 && ` · davon ${formatEuro(sum(overdue))} überfällig`}
          {charges(items) > 0 && ` · zzgl. ${formatEuro(charges(items))} Mahnkosten und Zinsen`}
        </p>
      )}
      {items?.length === 0 && (
        <div className="empty-state">
          <strong>Alles bezahlt.</strong>
          Zahlungseingänge werden an der Rechnung im Projekt erfasst.
        </div>
      )}
      {items?.map((item) => (
        <div
          key={item.invoiceId}
          className="list-item"
          data-testid="open-item"
          data-invoice-id={item.invoiceId}
        >
          <div>
            <div className="list-item-name">
              {KIND_LABELS[item.kind]} {item.number} · {item.customer.name}
            </div>
            <div className="list-item-meta">
              <Link to={`/projekte/${item.project.id}`}>{item.project.title}</Link> · fällig am{' '}
              {day(item.dueDate)}
              {Number(item.paid) > 0 &&
                ` · bezahlt ${formatEuro(item.paid)} von ${formatEuro(item.totalGross)}`}
            </div>
            {item.dunning.map((d, index) => (
              <div key={d.id} className="list-item-meta" data-testid="dunning-entry">
                {DUNNING_TITLES[d.level]} vom {day(d.issuedOn)} · Frist {day(d.deadline)}
                {Number(d.fee) + Number(d.interest) + Number(d.lumpSum) > 0 &&
                  ` · zzgl. ${formatEuro(Number(d.fee) + Number(d.interest) + Number(d.lumpSum))} Gebühren/Zinsen`}
                {d.sentAt ? ' · per E-Mail versendet' : ''}{' '}
                <button
                  className="btn btn-sm"
                  disabled={busy}
                  onClick={() => run(() => api.openFile(`/invoices/${item.invoiceId}/dunning/${d.id}/pdf`))}
                  data-testid="dunning-pdf"
                >
                  PDF
                </button>{' '}
                {/* versendet wird nur die neueste Mahnung */}
                {index === item.dunning.length - 1 && (
                  <button
                    className="btn btn-sm"
                    disabled={busy}
                    onClick={() => sendDunning(item, d)}
                    data-testid="dunning-send"
                  >
                    Per E-Mail
                  </button>
                )}
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ textAlign: 'right' }}>
              <strong data-testid="open-item-amount">{formatEuro(item.open)}</strong>
              {Number(item.charges?.open ?? 0) > 0 && (
                <div className="list-item-meta" data-testid="open-item-charges">
                  + {formatEuro(item.charges!.open)} Mahnkosten/Zinsen
                </div>
              )}
            </div>
            {item.daysOverdue > 0 && (
              <span className="status-badge status-cancelled" data-testid="open-item-overdue">
                {item.daysOverdue} Tag{item.daysOverdue === 1 ? '' : 'e'} überfällig
              </span>
            )}
            {item.nextDunningLevel && (
              <button
                className="btn"
                disabled={busy}
                onClick={() => run(() => api.post(`/invoices/${item.invoiceId}/dunning`))}
                data-testid="dunning-create"
              >
                {DUNNING_TITLES[item.nextDunningLevel]} erstellen
              </button>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}
