import { useEffect, useState, useSyncExternalStore } from 'react';
import { api, ApiError } from '../api/client';
import { offlineDb, OutboxEntry, SiteOutboxEntry } from './db';

// Offline gespeicherte Lagepläne zum Server übertragen – beim Start, sobald
// das Netz wieder da ist und alle 60 Sekunden, solange etwas wartet.
// Hat jemand den Plan inzwischen geändert (409), wird nichts überschrieben:
// die Änderung bleibt als Konflikt stehen, bis der Nutzer entscheidet.

type Listener = () => void;
const listeners = new Set<Listener>();
let running: Promise<void> | null = null;

export const notifyOfflineChange = () => listeners.forEach((l) => l());

export function subscribeOffline(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Netz im Browser (ob der Server erreichbar ist, zeigt erst eine Anfrage)
export function useOnline() {
  return useSyncExternalStore(
    (onChange) => {
      window.addEventListener('online', onChange);
      window.addEventListener('offline', onChange);
      return () => {
        window.removeEventListener('online', onChange);
        window.removeEventListener('offline', onChange);
      };
    },
    () => navigator.onLine,
  );
}

// Netzfehler (kein Server erreichbar) im Unterschied zu einer Antwort des Servers
export const isNetworkError = (err: unknown) => !(err instanceof ApiError);

async function syncEntry(entry: OutboxEntry) {
  try {
    const saved = await api.put<{ version: number }>(`/plans/${entry.planId}`, {
      version: entry.baseVersion,
      name: entry.name,
      unitsPerMeter: entry.unitsPerMeter,
      objects: entry.objects,
    });
    await offlineDb.deleteOutbox(entry.planId);
    const cached = await offlineDb.getPlan(entry.planId);
    if (cached) await offlineDb.putPlan({ ...cached, plan: saved, name: entry.name, cachedAt: Date.now() });
    return 'saved' as const;
  } catch (err) {
    if (isNetworkError(err)) return 'offline' as const;
    if (err instanceof ApiError && err.status === 409) {
      await offlineDb.putOutbox({ ...entry, conflict: true });
      return 'conflict' as const;
    }
    // Plan gelöscht oder keine Rechte mehr: die Änderung lässt sich nicht übertragen
    if (err instanceof ApiError && (err.status === 404 || err.status === 403)) {
      await offlineDb.putOutbox({ ...entry, conflict: true });
      return 'conflict' as const;
    }
    throw err;
  }
}

// Nachricht oder Foto von der Baustelle übertragen; clientId schützt vor Doppelten
async function syncSiteEntry(entry: SiteOutboxEntry) {
  try {
    if (entry.kind === 'photo') {
      const form = new FormData();
      form.append('file', entry.photo!, entry.fileName ?? 'foto.jpg');
      form.append('clientId', entry.clientId);
      if (entry.text) form.append('caption', entry.text);
      await api.postForm(`/site/projects/${entry.projectId}/photos`, form);
    } else {
      await api.post(`/site/projects/${entry.projectId}/messages`, {
        text: entry.text,
        clientId: entry.clientId,
      });
    }
    await offlineDb.deleteSite(entry.clientId);
    return 'saved' as const;
  } catch (err) {
    if (isNetworkError(err)) return 'offline' as const;
    if (err instanceof ApiError && err.status >= 400 && err.status < 500 && err.status !== 401) {
      await offlineDb.putSite({ ...entry, error: err.message });
      return 'rejected' as const;
    }
    throw err;
  }
}

export function flushOutbox(): Promise<void> {
  if (running) return running;
  running = (async () => {
    try {
      const entries = (await offlineDb.allOutbox()).filter((e) => !e.conflict);
      for (const entry of entries) {
        if ((await syncEntry(entry)) === 'offline') return;
      }
      const site = (await offlineDb.allSite())
        .filter((e) => !e.error)
        .sort((a, b) => a.queuedAt - b.queuedAt);
      for (const entry of site) {
        if ((await syncSiteEntry(entry)) === 'offline') return;
      }
    } catch {
      // Speicher nicht verfügbar oder unerwartete Antwort: beim nächsten Mal wieder
    } finally {
      running = null;
      notifyOfflineChange();
    }
  })();
  return running;
}

// Konflikt lösen: eigene Version auf den aktuellen Serverstand setzen …
export async function keepLocalVersion(planId: string) {
  const entry = await offlineDb.getOutbox(planId);
  if (!entry) return;
  const current = await api.get<{ version: number }>(`/plans/${planId}`);
  await offlineDb.putOutbox({ ...entry, baseVersion: current.version, conflict: false });
  await flushOutbox();
}

// … oder verwerfen und den Serverstand behalten
export async function discardLocalVersion(planId: string) {
  await offlineDb.deleteOutbox(planId);
  notifyOfflineChange();
}

// Warteschlange und Konflikte für die Anzeige
export function useOutbox() {
  const [entries, setEntries] = useState<OutboxEntry[]>([]);
  useEffect(() => {
    let current = true;
    const load = () =>
      offlineDb
        .allOutbox()
        .then((list) => current && setEntries(list))
        .catch(() => current && setEntries([]));
    load();
    const unsubscribe = subscribeOffline(load);
    return () => {
      current = false;
      unsubscribe();
    };
  }, []);
  return entries;
}

// Wartende Nachrichten und Fotos von der Baustelle
export function useSiteOutbox() {
  const [entries, setEntries] = useState<SiteOutboxEntry[]>([]);
  useEffect(() => {
    let current = true;
    const load = () =>
      offlineDb
        .allSite()
        .then((list) => current && setEntries(list.sort((a, b) => a.queuedAt - b.queuedAt)))
        .catch(() => current && setEntries([]));
    load();
    const unsubscribe = subscribeOffline(load);
    return () => {
      current = false;
      unsubscribe();
    };
  }, []);
  return entries;
}

// In die Warteschlange und – wenn Netz da ist – gleich übertragen
export async function queueSiteEntry(entry: Omit<SiteOutboxEntry, 'clientId' | 'queuedAt'>) {
  const clientId = crypto.randomUUID();
  await offlineDb.putSite({ ...entry, clientId, queuedAt: Date.now() });
  notifyOfflineChange();
  if (navigator.onLine) await flushOutbox();
  return clientId;
}

export async function discardSiteEntry(clientId: string) {
  await offlineDb.deleteSite(clientId);
  notifyOfflineChange();
}

// Einmal in der App: bei Netz und regelmäßig übertragen
export function startOfflineSync() {
  const tick = () => {
    if (navigator.onLine) void flushOutbox();
  };
  window.addEventListener('online', tick);
  const timer = window.setInterval(tick, 60_000);
  tick();
  return () => {
    window.removeEventListener('online', tick);
    window.clearInterval(timer);
  };
}
