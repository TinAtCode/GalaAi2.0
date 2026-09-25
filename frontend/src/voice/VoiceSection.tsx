import { useState } from 'react';
import { ALIASES } from './commands';
import { setVoiceEnabled, speechRecognition, voiceEnabled } from './voice-settings';

// Einstellungen: Sprachbefehle ein-/ausschalten, mit Hinweis zum Datenschutz
export function VoiceSection() {
  const [on, setOn] = useState(voiceEnabled);
  const supported = !!speechRecognition();
  const toggle = (next: boolean) => {
    setVoiceEnabled(next);
    setOn(next);
  };
  return (
    <section className="settings-section" data-testid="voice-settings">
      <h3>Sprachbefehle</h3>
      <p>
        Mit dem Mikrofon-Knopf im Menü Bereiche öffnen oder suchen, z.B. „Öffne Plantafel“, „Zeig die
        Fahrzeuge“, „Suche Müller“, „Projekt P 2026 12“, „Zurück“. Die App ordnet die Wörter festen Befehlen
        zu – ohne KI.
      </p>
      <p className="list-item-meta">
        Datenschutz: Die Umwandlung von Sprache in Text macht der Browser. Chrome und Edge schicken die
        Aufnahme dafür an Server von Google bzw. Microsoft; Safari (iPhone, Mac) erkennt je nach Gerät auf dem
        Gerät selbst. Die Einstellung gilt nur für dieses Gerät und ist standardmäßig aus.
      </p>
      {supported ? (
        <label style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <input
            type="checkbox"
            checked={on}
            onChange={(e) => toggle(e.target.checked)}
            data-testid="voice-toggle"
          />
          Sprachbefehle auf diesem Gerät nutzen
        </label>
      ) : (
        <p className="list-item-meta">Dieser Browser unterstützt keine Spracherkennung (z.B. Firefox).</p>
      )}
      <details style={{ marginTop: 8 }}>
        <summary>Alle Wörter</summary>
        <ul className="list-item-meta">
          {Object.entries(ALIASES).map(([to, words]) => (
            <li key={to}>
              {to}: {words.join(', ')}
            </li>
          ))}
        </ul>
      </details>
    </section>
  );
}
