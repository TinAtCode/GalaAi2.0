import { useState } from 'react';
import { DECIMALS_LABELS, MODE_LABELS, Rounding, RoundingMode, roundingText } from '../rounding';

// Eigene Rundung für Leistung oder Artikel; "Standard" = aus Einheit bzw. Firma.
export function RoundingEditor({
  value,
  onSave,
  testId,
}: {
  value: Rounding;
  onSave: (rounding: Required<Rounding>) => Promise<void>;
  testId: string;
}) {
  const [editing, setEditing] = useState(false);
  const [precision, setPrecision] = useState('');
  const [mode, setMode] = useState('');
  const [step, setStep] = useState('');
  const [busy, setBusy] = useState(false);

  const current = roundingText({
    decimals: value.quantityDecimals,
    mode: value.quantityRounding,
    step: value.quantityStep,
  });

  const start = () => {
    setPrecision(
      value.quantityStep != null
        ? 'step'
        : value.quantityDecimals != null
          ? String(value.quantityDecimals)
          : '',
    );
    setMode(value.quantityRounding ?? '');
    setStep(value.quantityStep != null ? String(Number(value.quantityStep)).replace('.', ',') : '');
    setEditing(true);
  };

  const save = async () => {
    setBusy(true);
    try {
      await onSave({
        quantityDecimals: precision !== '' && precision !== 'step' ? Number(precision) : null,
        quantityRounding: (mode || null) as RoundingMode | null,
        quantityStep: precision === 'step' && step.trim() ? Number(step.replace(',', '.')) : null,
      });
      setEditing(false);
    } catch {
      // Fehlermeldung zeigt die Seite; das Formular bleibt offen
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button className="btn" onClick={start} data-testid={`${testId}-rounding`} title="Rundung der Mengen">
        Rundung: {current ?? 'Standard'}
      </button>
    );
  }
  return (
    <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
      <select
        value={precision}
        onChange={(e) => setPrecision(e.target.value)}
        data-testid={`${testId}-rounding-precision`}
      >
        <option value="">Standard (aus Einheit/Firma)</option>
        {[0, 1, 2, 3].map((d) => (
          <option key={d} value={d}>
            {DECIMALS_LABELS[d]}
          </option>
        ))}
        <option value="step">Schritt …</option>
      </select>
      {precision === 'step' && (
        <input
          value={step}
          onChange={(e) => setStep(e.target.value)}
          placeholder="z.B. 0,5"
          inputMode="decimal"
          style={{ width: 80 }}
          data-testid={`${testId}-rounding-step`}
        />
      )}
      <select value={mode} onChange={(e) => setMode(e.target.value)} data-testid={`${testId}-rounding-mode`}>
        <option value="">Art: Standard</option>
        {(Object.keys(MODE_LABELS) as RoundingMode[]).map((m) => (
          <option key={m} value={m}>
            {MODE_LABELS[m]}
          </option>
        ))}
      </select>
      <button
        className="btn btn-primary"
        disabled={busy}
        onClick={save}
        data-testid={`${testId}-rounding-save`}
      >
        Speichern
      </button>
      <button className="btn" onClick={() => setEditing(false)}>
        Abbrechen
      </button>
    </div>
  );
}
