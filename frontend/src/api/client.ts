const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000';

// Wird vom AuthProvider gesetzt: bei 401 auf eine Anfrage MIT Token ist die
// Sitzung abgelaufen oder ungültig – dann abmelden statt überall
// Fehlermeldungen anzuzeigen.
let onUnauthorized: (() => void) | null = null;
export function setUnauthorizedHandler(handler: (() => void) | null) {
  onUnauthorized = handler;
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
  const token = localStorage.getItem('gartenai.token');

  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...options.headers,
    },
  });

  if (response.status === 401 && token) {
    onUnauthorized?.();
  }

  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new ApiError(response.status, body.message ?? `Anfrage fehlgeschlagen (${response.status}).`);
  }

  if (response.status === 204) return { data: undefined as T, headers: response.headers };
  return { data: (await response.json()) as T, headers: response.headers };
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
  patch: <T>(path: string, body?: unknown) =>
    request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
