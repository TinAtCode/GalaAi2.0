import { FormEvent, useEffect, useState } from 'react';
import { useAiTask } from '../ai/tasks';
import { useAuth } from '../auth/AuthContext';
import { api, ApiError } from '../api/client';

interface Service {
  id: string;
  name: string;
  unit: string;
}

// Position aus dem Leistungskatalog (Preis aus der Kalkulation) oder freie
// Position mit eigenem Text und Preis (z.B. Pauschalen).
// Rundung der Menge nur für diese Position: '' = automatisch (Leistung,
// Einheit, Firma), sonst 0–3 Nachkommastellen; Art optional
interface LineRounding {
  roundingDecimals: string;
  roundingMode: string;
  // Schritt (z.B. 0,5) aus einem bestehenden Angebot; das Formular bietet
  // ihn nicht zur Auswahl an, übernimmt ihn aber unverändert
  roundingStep: string;
}

type Line = LineRounding &
  (
    | { kind: 'service'; serviceId: string; quantity: string }
    | {
        kind: 'free';
        description: string;
        unit: string;
        quantity: string;
        unitPrice: string;
        costPerUnit: string;
      }
  );

const NO_ROUNDING: LineRounding = { roundingDecimals: '', roundingMode: '', roundingStep: '' };

const decimal = (value: string) => Number(value.replace(',', '.'));
const text = (value: number | string | undefined) =>
  value === undefined ? '' : String(Number(value)).replace('.', ',');

// Ein bestehender Entwurf, der überarbeitet wird
export interface EditableQuote {
  id: string;
  vatRate: number | string;
  vatTreatment: 'standard' | 'small_business' | 'reverse_charge';
  introText?: string | null;
  lineItems: {
    serviceId?: string | null;
    description: string;
    unit: string;
    quantity: number | string;
    unitPrice?: number | string;
    costPerUnit?: number | string;
    quantityExact?: number | string;
    roundingDecimals?: number | null;
    roundingMode?: string | null;
    roundingStep?: number | string | null;
  }[];
}

// Beim Bearbeiten die genaue Menge zeigen – gerundet wird beim Speichern neu
const linesOf = (quote: EditableQuote): Line[] =>
  quote.lineItems.map((li) => {
    const rounding = {
      roundingDecimals: li.roundingDecimals != null ? String(li.roundingDecimals) : '',
      roundingMode: li.roundingMode ?? '',
      roundingStep: li.roundingStep != null ? String(Number(li.roundingStep)) : '',
    };
    const quantity = text(li.quantityExact ?? li.quantity);
    return li.serviceId
      ? { kind: 'service', serviceId: li.serviceId, quantity, ...rounding }
      : {
          kind: 'free',
          description: li.description,
          unit: li.unit,
          quantity,
          unitPrice: text(li.unitPrice),
          costPerUnit: text(li.costPerUnit),
          ...rounding,
        };
  });

