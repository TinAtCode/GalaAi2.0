import { useEffect, useState } from 'react';
import { ApiError } from '../api/client';
import { disablePush, enablePush, PushState, pushState } from './push';

const HINTS: Partial<Record<PushState, string>> = {
  unsupported: 'Benachrichtigungen gehen nur über HTTPS in der installierten App.',
  'needs-install': 'Auf dem iPhone: erst „Zum Home-Bildschirm“, dann hier einschalten.',
  denied: 'Benachrichtigungen sind im Browser blockiert – in den Einstellungen des Browsers erlauben.',
};

// Schalter für Push-Nachrichten auf diesem Gerät (neue Termine, Nachrichten)
export function PushToggle() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void pushState().then(setState);
  }, []);

  if (!state) return null;
  const toggle = async () => {
    setBusy(true);
    setError(null);
    try {
      if (state === 'on') {
        await disablePush();
        setState('off');
      } else {
        setState(await enablePush());
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Benachrichtigungen ließen sich nicht einschalten.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="push-toggle" data-testid="push-toggle" data-state={state}>
      {state === 'on' || state === 'off' ? (
        <button className="btn btn-sm" onClick={toggle} disabled={busy} aria-pressed={state === 'on'}>
          {state === 'on' ? '🔔 Benachrichtigungen an' : '🔕 Benachrichtigungen einschalten'}
        </button>
      ) : (
        <span className="list-item-meta">{HINTS[state]}</span>
      )}
      {error && <span className="field-error">{error}</span>}
    </div>
  );
}
