import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { parseCommand, VoiceTarget } from './commands';
import { speechRecognition, VOICE_EVENT, voiceEnabled } from './voice-settings';

// Mikrofon-Knopf: gesprochener Befehl → Bereich öffnen, suchen oder zurück.
// Nur sichtbar, wenn in den Einstellungen eingeschaltet und vom Browser unterstützt.
export function VoiceButton({
  targets,
  onSearch,
}: {
  targets: VoiceTarget[];
  onSearch: (query: string) => void;
}) {
  const navigate = useNavigate();
  const [enabled, setEnabled] = useState(voiceEnabled);
  const [listening, setListening] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const recognition = useRef<{ stop: () => void } | null>(null);
  const Recognition = speechRecognition();

  useEffect(() => {
    const update = () => setEnabled(voiceEnabled());
    window.addEventListener(VOICE_EVENT, update);
    return () => window.removeEventListener(VOICE_EVENT, update);
  }, []);

  useEffect(() => {
    if (!feedback) return;
    const timer = window.setTimeout(() => setFeedback(null), 4000);
    return () => window.clearTimeout(timer);
  }, [feedback]);

  if (!enabled || !Recognition) return null;

  const run = (text: string) => {
    const command = parseCommand(text, targets);
    if (command.kind === 'navigate') {
      setFeedback(`„${text}“ → ${command.label}`);
      navigate(command.to);
    } else if (command.kind === 'search') {
      setFeedback(`„${text}“ → Suche`);
      onSearch(command.query);
    } else if (command.kind === 'back') {
      navigate(-1);
    } else setFeedback(`„${text}“ – kein Befehl erkannt`);
  };

  const listen = () => {
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const r = new Recognition();
    r.lang = 'de-DE';
    r.interimResults = false;
    r.maxAlternatives = 1;
    r.onresult = (event) => run(event.results[0][0].transcript);
    r.onerror = (event) =>
      setFeedback(
        event.error === 'not-allowed' ? 'Mikrofon nicht erlaubt' : 'Nicht verstanden – bitte noch einmal',
      );
    r.onend = () => setListening(false);
    recognition.current = r;
    setListening(true);
    r.start();
  };

  return (
    <>
      <button
        type="button"
        className={`voice-button${listening ? ' is-listening' : ''}`}
        onClick={listen}
        aria-label={listening ? 'Zuhören beenden' : 'Sprachbefehl'}
        title="Sprachbefehl, z.B. „Öffne Plantafel“, „Suche Müller“"
        data-testid="voice-button"
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          aria-hidden="true"
        >
          <path d="M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3ZM5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      </button>
      {feedback && (
        <div className="voice-feedback" role="status" data-testid="voice-feedback">
          {feedback}
        </div>
      )}
    </>
  );
}
