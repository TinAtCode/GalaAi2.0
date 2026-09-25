// Sprachbefehle sind eine Einstellung dieses Geräts (Browser), Standard: aus
const KEY = 'gartenai.voice';
export const VOICE_EVENT = 'gartenai-voice-changed';

export function voiceEnabled() {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false;
  }
}

export function setVoiceEnabled(on: boolean) {
  try {
    if (on) localStorage.setItem(KEY, '1');
    else localStorage.removeItem(KEY);
  } catch {
    // ohne Speicher gilt die Einstellung nur bis zum Neuladen
  }
  window.dispatchEvent(new Event(VOICE_EVENT));
}

// Spracherkennung des Browsers (Chrome/Edge/Safari); Firefox hat keine
type Recognition = {
  lang: string;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((event: { results: { 0: { transcript: string } }[] }) => void) | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
};

export function speechRecognition(): (new () => Recognition) | null {
  const w = window as unknown as {
    SpeechRecognition?: new () => Recognition;
    webkitSpeechRecognition?: new () => Recognition;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}
