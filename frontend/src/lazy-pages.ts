import { ComponentType, lazy } from 'react';

// Seiten nachladen statt alles beim Start: die App startet auf dem Handy
// schneller. Ohne Netz fehlt trotzdem nichts: der Service Worker speichert
// bei der Installation alle Dateien des Builds (Liste: vite.config.ts), und
// kurz nach dem Start lädt die App alle Seiten im Hintergrund – das hilft auch
// ohne Service Worker (z.B. per http im LAN, dort gibt es keinen).
const loaders: (() => Promise<unknown>)[] = [];
const RELOADED = 'gartenai.chunk-reload';

export function lazyPage<K extends string, M extends Record<K, ComponentType<object>>>(
  load: () => Promise<M>,
  name: K,
) {
  loaders.push(load);
  return lazy(async () => {
    try {
      const module = await load();
      sessionStorage.removeItem(RELOADED);
      return { default: module[name] };
    } catch (error) {
      // nach einem Update gibt es die alten Dateien nicht mehr: einmal neu laden
      if (navigator.onLine && !sessionStorage.getItem(RELOADED)) {
        sessionStorage.setItem(RELOADED, '1');
        window.location.reload();
        return new Promise<never>(() => undefined);
      }
      throw error;
    }
  });
}

let prefetched = false;
export function prefetchPages() {
  if (prefetched) return;
  prefetched = true;
  const later = window.requestIdleCallback ?? ((fn: () => void) => setTimeout(fn, 1500));
  later(() => {
    for (const load of loaders) void load().catch(() => undefined);
  });
}
