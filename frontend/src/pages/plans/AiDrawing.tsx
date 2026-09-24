import { FormEvent, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../../api/client';
import { PlanObject } from './catalog';

interface DrawingResult {
  objects: PlanObject[];
  dropped: number;
  image: { mediaType: string; data: string } | null;
  note: string | null;
  providerName: string;
}

const EXAMPLES = [
  'Terrasse 5 × 4 m links oben, daneben Rasen mit Mähkante',
  'Zaun entlang der Oberkante mit Tor in der Mitte',
  'Drei Bäume in einer Reihe am rechten Rand',
];

// Zeichnungs-KI: Auftrag in Worten, Vorschlag landet im Plan (rückgängig machbar).
// Liefert ein eigener Agent auch ein Bild, lässt es sich als Hintergrund übernehmen.
export function AiDrawing({
  planId,
  objects,
  unitsPerMeter,
  canUseBackground,
  onDraw,
  onBackground,
  onClose,
}: {
  planId: string;
  objects: PlanObject[];
  unitsPerMeter: number;
  canUseBackground: boolean;
  onDraw: (objects: PlanObject[], dropped: number, providerName: string) => void;
  onBackground: (file: File) => void;
  onClose: () => void;
}) {
  const [instruction, setInstruction] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<DrawingResult | null>(null);

  const imageFile = useMemo(() => {
    if (!result?.image) return null;
    const bytes = Uint8Array.from(atob(result.image.data), (c) => c.charCodeAt(0));
    const extension = result.image.mediaType === 'image/png' ? 'png' : 'jpg';
    return new File([bytes], `ki-skizze.${extension}`, { type: result.image.mediaType });
  }, [result]);
  const imageUrl = useMemo(() => (imageFile ? URL.createObjectURL(imageFile) : null), [imageFile]);
  useEffect(() => () => void (imageUrl && URL.revokeObjectURL(imageUrl)), [imageUrl]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const r = await api.post<DrawingResult>(`/ai/assist/plans/${planId}/drawing`, {
        instruction,
        objects,
        unitsPerMeter,
      });
      setResult(r);
      if (r.objects.length) onDraw(r.objects, r.dropped, r.providerName);
      else if (!r.image) setError(r.note ?? 'Die KI hat nichts gezeichnet.');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Die KI konnte nicht zeichnen.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form className="job-card" style={{ display: 'block' }} onSubmit={submit} data-testid="plan-ai">
      <strong>KI zeichnen</strong>
      <p className="list-item-meta">
        Beschreiben Sie, was gezeichnet werden soll – mit Maßen in Metern. Der Vorschlag kommt in den Plan und
        lässt sich rückgängig machen; gespeichert wird erst mit „Speichern“.
      </p>
      <label className="field">
        <span>Auftrag</span>
        <textarea
          value={instruction}
          onChange={(e) => setInstruction(e.target.value)}
          rows={3}
          maxLength={2000}
          placeholder={EXAMPLES[0]}
          data-testid="plan-ai-instruction"
        />
      </label>
      {error && <p className="field-error">{error}</p>}
      {result?.note && result.objects.length > 0 && <p className="list-item-meta">{result.note}</p>}
      {imageUrl && imageFile && (
        <div style={{ marginTop: 8 }}>
          <img src={imageUrl} alt="Skizze der KI" style={{ maxWidth: '100%', borderRadius: 6 }} />
          <button
            type="button"
            className="btn btn-sm"
            disabled={!canUseBackground}
            title={canUseBackground ? undefined : 'Bitte zuerst speichern'}
            onClick={() => onBackground(imageFile)}
            data-testid="plan-ai-background"
          >
            Als Hintergrund übernehmen
          </button>
        </div>
      )}
      <div className="btn-row" style={{ marginTop: 8 }}>
        <button
          type="submit"
          className="btn btn-primary btn-sm"
          disabled={busy || instruction.trim().length < 3}
          data-testid="plan-ai-submit"
        >
          {busy ? 'KI zeichnet …' : 'Zeichnen'}
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
          Schließen
        </button>
      </div>
    </form>
  );
}
