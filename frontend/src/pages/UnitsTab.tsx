import { FormEvent, useCallback, useEffect, useState } from 'react';
import { api, ApiError } from '../api/client';
import { DECIMALS_LABELS, MODE_LABELS, RoundingMode, roundingText } from '../rounding';

interface UnitRow {
  code: string;
  label: string;
  dimension: string | null;
  custom: boolean;
  defaultDecimals: number | null;
  defaultRounding: RoundingMode | null;
  decimals: number | null;
  rounding: RoundingMode | null;
  step: string | null;
}

interface UnitsResponse {
  company: { quantityDecimals: number; quantityRounding: RoundingMode };
  units: UnitRow[];
}

const DIMENSIONS: Record<string, string> = {
  length: 'Länge',
  area: 'Fläche',
  volume: 'Volumen',
  mass: 'Gewicht',
  count: 'Anzahl',
  time: 'Zeit',
  lump: 'pauschal',
};

// Einheiten und Rundung: Standard der Firma, Anpassung je Einheit, eigene
// Einheiten. Leistungen, Artikel und Positionen können davon abweichen.
export function UnitsTab({ canWrite }: { canWrite: boolean }) {
  const [data, setData] = useState<UnitsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [edit, setEdit] = useState<Record<string, { decimals: string; rounding: string; step: string }>>({});
  const [custom, setCustom] = useState({ code: '', label: '' });

  const load = useCallback(
    () =>
      api
        .get<UnitsResponse>('/units')
        .then(setData)
        .catch((err) =>
          setError(err instanceof ApiError ? err.message : 'Einheiten konnten nicht geladen werden.'),
        ),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  const run = async (action: () => Promise<unknown>, message: string) => {
    setError(null);
    setNotice(null);
    try {
      await action();
      setNotice(message);
      setEdit({});
      await load();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Speichern fehlgeschlagen.');
    }
  };

  const saveCompany = (decimals: number, rounding: RoundingMode) =>
    run(
      () => api.patch('/company/settings', { quantityDecimals: decimals, quantityRounding: rounding }),
      'Standard gespeichert.',
    );

  const saveUnit = (u: UnitRow) => {
    const e = edit[u.code];
    return run(
      () =>
        api.put(`/units/${encodeURIComponent(u.code)}`, {
          decimals: e.decimals === '' || e.decimals === 'step' ? null : Number(e.decimals),
          rounding: e.rounding || null,
          step: e.decimals === 'step' && e.step.trim() ? Number(e.step.replace(',', '.')) : null,
        }),
      `${u.label} gespeichert.`,
    );
  };

  const addCustom = (event: FormEvent) => {
    event.preventDefault();
    if (!custom.code.trim()) return;
    run(
      () =>
        api.put(`/units/${encodeURIComponent(custom.code.trim())}`, {
          label: custom.label.trim() || custom.code.trim(),
        }),
      'Einheit angelegt.',
    ).then(() => setCustom({ code: '', label: '' }));
  };

  if (!data) return error ? <p className="field-error">{error}</p> : <p>Lädt …</p>;
  return (
    <div data-testid="units-tab">
      <p className="list-item-meta">
        Mengen auf Angeboten und Rechnungen werden gerundet – die genaue Menge bleibt für die Nachkalkulation
        erhalten. Reihenfolge: Position, dann Leistung bzw. Artikel, dann Einheit, dann Standard der Firma.
        Geldbeträge bleiben immer centgenau.
      </p>
      {error && <p className="field-error">{error}</p>}
      {notice && (
        <p className="list-item-meta" data-testid="units-notice">
          {notice}
        </p>
      )}

      <div
        className="job-card"
        style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginBottom: 16 }}
      >
        <strong style={{ flexBasis: '100%' }}>Standard der Firma</strong>
        <label className="field">
          <span>Genauigkeit</span>
          <select
            value={data.company.quantityDecimals}
            disabled={!canWrite}
            onChange={(e) => saveCompany(Number(e.target.value), data.company.quantityRounding)}
            data-testid="units-company-decimals"
          >
            {[0, 1, 2, 3].map((d) => (
              <option key={d} value={d}>
                {DECIMALS_LABELS[d]}
              </option>
            ))}
          </select>
        </label>
        <label className="field">
          <span>Art</span>
          <select
            value={data.company.quantityRounding}
            disabled={!canWrite}
            onChange={(e) => saveCompany(data.company.quantityDecimals, e.target.value as RoundingMode)}
            data-testid="units-company-mode"
          >
            {(Object.keys(MODE_LABELS) as RoundingMode[]).map((m) => (
              <option key={m} value={m}>
                {MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {data.units.map((u) => {
        const own = roundingText({ decimals: u.decimals, mode: u.rounding, step: u.step });
        const standard = roundingText({ decimals: u.defaultDecimals, mode: u.defaultRounding });
        const e = edit[u.code];
        return (
          <div key={u.code} className="list-item" data-testid="unit-row" data-code={u.code}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="list-item-name">
                {u.code} · {u.label}
              </div>
              <div className="list-item-meta">
                {u.custom ? 'eigene Einheit' : (DIMENSIONS[u.dimension ?? ''] ?? '')} · Rundung:{' '}
                {own ? <strong>{own} (angepasst)</strong> : (standard ?? 'Standard der Firma')}
              </div>
            </div>
            {canWrite && !e && (
              <div style={{ display: 'flex', gap: 6 }}>
                <button
                  className="btn"
                  onClick={() =>
                    setEdit({
                      [u.code]: {
                        decimals: u.step != null ? 'step' : u.decimals != null ? String(u.decimals) : '',
                        rounding: u.rounding ?? '',
                        step: u.step != null ? String(Number(u.step)).replace('.', ',') : '',
                      },
                    })
                  }
                  data-testid="unit-edit"
                >
                  Anpassen
                </button>
                {(own || u.custom) && (
                  <button
                    className="btn"
                    onClick={() =>
                      run(
                        () => api.delete(`/units/${encodeURIComponent(u.code)}`),
                        u.custom ? 'Einheit entfernt.' : 'Zurückgesetzt.',
                      )
                    }
                    data-testid="unit-reset"
                  >
                    {u.custom ? 'Entfernen' : 'Zurücksetzen'}
                  </button>
                )}
              </div>
            )}
            {canWrite && e && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                <select
                  value={e.decimals}
                  onChange={(ev) => setEdit({ [u.code]: { ...e, decimals: ev.target.value } })}
                  data-testid="unit-decimals"
                >
                  <option value="">{standard ? `Katalog (${standard})` : 'Standard der Firma'}</option>
                  {[0, 1, 2, 3].map((d) => (
                    <option key={d} value={d}>
                      {DECIMALS_LABELS[d]}
                    </option>
                  ))}
                  <option value="step">Schritt …</option>
                </select>
                {e.decimals === 'step' && (
                  <input
                    value={e.step}
                    onChange={(ev) => setEdit({ [u.code]: { ...e, step: ev.target.value } })}
                    placeholder="z.B. 0,5"
                    inputMode="decimal"
                    style={{ width: 80 }}
                  />
                )}
                <select
                  value={e.rounding}
                  onChange={(ev) => setEdit({ [u.code]: { ...e, rounding: ev.target.value } })}
                  data-testid="unit-mode"
                >
                  <option value="">Art: Standard</option>
                  {(Object.keys(MODE_LABELS) as RoundingMode[]).map((m) => (
                    <option key={m} value={m}>
                      {MODE_LABELS[m]}
                    </option>
                  ))}
                </select>
                <button className="btn btn-primary" onClick={() => saveUnit(u)} data-testid="unit-save">
                  Speichern
                </button>
                <button className="btn" onClick={() => setEdit({})}>
                  Abbrechen
                </button>
              </div>
            )}
          </div>
        );
      })}

      {canWrite && (
        <form
          onSubmit={addCustom}
          style={{ display: 'flex', gap: 8, alignItems: 'flex-end', flexWrap: 'wrap', marginTop: 16 }}
        >
          <label className="field">
            <span>Eigene Einheit (Kürzel)</span>
            <input
              value={custom.code}
              onChange={(e) => setCustom({ ...custom, code: e.target.value })}
              maxLength={20}
              placeholder="z.B. Rolle"
              data-testid="unit-new-code"
            />
          </label>
          <label className="field">
            <span>Bezeichnung</span>
            <input
              value={custom.label}
              onChange={(e) => setCustom({ ...custom, label: e.target.value })}
              maxLength={40}
              placeholder="z.B. Rolle Vlies (50 m²)"
              data-testid="unit-new-label"
            />
          </label>
          <button type="submit" className="btn" data-testid="unit-new-submit">
            Einheit anlegen
          </button>
        </form>
      )}
    </div>
  );
}
