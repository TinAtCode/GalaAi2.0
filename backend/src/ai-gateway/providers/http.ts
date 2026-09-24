import { lookup } from 'dns/promises';
import { isIP } from 'net';
import { AiProviderError } from '../ai-provider.interface';

// Adresse eines KI-Anbieters prüfen. Selbst gehostete Modelle im eigenen Netz
// (Ollama auf 192.168.x.x, localhost) sind ausdrücklich erlaubt – gesperrt
// sind nur die Metadaten-Dienste der Cloud-Anbieter (169.254.x.x, fe80::),
// über die sich sonst Zugangsdaten des Servers abgreifen ließen. Mit
// AI_BLOCK_PRIVATE_NETWORKS=1 (z.B. bei Mehrmandanten-Betrieb) auch alle
// privaten Netze. Weiterleitungen folgt der Aufruf nie.
const METADATA_HOSTS = new Set(['metadata.google.internal', 'metadata']);

function blockedAddress(address: string, blockPrivate: boolean): boolean {
  const v4 = address.startsWith('::ffff:') ? address.slice(7) : address;
  if (isIP(v4) === 4) {
    const [a, b] = v4.split('.').map(Number);
    if (a === 169 && b === 254) return true;
    if (a === 0) return true;
    if (!blockPrivate) return false;
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    );
  }
  const v6 = address.toLowerCase();
  if (v6.startsWith('fe8') || v6.startsWith('fe9') || v6.startsWith('fea') || v6.startsWith('feb'))
    return true;
  if (v6 === '::') return true;
  if (!blockPrivate) return false;
  return v6 === '::1' || v6.startsWith('fc') || v6.startsWith('fd');
}

export async function assertProviderUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AiProviderError('Ungültige Adresse des KI-Anbieters.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AiProviderError('Die Adresse muss mit http:// oder https:// beginnen.');
  }
  if (url.username || url.password) {
    throw new AiProviderError('Zugangsdaten gehören ins Feld „API-Schlüssel“, nicht in die Adresse.');
  }
  const host = url.hostname.replace(/^\[|\]$/g, '');
  const blockPrivate = process.env.AI_BLOCK_PRIVATE_NETWORKS === '1';
  if (METADATA_HOSTS.has(host.toLowerCase())) throw new AiProviderError('Diese Adresse ist gesperrt.');
  let addresses: string[];
  try {
    addresses = isIP(host) ? [host] : (await lookup(host, { all: true })).map((a) => a.address);
  } catch {
    throw new AiProviderError(`Der Rechner „${host}“ ist nicht bekannt.`);
  }
  if (addresses.some((a) => blockedAddress(a, blockPrivate))) {
    throw new AiProviderError('Diese Adresse ist gesperrt (interne Dienste des Servers).');
  }
  return url;
}

// Antworten größer als 2 MB sind kein Text mehr, sondern ein Fehler
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;

export async function postJson(
  url: string,
  body: unknown,
  options: { headers?: Record<string, string>; timeoutSeconds: number; rawBody?: string },
): Promise<unknown> {
  const target = await assertProviderUrl(url);
  let response: Response;
  try {
    response = await fetch(target, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...options.headers },
      body: options.rawBody ?? JSON.stringify(body),
      redirect: 'error',
      signal: AbortSignal.timeout(options.timeoutSeconds * 1000),
    });
  } catch (error) {
    const name = (error as { name?: string }).name;
    if (name === 'TimeoutError' || name === 'AbortError') {
      throw new AiProviderError(`Keine Antwort innerhalb von ${options.timeoutSeconds} Sekunden.`);
    }
    throw new AiProviderError(`Nicht erreichbar (${target.host}).`);
  }
  const length = Number(response.headers.get('content-length') ?? 0);
  if (length > MAX_RESPONSE_BYTES) throw new AiProviderError('Die Antwort ist zu groß.');
  const text = await response.text();
  if (text.length > MAX_RESPONSE_BYTES) throw new AiProviderError('Die Antwort ist zu groß.');
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!response.ok) {
    throw new AiProviderError(
      `Fehler ${response.status}: ${errorMessage(json) ?? text.slice(0, 200)}`,
      response.status,
    );
  }
  if (json === null) throw new AiProviderError('Die Antwort ist kein JSON.');
  return json;
}

// Fehlermeldung aus den üblichen Formaten ({error:{message}}, {error:"…"}, {message})
function errorMessage(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const o = json as { error?: unknown; message?: unknown };
  if (typeof o.error === 'string') return o.error;
  if (
    o.error &&
    typeof o.error === 'object' &&
    typeof (o.error as { message?: unknown }).message === 'string'
  ) {
    return (o.error as { message: string }).message;
  }
  return typeof o.message === 'string' ? o.message : undefined;
}
