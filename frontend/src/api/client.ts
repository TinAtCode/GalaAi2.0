const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

// Die Anmeldung steckt in einem httpOnly-Cookie, das der Browser selbst
// mitschickt (credentials: 'include'); JavaScript sieht das Token nie.
// X-Requested-With ist der CSRF-Schutz des Backends (auth/session-cookie.ts).
const DEFAULTS: RequestInit = { credentials: 'include' };
const CSRF_HEADER = { 'X-Requested-With': 'fetch' };

// Wird vom AuthProvider gesetzt: bei 401 ist die Sitzung abgelaufen oder
// ungültig – dann abmelden statt überall Fehlermeldungen anzuzeigen.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
}

// Zählt An- und Abmeldungen. Eine 401-Antwort auf eine Anfrage, die noch
// vor der aktuellen Anmeldung losgeschickt wurde (z.B. die Sitzungsprüfung
// beim Start), darf die neue Sitzung nicht beenden.
let sessionGeneration = 0;
export function startNewSessionGeneration() {
  sessionGeneration++;
}
function reportUnauthorized(generation: number) {
  if (generation === sessionGeneration) onUnauthorized?.();
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

// Ein Wrapper statt eines großen Frameworks – jedes Modul (Kunden, Termine,
// ...) im Backend hat schon seine eigene, konsistente REST-Form, dafür
// braucht es keinen generierten Client.
async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  return (await requestWithHeaders<T>(path, options)).data;
}

async function requestWithHeaders<T>(
  path: string,
  options: RequestInit = {},
): Promise<{ data: T; headers: Headers }> {
  const generation = sessionGeneration;
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...DEFAULTS,
    ...options,
    // Bei FormData (Datei-Upload) setzt der Browser Content-Type samt Boundary
    headers: {
      ...(options.body instanceof FormData ? {} : { 'Content-Type': 'application/json' }),
      ...CSRF_HEADER,
      ...options.headers,
    },
  });

  // Ein falsches Passwort beim Login ist keine abgelaufene Sitzung.
  if (response.status === 401 && !path.startsWith('/auth/login')) {
    reportUnauthorized(generation);
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body.message ?? `Anfrage fehlgeschlagen (${response.status}).`);
  }

  if (response.status === 204) return { data: undefined as T, headers: response.headers };
  return { data: (await response.json()) as T, headers: response.headers };
}

// Dateien (PDF, XML) per fetch laden und als Blob öffnen – so kommen auch
// Fehlermeldungen (z.B. fehlende Firmendaten) im Frontend an.
async function fetchFile(path: string): Promise<Blob> {
  const generation = sessionGeneration;
  const response = await fetch(`${API_BASE_URL}${path}`, { ...DEFAULTS, headers: CSRF_HEADER });
  if (response.status === 401) reportUnauthorized(generation);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(
      response.status,
      body.message ?? `Datei konnte nicht geladen werden (${response.status}).`,
    );
  }
  return response.blob();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  // Für seitenweise geladene Listen: Einträge plus Gesamtzahl aus X-Total-Count.
  getPage: async <T>(path: string, take: number, skip: number) => {
    const separator = path.includes('?') ? '&' : '?';
    const { data, headers } = await requestWithHeaders<T[]>(`${path}${separator}take=${take}&skip=${skip}`);
    const total = Number(headers.get('X-Total-Count'));
    return { items: data, total: Number.isFinite(total) ? total : data.length };
  },
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PUT', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
  // Datei hochladen (multipart, Feld "file")
  upload: <T>(path: string, file: File) => {
    const body = new FormData();
    body.append('file', file);
    return request<T>(path, { method: 'POST', body });
  },
  // Datei als Blob (z.B. Hintergrundbild eines Plans)
  blob: (path: string) => fetchFile(path),
  // PDF in einem neuen Tab öffnen
  openFile: async (path: string) => {
    const url = URL.createObjectURL(await fetchFile(path));
    window.open(url, '_blank', 'noopener');
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },

  // Datei herunterladen (z.B. E-Rechnung als XML)
  downloadFile: async (path: string, fileName: string) => {
    const url = URL.createObjectURL(await fetchFile(path));
    const link = document.createElement('a');
    link.href = url;
    link.download = fileName;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  },
};
