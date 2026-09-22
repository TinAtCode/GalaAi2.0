import { FormEvent, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';

interface Service {
  id: string;
  name: string;
  unit: string;
}

interface CalculationResult {
  materialCostPerUnit?: number;
  laborCostPerUnit?: number;
  overheadPerUnit?: number;
  costPerUnit?: number;
  salePricePerUnit?: number;
  marginPerUnit?: number;
  quantity: number;
  materialCostTotal?: number;
  laborCostTotal?: number;
  overheadTotal?: number;
  costTotal?: number;
  salePriceTotal?: number;
  marginTotal?: number;
}

function formatEuro(value?: number): string {
  if (value === undefined) return '–';
  return value.toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
}

export function CalculationPage() {
  const [services, setServices] = useState<Service[]>([]);
  const [serviceId, setServiceId] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [result, setResult] = useState<CalculationResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api
      .get<Service[]>('/services')
      .then((list) => {
        setServices(list);
        if (list.length > 0) setServiceId(list[0].id);
      })
      .catch((err) =>
        setError(err instanceof ApiError ? err.message : 'Dienstleistungen konnten nicht geladen werden.'),
      );
  }, []);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError(null);
    setResult(null);
    setSubmitting(true);
    try {
      const calc = await api.post<CalculationResult>('/calculations', { serviceId, quantity });
      setResult(calc);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Kalkulation fehlgeschlagen.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div>
      <header className="my-day-header">
        <h2>Kalkulation</h2>
        <p>Material, Arbeitszeit, Gemeinkosten und Aufschlag – direkt aus der Rezeptur.</p>
      </header>

      {services.length === 0 && !error && <p>Lädt Dienstleistungen …</p>}

      {services.length > 0 && (
        <form onSubmit={handleSubmit} className="login-form">
          <label className="field">
            <span>Dienstleistung</span>
            <select
              value={serviceId}
              onChange={(e) => setServiceId(e.target.value)}
              data-testid="calc-service-select"
            >
              {services.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.unit})
                </option>
              ))}
            </select>
          </label>

          <label className="field">
            <span>Menge</span>
            <input
              type="number"
              min={0.01}
              step={0.01}
              value={quantity}
              onChange={(e) => setQuantity(Number(e.target.value))}
              required
              data-testid="calc-quantity"
            />
          </label>

          {error && <p className="field-error">{error}</p>}

          <button
            type="submit"
            className="btn btn-primary btn-block"
            disabled={submitting}
            data-testid="calc-submit"
          >
            {submitting ? 'Berechnet …' : 'Kalkulation berechnen'}
          </button>
        </form>
      )}

      {result && (
        <div className="job-card" style={{ marginTop: 20 }} data-testid="calc-result">
          <div className="job-card-task">Ergebnis für {result.quantity} Einheiten</div>
          <table className="calc-table">
            <tbody>
              {result.materialCostTotal !== undefined && (
                <tr>
                  <td>Material</td>
                  <td>{formatEuro(result.materialCostTotal)}</td>
                </tr>
              )}
              {result.laborCostTotal !== undefined && (
                <tr>
                  <td>Arbeitszeit</td>
                  <td>{formatEuro(result.laborCostTotal)}</td>
                </tr>
              )}
              {result.overheadTotal !== undefined && (
                <tr>
                  <td>Gemeinkosten</td>
                  <td>{formatEuro(result.overheadTotal)}</td>
                </tr>
              )}
              {result.costTotal !== undefined && (
                <tr>
                  <td>
                    <strong>Kosten gesamt</strong>
                  </td>
                  <td>
                    <strong>{formatEuro(result.costTotal)}</strong>
                  </td>
                </tr>
              )}
              {result.salePriceTotal !== undefined && (
                <tr>
                  <td>
                    <strong>Verkaufspreis</strong>
                  </td>
                  <td>
                    <strong>{formatEuro(result.salePriceTotal)}</strong>
                  </td>
                </tr>
              )}
              {result.marginTotal !== undefined && (
                <tr>
                  <td>Marge</td>
                  <td>{formatEuro(result.marginTotal)}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
