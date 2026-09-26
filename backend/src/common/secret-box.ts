import { createCipheriv, createDecipheriv, hkdfSync, randomBytes } from 'crypto';

// Geheimnisse in der Datenbank (z.B. API-Schlüssel der KI-Anbieter) mit
// AES-256-GCM verschlüsseln. Schlüssel: SECRET_KEY (32 Byte als Base64 oder
// 64 Hex-Zeichen; eine andere, mindestens 32 Zeichen lange Zeichenkette wie
// die zufälligen 48 Zeichen aus ops/buero/start wird per HKDF abgeleitet),
// sonst abgeleitet aus JWT_SECRET. Wer JWT_SECRET wechselt, ohne SECRET_KEY zu
// setzen, muss die Schlüssel neu eingeben – darum für den Betrieb SECRET_KEY
// setzen (BETRIEB.md). Beim Umzug auf einen anderen Rechner SECRET_KEY mitnehmen.
// Format: v1:<iv>:<tag>:<daten>, alles Base64.
const VERSION = 'v1';

function key(): Buffer {
  const configured = process.env.SECRET_KEY?.trim();
  if (configured) {
    if (/^[0-9a-f]{64}$/i.test(configured)) return Buffer.from(configured, 'hex');
    const raw = /^[A-Za-z0-9+/_-]{43}=?$/.test(configured) ? Buffer.from(configured, 'base64') : null;
    if (raw?.length === 32) return raw;
    if (configured.length >= 32)
      return Buffer.from(hkdfSync('sha256', configured, 'gartenai', 'secret-key v1', 32));
    throw new Error('SECRET_KEY muss 32 Byte lang sein (Base64, 64 Hex-Zeichen oder mindestens 32 Zeichen).');
  }
  const jwt = process.env.JWT_SECRET;
  if (!jwt)
    throw new Error(
      'Weder SECRET_KEY noch JWT_SECRET gesetzt – Geheimnisse lassen sich nicht verschlüsseln.',
    );
  return Buffer.from(hkdfSync('sha256', jwt, 'gartenai', 'secret-box v1', 32));
}

export function sealSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [
    VERSION,
    iv.toString('base64'),
    cipher.getAuthTag().toString('base64'),
    data.toString('base64'),
  ].join(':');
}

export function openSecret(sealed: string): string {
  const [version, iv, tag, data] = sealed.split(':');
  if (version !== VERSION || !iv || !tag || data === undefined)
    throw new Error('Unbekanntes Format des Geheimnisses.');
  const decipher = createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
