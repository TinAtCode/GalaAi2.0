import { createHmac, generateKeyPairSync, sign } from 'crypto';
import { Jwk, oidcConfig, OidcError, pkceChallenge, verifiedEmail, verifyIdToken } from '../src/auth/oidc';

const b64 = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url');
const rsa = generateKeyPairSync('rsa', { modulusLength: 2048 });
const ec = generateKeyPairSync('ec', { namedCurve: 'P-256' });
const keys = [
  { ...rsa.publicKey.export({ format: 'jwk' }), kid: 'r1' },
  { ...ec.publicKey.export({ format: 'jwk' }), kid: 'e1' },
] as Jwk[];
const now = Date.UTC(2026, 9, 1, 12);
const claims = {
  iss: 'https://accounts.google.com',
  aud: 'client',
  sub: '1',
  exp: now / 1000 + 300,
  iat: now / 1000,
  nonce: 'n',
  email: 'Chef@Firma.de',
  email_verified: true,
};
const expected = { issuer: 'https://accounts.google.com', clientId: 'client', nonce: 'n' };

function token(payload: object, alg = 'RS256', kid = 'r1') {
  const head = `${b64({ alg, kid })}.${b64(payload)}`;
  const signature =
    alg === 'ES256'
      ? sign('sha256', Buffer.from(head), { key: ec.privateKey, dsaEncoding: 'ieee-p1363' })
      : sign('sha256', Buffer.from(head), rsa.privateKey);
  return `${head}.${signature.toString('base64url')}`;
}
const code = (fn: () => unknown) => {
  try {
    fn();
  } catch (err) {
    return (err as OidcError).code;
  }
  return 'ok';
};

describe('OIDC: ID-Token prüfen', () => {
  it('nimmt korrekt signierte Tokens an (RS256 und ES256)', () => {
    expect(verifyIdToken(token(claims), keys, expected, now).sub).toBe('1');
    expect(verifyIdToken(token(claims, 'ES256', 'e1'), keys, expected, now).sub).toBe('1');
    // Google schreibt den Aussteller teils ohne https://
    expect(
      code(() => verifyIdToken(token({ ...claims, iss: 'accounts.google.com' }), keys, expected, now)),
    ).toBe('ok');
  });

  it('lehnt alg=none, HS256 mit öffentlichem Schlüssel und veränderte Inhalte ab', () => {
    const none = `${b64({ alg: 'none' })}.${b64(claims)}.`;
    expect(code(() => verifyIdToken(none, keys, expected, now))).toBe('token');
    const head = `${b64({ alg: 'HS256', kid: 'r1' })}.${b64(claims)}`;
    const hs = `${head}.${createHmac('sha256', JSON.stringify(keys[0])).update(head).digest('base64url')}`;
    expect(code(() => verifyIdToken(hs, keys, expected, now))).toBe('token');
    const [h, , s] = token(claims).split('.');
    const changed = `${h}.${b64({ ...claims, email: 'boss@firma.de' })}.${s}`;
    expect(code(() => verifyIdToken(changed, keys, expected, now))).toBe('token');
  });

  it('prüft Aussteller, Empfänger, Ablauf und Nonce', () => {
    const check = (patch: object) =>
      code(() => verifyIdToken(token({ ...claims, ...patch }), keys, expected, now));
    expect(check({ iss: 'https://evil.example' })).toBe('token');
    expect(check({ aud: 'andere' })).toBe('token');
    expect(check({ aud: ['client', 'andere'] })).toBe('token'); // mehrere Empfänger ohne azp
    expect(check({ aud: ['client', 'andere'], azp: 'client' })).toBe('ok');
    expect(check({ exp: now / 1000 - 120 })).toBe('token');
    expect(check({ exp: now / 1000 - 30 })).toBe('ok'); // Spielraum für Uhren
    expect(check({ iat: now / 1000 + 600 })).toBe('token');
    expect(check({ nonce: 'x' })).toBe('token');
  });

  it('E-Mail nur bestätigt und aus freigegebenen Domains', () => {
    expect(verifiedEmail(claims, [])).toBe('chef@firma.de');
    expect(verifiedEmail({ ...claims, email_verified: 'true' }, ['firma.de'])).toBe('chef@firma.de');
    expect(code(() => verifiedEmail({ ...claims, email_verified: false }, []))).toBe('email');
    expect(code(() => verifiedEmail({ ...claims, email: undefined }, []))).toBe('email');
    expect(code(() => verifiedEmail(claims, ['andere.de']))).toBe('domain');
  });
});

describe('OIDC: Einstellungen', () => {
  it('aus ohne Client-ID oder Rücksprung-Adresse, Google als Standard', () => {
    expect(oidcConfig({})).toBeNull();
    expect(oidcConfig({ OIDC_CLIENT_ID: 'x' })).toBeNull();
    expect(
      oidcConfig({
        OIDC_CLIENT_ID: 'x',
        OIDC_REDIRECT_URI: 'https://buero.local:8443/api/auth/oidc/callback',
      }),
    ).toMatchObject({
      issuer: 'https://accounts.google.com',
      label: 'Google',
      afterLogin: 'https://buero.local:8443/',
      allowedDomains: [],
    });
    expect(
      oidcConfig({
        OIDC_CLIENT_ID: 'x',
        OIDC_REDIRECT_URI: 'https://a/cb',
        OIDC_ISSUER: 'https://login.microsoftonline.com/t/v2.0/',
        OIDC_ALLOWED_DOMAINS: 'Firma.de, gala.de',
      }),
    ).toMatchObject({
      issuer: 'https://login.microsoftonline.com/t/v2.0',
      label: 'Firmenkonto',
      allowedDomains: ['firma.de', 'gala.de'],
    });
  });

  it('PKCE-Challenge: SHA-256, base64url ohne Auffüllzeichen (S256)', () => {
    const challenge = pkceChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r7wW1gFWFOEjXk');
    // unabhängig nachgerechnet (Python hashlib + urlsafe_b64encode)
    expect(challenge).toBe('bwWFMyPfdG9qreDhH2lmftFx_dFeLDalzcT1gb_j68g');
    expect(challenge).toMatch(/^[\w-]{43}$/);
  });
});
