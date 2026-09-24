// Kleiner Speicher im Browser (IndexedDB) für das Arbeiten ohne Netz:
// - plans: zuletzt geöffnete Lagepläne (Stand vom Server) samt Hintergrundbild
// - outbox: offline gespeicherte Änderungen, die noch zum Server müssen
// Ohne IndexedDB (z. B. manche private Fenster) geht offline nichts – online
// arbeitet die App dann wie bisher.

const DB_NAME = 'gartenai-offline';
const VERSION = 1;

export interface CachedPlan {
  id: string;
  projectId: string;
  name: string;
  plan: unknown; // Antwort von GET /plans/:id
  background?: Blob;
  backgroundId?: string;
  cachedAt: number;
}

export interface OutboxEntry {
  planId: string;
  projectId: string;
  name: string;
  baseVersion: number; // Stand, auf dem die Änderung beruht
  unitsPerMeter: number;
  objects: unknown[];
  queuedAt: number;
  // der Server hat inzwischen einen neueren Stand (409) – der Nutzer entscheidet
  conflict?: boolean;
}

let opening: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (opening) return opening;
  opening = new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') return reject(new Error('Kein Offline-Speicher verfügbar.'));
    const request = indexedDB.open(DB_NAME, VERSION);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('plans')) db.createObjectStore('plans', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'planId' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
  opening.catch(() => (opening = null));
  return opening;
}

function run<T>(
  store: 'plans' | 'outbox',
  mode: IDBTransactionMode,
  action: (s: IDBObjectStore) => IDBRequest<T>,
) {
  return open().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const request = action(tx.objectStore(store));
        tx.oncomplete = () => resolve(request.result);
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error);
      }),
  );
}

export const offlineDb = {
  getPlan: (id: string) => run<CachedPlan | undefined>('plans', 'readonly', (s) => s.get(id)),
  putPlan: (plan: CachedPlan) => run('plans', 'readwrite', (s) => s.put(plan)),
  deletePlan: (id: string) => run('plans', 'readwrite', (s) => s.delete(id)),
  allPlans: () => run<CachedPlan[]>('plans', 'readonly', (s) => s.getAll()),
  getOutbox: (planId: string) => run<OutboxEntry | undefined>('outbox', 'readonly', (s) => s.get(planId)),
  putOutbox: (entry: OutboxEntry) => run('outbox', 'readwrite', (s) => s.put(entry)),
  deleteOutbox: (planId: string) => run('outbox', 'readwrite', (s) => s.delete(planId)),
  allOutbox: () => run<OutboxEntry[]>('outbox', 'readonly', (s) => s.getAll()),
  // beim Abmelden: nichts von dieser Sitzung im Browser lassen
  clear: () =>
    Promise.all([run('plans', 'readwrite', (s) => s.clear()), run('outbox', 'readwrite', (s) => s.clear())]),
};
