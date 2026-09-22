import { FormEvent, useState } from 'react';

export interface InlineEditField {
  key: string;
  label: string;
  type?: 'text' | 'number' | 'email';
}

interface InlineEditProps {
  fields: InlineEditField[];
  initial: object;
  onSave: (values: Record<string, string | number>) => Promise<void>;
  testId: string;
}

// "Bearbeiten" für einen Listeneintrag: klappt ein kleines Formular auf und
// schickt nur die geänderten Felder. Zahlenfelder werden als Zahl gesendet.
export function InlineEdit({ fields, initial: initialObject, onSave, testId }: InlineEditProps) {
  const initial = initialObject as Record<string, unknown>;
  const [editing, setEditing] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);

  const start = () => {
    setValues(
      Object.fromEntries(fields.map((f) => [f.key, initial[f.key] == null ? '' : String(initial[f.key])])),
    );
    setEditing(true);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const changed: Record<string, string | number> = {};
    for (const field of fields) {
      const raw = values[field.key].trim();
      const before = initial[field.key] == null ? '' : String(initial[field.key]);
      if (raw === '' || raw === before) continue;
      changed[field.key] = field.type === 'number' ? Number(raw.replace(',', '.')) : raw;
    }
    setBusy(true);
    try {
      if (Object.keys(changed).length > 0) await onSave(changed);
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <button className="btn" onClick={start} data-testid={`${testId}-edit`}>
        Bearbeiten
      </button>
    );
  }

  return (
    <form onSubmit={submit} className="form-row" style={{ width: '100%', marginTop: 8 }}>
      {fields.map((field) => (
        <input
          key={field.key}
          aria-label={field.label}
          placeholder={field.label}
          type={field.type === 'number' ? 'text' : (field.type ?? 'text')}
          inputMode={field.type === 'number' ? 'decimal' : undefined}
          value={values[field.key] ?? ''}
          onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
          data-testid={`${testId}-${field.key}`}
        />
      ))}
      <button type="submit" className="btn btn-primary" disabled={busy} data-testid={`${testId}-save`}>
        Speichern
      </button>
      <button type="button" className="btn" onClick={() => setEditing(false)}>
        Abbrechen
      </button>
    </form>
  );
}
