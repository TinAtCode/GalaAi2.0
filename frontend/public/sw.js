// Service Worker: App ohne Netz starten (Seite, Skripte, Schriften aus dem
// Cache). Daten vom Server (/api) gehen nie über diesen Cache – die Lagepläne
// hält die App selbst im Offline-Speicher (src/offline).
const CACHE = 'gartenai-app-v1';
const MAX_ASSETS = 80;

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(['/', '/manifest.webmanifest', '/icon.svg']))
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

// ältere Dateien (neue Version = neue Namen) nicht endlos sammeln
async function trim(cache) {
  const keys = await cache.keys();
  const assets = keys.filter((request) => new URL(request.url).pathname.startsWith('/assets/'));
  for (const request of assets.slice(0, Math.max(0, assets.length - MAX_ASSETS))) await cache.delete(request);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  const url = new URL(request.url);
  if (request.method !== 'GET' || url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

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
        .catch(() => caches.match('/')),
    );
    return;
  }

  // Dateien mit Hash im Namen ändern sich nie: aus dem Cache, sonst laden und merken
  event.respondWith(
    caches.match(request).then(
      (cached) =>
        cached ||
        fetch(request).then((response) => {
          if (response.ok && (url.pathname.startsWith('/assets/') || url.pathname === '/icon.svg')) {
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
