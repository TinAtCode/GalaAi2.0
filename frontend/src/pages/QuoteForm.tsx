import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

interface Service {
  id: string;
  name: string;
  unit: string;
}

interface Line {
  serviceId: string;
  quantity: string;
}

// Neues Angebot aus Leistungen des Katalogs. Preise rechnet das Backend aus
// der Rezeptur (Kalkulation); hier werden nur Leistungen und Mengen gewählt.
export function QuoteForm({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [services, setServices] = useState<Service[] | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [reverseCharge, setReverseCharge] = useState(false);
  const [vatRate, setVatRate] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || services) return;
    api
      .get<Service[]>('/services')
      .then((list) => {
        setServices(list);
        setLines([{ serviceId: list[0]?.id ?? '', quantity: '' }]);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Leistungen konnten nicht geladen werden.'),
      );
  }, [open, services]);

  const updateLine = (index: number, patch: Partial<Line>) =>
    setLines(lines.map((line, i) => (i === index ? { ...line, ...patch } : line)));

  const reset = () => {
    setOpen(false);
    setLines([{ serviceId: services?.[0]?.id ?? '', quantity: '' }]);
    setReverseCharge(false);
    setVatRate('');
    setError(null);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const lineItems = lines.map((l) => ({
      serviceId: l.serviceId,
      quantity: Number(l.quantity.replace(',', '.')),
    }));
    if (lineItems.some((l) => !l.serviceId || !Number.isFinite(l.quantity) || l.quantity <= 0)) {
      setError('Bitte für jede Position eine Leistung und eine Menge größer 0 angeben.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await api.post('/quotes', {
        projectId,
        lineItems,
        ...(reverseCharge ? { vatTreatment: 'reverse_charge' } : {}),
        ...(!reverseCharge && vatRate.trim() ? { vatRate: Number(vatRate.replace(',', '.')) } : {}),
      });
      reset();
      onCreated();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Angebot konnte nicht angelegt werden.');
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <button
        className="btn"
        style={{ marginBottom: 12 }}
        onClick={() => setOpen(true)}
        data-testid="quote-new"
      >
        Neues Angebot
      </button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="job-card"
      style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'stretch' }}
      data-testid="quote-form"
    >
      <strong>Neues Angebot</strong>
      {services?.length === 0 && (
        <p className="list-item-meta">Noch keine Leistungen angelegt (Stammdaten → Leistungen).</p>
      )}
      {services && services.length > 0 && (
        <>
          {lines.map((line, index) => {
            const unit = services.find((s) => s.id === line.serviceId)?.unit ?? '';
            return (
              <div key={index} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}>
                <label className="field" style={{ flex: '2 1 220px' }}>
                  <span>Leistung</span>
                  <select
                    value={line.serviceId}
                    onChange={(e) => updateLine(index, { serviceId: e.target.value })}
                    data-testid="quote-line-service"
                  >
                    {services.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name} ({s.unit})
                      </option>
                    ))}
                  </select>
                </label>
                <label className="field" style={{ flex: '1 1 100px' }}>
                  <span>Menge{unit ? ` (${unit})` : ''}</span>
                  <input
                    value={line.quantity}
                    onChange={(e) => updateLine(index, { quantity: e.target.value })}
                    inputMode="decimal"
                    required
                    data-testid="quote-line-quantity"
                  />
                </label>
                {lines.length > 1 && (
                  <button
                    type="button"
                    className="btn"
                    onClick={() => setLines(lines.filter((_, i) => i !== index))}
                    aria-label="Position entfernen"
                  >
                    Entfernen
                  </button>
                )}
              </div>
            );
          })}
          <button
            type="button"
            className="btn"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => setLines([...lines, { serviceId: services[0].id, quantity: '' }])}
            data-testid="quote-line-add"
          >
            Weitere Position
          </button>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.9rem' }}>
            <input
              type="checkbox"
              checked={reverseCharge}
              onChange={(e) => setReverseCharge(e.target.checked)}
              data-testid="quote-reverse-charge"
            />
            § 13b UStG – der Kunde (Bauunternehmen) schuldet die Umsatzsteuer
          </label>
          {!reverseCharge && (
            <label className="field" style={{ maxWidth: 220 }}>
              <span>USt-Satz in % (leer = Standard der Firma)</span>
              <input value={vatRate} onChange={(e) => setVatRate(e.target.value)} inputMode="decimal" />
            </label>
          )}
        </>
      )}
      {error && <p className="field-error">{error}</p>}
      <div style={{ display: 'flex', gap: 10 }}>
        <button
          type="submit"
          className="btn btn-primary"
          disabled={busy || !services?.length}
          data-testid="quote-submit"
        >
          Angebot anlegen
        </button>
        <button type="button" className="btn" onClick={reset}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
