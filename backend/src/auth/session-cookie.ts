import type { CookieOptions, NextFunction, Request, Response } from 'express';

// Browser-Sitzung im httpOnly-Cookie: JavaScript im Browser kommt an das
// Token nicht heran – eine XSS-Lücke kann es nicht auslesen. API-Clients
// (Tests, spätere Mobile-App) schicken es weiter als Bearer-Header.

export const SESSION_COOKIE = 'gartenai_session';
const MAX_AGE_MS = 8 * 60 * 60 * 1000; // wie die Gültigkeit des Tokens (auth.module.ts)

export function cookieOptions(): CookieOptions {
  // SameSite=Lax: fremde Seiten können keine Anfragen mit dem Cookie auslösen
  // (außer einfachen Links). Secure in Produktion oder per COOKIE_SECURE=1.
  // Leere Werte (COOKIE_SECURE= in .env oder Compose) gelten als nicht gesetzt
  const sameSite = (process.env.COOKIE_SAMESITE || 'lax') as CookieOptions['sameSite'];
  const secure = process.env.COOKIE_SECURE
    ? process.env.COOKIE_SECURE === '1'
    : process.env.NODE_ENV === 'production' || sameSite === 'none';
  return { httpOnly: true, sameSite, secure, path: '/' };
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: MAX_AGE_MS });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}

export function sessionTokenFromCookie(req: Request): string | null {
  const header = req.headers.cookie;
  if (!header) return null;
  for (const part of header.split(';')) {
    const [name, ...rest] = part.trim().split('=');
    if (name === SESSION_COOKIE) return decodeURIComponent(rest.join('='));
  }
  return null;
}

// CSRF-Schutz zusätzlich zu SameSite: Ändernde Anfragen, die sich über das
// Cookie anmelden (kein Bearer-Header), brauchen den Header X-Requested-With.
// Formulare fremder Seiten können ihn nicht setzen, und fetch von fremden
// Seiten scheitert mit ihm an CORS. Ohne Cookie gibt es nichts zu missbrauchen
// (API-Clients, Login).
const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

export function csrfGuard(req: Request, res: Response, next: NextFunction) {
  if (
    SAFE_METHODS.has(req.method) ||
    req.headers.authorization ||
    req.headers['x-requested-with'] ||
    !sessionTokenFromCookie(req)
  ) {
    return next();
  }
  res
    .status(403)
    .json({ statusCode: 403, message: 'Anfrage ohne X-Requested-With abgelehnt (CSRF-Schutz).' });
}

// Erlaubte Frontend-Adressen: CORS_ORIGIN (kommagetrennt) oder für die
// lokale Entwicklung das Vite-Frontend. Mit Cookies darf CORS nicht mehr für
// jede Seite offen sein.
export function corsOrigins(): string[] {
  const configured = process.env.CORS_ORIGIN?.split(',')
    .map((o) => o.trim())
    .filter(Boolean);
  return configured?.length ? configured : ['http://localhost:5173', 'http://127.0.0.1:5173'];
}
