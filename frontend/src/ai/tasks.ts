import { useEffect, useState } from 'react';
import { api } from '../api/client';

// Welche KI-Aufgaben ein Anbieter übernehmen kann (Einstellungen → KI-Anbieter).
// Einmal je Sitzung geladen; Knöpfe wie „Vorschlag der KI“ erscheinen nur dann.
type Status = { tasks?: Record<string, boolean> };
let cached: Promise<Status> | null = null;

export function resetAiTasks() {
  cached = null;
}

export function useAiTask(task: string) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    cached ??= api.get<Status>('/ai/gateway/status').catch(() => {
      cached = null;
      return {};
    });
    void cached.then((s) => alive && setAvailable(Boolean(s.tasks?.[task])));
    return () => {
      alive = false;
    };
  }, [task]);
  return available;
}
