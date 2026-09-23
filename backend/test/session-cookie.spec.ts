import { cookieOptions } from '../src/auth/session-cookie';

// Leere Umgebungsvariablen (COOKIE_SECURE= aus .env oder docker compose)
// dürfen Secure in Produktion nicht abschalten.
describe('Sitzungs-Cookie', () => {
  const saved = { ...process.env };
  afterEach(() => {
    process.env = { ...saved };
  });

  it.each([
    ['production, nicht gesetzt', { NODE_ENV: 'production' }, true, 'lax'],
    ['production, leer', { NODE_ENV: 'production', COOKIE_SECURE: '', COOKIE_SAMESITE: '' }, true, 'lax'],
    ['production, abgeschaltet', { NODE_ENV: 'production', COOKIE_SECURE: '0' }, false, 'lax'],
    ['Entwicklung', { NODE_ENV: 'development' }, false, 'lax'],
    ['Entwicklung, erzwungen', { NODE_ENV: 'development', COOKIE_SECURE: '1' }, true, 'lax'],
    ['SameSite=none immer Secure', { NODE_ENV: 'development', COOKIE_SAMESITE: 'none' }, true, 'none'],
  ])('%s', (_label, env, secure, sameSite) => {
    delete process.env.COOKIE_SECURE;
    delete process.env.COOKIE_SAMESITE;
    Object.assign(process.env, env);
    expect(cookieOptions()).toMatchObject({ secure, sameSite, httpOnly: true });
  });
});