// Neues Angebot aus Leistungen des Katalogs und freien Positionen. Preise
// der Katalog-Leistungen rechnet das Backend aus der Rezeptur (Kalkulation).
// Mit `quote` wird ein Entwurf überarbeitet (PUT), sonst neu angelegt.
export function QuoteForm({
  projectId,
  onCreated,
  quote,
  onCancel,
  showCost = false,
}: {
  projectId: string;
  onCreated: () => void;
  quote?: EditableQuote;
  onCancel?: () => void;
  // Kosten je Einheit bei freien Positionen (nur mit Einkaufsrechten)
  showCost?: boolean;
}) {
  const [open, setOpen] = useState(!!quote);
  const [services, setServices] = useState<Service[] | null>(null);
  const [lines, setLines] = useState<Line[]>(() => (quote ? linesOf(quote) : []));
  const [reverseCharge, setReverseCharge] = useState(quote?.vatTreatment === 'reverse_charge');
  const [vatRate, setVatRate] = useState(quote?.vatTreatment === 'standard' ? text(quote.vatRate) : '');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [introText, setIntroText] = useState(quote?.introText ?? '');
  const [drafting, setDrafting] = useState(false);
  const { hasPermission } = useAuth();
  const aiText = useAiTask('angebotstext') && hasPermission('ai.use');

  const serviceLine = (list: Service[] | null): Line[] =>
    list?.length ? [{ kind: 'service', serviceId: list[0].id, quantity: '', ...NO_ROUNDING }] : [];

  useEffect(() => {
    if (!open || services) return;
    api
      .get<Service[]>('/services')
      .then((list) => {
        setServices(list);
        if (!quote) setLines(serviceLine(list));
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Leistungen konnten nicht geladen werden.'),
      );
  }, [open, services, quote]);

  const updateLine = (index: number, patch: Partial<Line>) =>
    setLines(lines.map((line, i) => (i === index ? ({ ...line, ...patch } as Line) : line)));

  const reset = () => {
    if (quote) {
      onCancel?.();
      return;
    }
    setOpen(false);
    setLines(serviceLine(services));
    setReverseCharge(false);
    setVatRate('');
    setIntroText('');
    setError(null);
  };

  // Vorschlag der KI aus Kunde, Projekt und Positionen (ohne Preise)
  const draftIntro = async () => {
    const draftLines = lines.map((l) =>
      l.kind === 'service'
        ? { serviceId: l.serviceId, quantity: decimal(l.quantity) || undefined }
        : {
            description: l.description.trim() || undefined,
            unit: l.unit.trim() || undefined,
            quantity: decimal(l.quantity) || undefined,
          },
    );
    setDrafting(true);
    setError(null);
    try {
      const r = await api.post<{ text: string }>('/ai/assist/quote-text', { projectId, lines: draftLines });
      setIntroText(r.text.slice(0, 4000));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kein Vorschlag der KI.');
    } finally {
      setDrafting(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lines.length === 0) {
      setError('Bitte mindestens eine Position anlegen.');
      return;
    }
    const roundingOf = (l: LineRounding) => ({
      ...(l.roundingDecimals !== '' ? { roundingDecimals: Number(l.roundingDecimals) } : {}),
      ...(l.roundingMode ? { roundingMode: l.roundingMode } : {}),
      ...(l.roundingStep ? { roundingStep: Number(l.roundingStep) } : {}),
    });
    const lineItems = lines.map((l) =>
      l.kind === 'service'
        ? { serviceId: l.serviceId, quantity: decimal(l.quantity), ...roundingOf(l) }
        : {
            ...roundingOf(l),
            description: l.description.trim(),
            unit: l.unit.trim(),
            quantity: decimal(l.quantity),
            unitPrice: decimal(l.unitPrice),
            ...(l.costPerUnit.trim() ? { costPerUnit: decimal(l.costPerUnit) } : {}),
          },
    );
    const invalid = lineItems.some(
      (l) =>
        !Number.isFinite(l.quantity) ||
        l.quantity <= 0 ||
        ('serviceId' in l
          ? !l.serviceId
          : !l.description ||
            !l.unit ||
            !Number.isFinite(l.unitPrice) ||
            l.unitPrice < 0 ||
            ('costPerUnit' in l && (!Number.isFinite(l.costPerUnit) || (l.costPerUnit ?? 0) < 0))),
    );
    if (invalid) {
      setError(
        'Bitte für jede Position Menge größer 0 angeben; freie Positionen brauchen Text, Einheit und Preis.',
      );
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body = {
        lineItems,
        introText,
        ...(reverseCharge ? { vatTreatment: 'reverse_charge' } : {}),
        ...(!reverseCharge && vatRate.trim() ? { vatRate: decimal(vatRate) } : {}),
      };
      if (quote) {
        await api.put(`/quotes/${quote.id}`, body);
      } else {
        await api.post('/quotes', { projectId, ...body });
        reset();
      }
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

  // Rundung nur für diese Position; automatisch = aus Leistung, Einheit bzw. Firma
  const roundingSelect = (line: Line, index: number) => (
    <label className="field" style={{ flex: '1 1 150px' }}>
      <span>Rundung</span>
      <select
        value={
          line.roundingStep
            ? 'step'
            : line.roundingDecimals === ''
              ? ''
              : `${line.roundingDecimals}|${line.roundingMode}`
        }
        onChange={(e) => {
          if (e.target.value === 'step') return;
          const [d, m] = e.target.value.split('|');
          updateLine(index, { roundingDecimals: d ?? '', roundingMode: m ?? '', roundingStep: '' });
        }}
        data-testid="quote-line-rounding"
      >
        <option value="">automatisch</option>
        {line.roundingStep && (
          <option value="step">Schritt {line.roundingStep.replace('.', ',')} (bisher)</option>
        )}
        <option value="0|up">ganze, aufrunden</option>
        <option value="0|half_up">ganze, kaufmännisch</option>
        <option value="1|half_up">1 Nachkommastelle</option>
        <option value="2|half_up">2 Nachkommastellen</option>
        <option value="3|half_up">3 Nachkommastellen (genau)</option>
      </select>
    </label>
  );

  const removeButton = (index: number) => (
    <button
      type="button"
      className="btn"
      onClick={() => setLines(lines.filter((_, i) => i !== index))}
      aria-label="Position entfernen"
    >
      Entfernen
    </button>
  );

  return (
    <form
      onSubmit={submit}
      className="job-card"
      style={{ marginBottom: 16, display: 'flex', flexDirection: 'column', gap: 12, alignItems: 'stretch' }}
      data-testid="quote-form"
    >
      <strong>{quote ? 'Angebot bearbeiten' : 'Neues Angebot'}</strong>
      {services?.length === 0 && (
        <p className="list-item-meta">
          Noch keine Leistungen im Katalog (Stammdaten → Leistungen) – freie Positionen sind möglich.
        </p>
      )}
      {services && (
        <>
          {lines.map((line, index) =>
            line.kind === 'service' ? (
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
                  <span>
                    Menge
                    {(() => {
                      const unit = services.find((s) => s.id === line.serviceId)?.unit;
                      return unit ? ` (${unit})` : '';
                    })()}
                  </span>
                  <input
                    value={line.quantity}
                    onChange={(e) => updateLine(index, { quantity: e.target.value })}
                    inputMode="decimal"
                    required
                    data-testid="quote-line-quantity"
                  />
                </label>
                {roundingSelect(line, index)}
                {lines.length > 1 && removeButton(index)}
              </div>
            ) : (
              <div
                key={index}
                style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap' }}
                data-testid="quote-free-line"
              >
                <label className="field" style={{ flex: '3 1 240px' }}>
                  <span>Text (freie Position)</span>
                  <input
                    value={line.description}
                    onChange={(e) => updateLine(index, { description: e.target.value })}
                    maxLength={500}
                    required
                    data-testid="quote-free-description"
                  />
                </label>
                <label className="field" style={{ flex: '1 1 80px' }}>
                  <span>Einheit</span>
                  <input
                    value={line.unit}
                    onChange={(e) => updateLine(index, { unit: e.target.value })}
                    placeholder="psch"
                    maxLength={20}
                    required
                    data-testid="quote-free-unit"
                  />
                </label>
                <label className="field" style={{ flex: '1 1 80px' }}>
                  <span>Menge</span>
                  <input
                    value={line.quantity}
                    onChange={(e) => updateLine(index, { quantity: e.target.value })}
                    inputMode="decimal"
                    required
                    data-testid="quote-free-quantity"
                  />
                </label>
                <label className="field" style={{ flex: '1 1 110px' }}>
                  <span>Preis je Einheit (€ netto)</span>
                  <input
                    value={line.unitPrice}
                    onChange={(e) => updateLine(index, { unitPrice: e.target.value })}
                    inputMode="decimal"
                    required
                    data-testid="quote-free-price"
                  />
                </label>
                {roundingSelect(line, index)}
                {showCost && (
                  <label className="field" style={{ flex: '1 1 110px' }}>
                    <span>Kosten je Einheit (optional)</span>
                    <input
                      value={line.costPerUnit}
                      onChange={(e) => updateLine(index, { costPerUnit: e.target.value })}
                      inputMode="decimal"
                      data-testid="quote-free-cost"
                    />
                  </label>
                )}
                {lines.length > 1 && removeButton(index)}
              </div>
            ),
          )}
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {services.length > 0 && (
              <button
                type="button"
                className="btn"
                onClick={() => setLines([...lines, ...serviceLine(services)])}
                data-testid="quote-line-add"
              >
                Weitere Leistung
              </button>
            )}
            <button
              type="button"
              className="btn"
              onClick={() =>
                setLines([
                  ...lines,
                  {
                    kind: 'free',
                    description: '',
                    unit: '',
                    quantity: '1',
                    unitPrice: '',
                    costPerUnit: '',
                    ...NO_ROUNDING,
                  },
                ])
              }
              data-testid="quote-free-add"
            >
              Freie Position
            </button>
          </div>
          <label className="field">
            <span>Anschreiben (steht im PDF über den Positionen, optional)</span>
            <textarea
              value={introText}
              onChange={(e) => setIntroText(e.target.value)}
              rows={4}
              maxLength={4000}
              data-testid="quote-intro"
            />
          </label>
          {aiText && (
            <div>
              <button
                type="button"
                className="btn btn-sm"
                onClick={draftIntro}
                disabled={drafting || lines.length === 0}
                data-testid="quote-intro-ai"
              >
                {drafting ? 'KI schreibt …' : 'Vorschlag der KI'}
              </button>
            </div>
          )}
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
          disabled={busy || !services || lines.length === 0}
          data-testid="quote-submit"
        >
          {quote ? 'Änderungen speichern' : 'Angebot anlegen'}
        </button>
        <button type="button" className="btn" onClick={reset}>
          Abbrechen
        </button>
      </div>
    </form>
  );
}
