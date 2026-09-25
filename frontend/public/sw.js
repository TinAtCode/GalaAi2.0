// Service Worker: App ohne Netz starten (Seite, Skripte, Schriften aus dem
// Cache). Daten vom Server (/api) gehen nie über diesen Cache – die Lagepläne
// hält die App selbst im Offline-Speicher (src/offline).
// Beim Build eingetragen (vite.config.ts): alle Dateien der Version und ihr Kennzeichen
const PRECACHE = [];
const BUILD = 'dev';
const CACHE = `gartenai-app-${BUILD}`;
const MAX_ASSETS = 80;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(['/', '/manifest.webmanifest', '/icon.svg', '/gala-icon.svg', ...PRECACHE]),
      )
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  );
});

// nachträglich geladene Dateien nicht endlos sammeln (die der Version bleiben)
async function trim(cache) {
  const keys = await cache.keys();
  const assets = keys.filter((request) => {
    const path = new URL(request.url).pathname;
    return path.startsWith('/assets/') && !PRECACHE.includes(path);
  });
  for (const request of assets.slice(0, Math.max(0, assets.length - MAX_ASSETS))) await cache.delete(request);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/'))
    return;

  // Seitenaufruf: zuerst Netz (neueste Version), ohne Netz die gespeicherte App
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE).then((cache) => cache.put('/', copy));
          }
          return response;
        })
        .catch(() => caches.match('/', { ignoreVary: true })),
    );
    return;
  }

  // Dateien mit Hash im Namen ändern sich nie: aus dem Cache, sonst laden und merken.
  // ignoreVary: Module-Skripte senden „Origin“, die vorab gespeicherte Antwort
  // (ohne) würde bei „Vary: Origin“ sonst nicht passen
  event.respondWith(
    caches.match(request, { ignoreVary: true }).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && (url.pathname.startsWith('/assets/') || url.pathname.endsWith('icon.svg'))) {
            const copy = response.clone();
            caches.open(CACHE).then(async (cache) => {
              await cache.put(request, copy);
              await trim(cache);
            });
          }
          return response;
        }),
    ),
  );
});

// Push-Nachrichten (neue Termine, Nachrichten von der Baustelle)
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : '' };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'GartenAI', {
      body: data.body || '',
      tag: data.tag,
      icon: '/gala-icon.svg',
      badge: '/gala-icon.svg',
      data: { url: data.url || '/' },
    }),
  );
});

// Antippen: vorhandenes Fenster der App nach vorn holen, sonst neu öffnen
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => new URL(w.url).origin === self.location.origin);
      if (open) return open.focus().then((w) => w.navigate(target));
      return self.clients.openWindow(target);
    }),
  );
});
