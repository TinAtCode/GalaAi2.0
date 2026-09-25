import { createHash, createPublicKey, randomBytes, verify as verifySignature, type JsonWebKey } from 'crypto';

// Anmelden über einen OpenID-Connect-Anbieter (Google, Microsoft, Nextcloud,
// Keycloak …): Autorisierungscode mit PKCE, das ID-Token wird über die
// Schlüssel des Anbieters (JWKS) geprüft. Keine zusätzliche Bibliothek –
// Node kann JWK-Schlüssel selbst lesen.

export interface OidcConfig {
  issuer: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  label: string;
  // nach der Anmeldung dorthin (Frontend)
  afterLogin: string;
  // optional: nur E-Mail-Adressen dieser Domains (kommagetrennt)
  allowedDomains: string[];
  // Anbieter ohne „email_verified“ (Microsoft Entra ID): E-Mail trotzdem
  // annehmen – nur mit mandantengebundenem Aussteller (siehe oidcConfig)
  trustEmail: boolean;
}

// Liest die Einstellungen aus der Umgebung. Ohne Client-ID und Rücksprung-
// Adresse ist die Anmeldung aus (Knopf wird nicht angezeigt).
export function oidcConfig(env: NodeJS.ProcessEnv = process.env): OidcConfig | null {
  const clientId = env.OIDC_CLIENT_ID?.trim();
  const redirectUri = env.OIDC_REDIRECT_URI?.trim();
  if (!clientId || !redirectUri) return null;
  const issuer = (env.OIDC_ISSUER?.trim() || 'https://accounts.google.com').replace(/\/+$/, '');
  return {
    issuer,
    clientId,
    clientSecret: env.OIDC_CLIENT_SECRET?.trim() ?? '',
    redirectUri,
    label: env.OIDC_LABEL?.trim() || (issuer === 'https://accounts.google.com' ? 'Google' : 'Firmenkonto'),
    afterLogin: env.OIDC_AFTER_LOGIN_URL?.trim() || `${new URL(redirectUri).origin}/`,
    trustEmail: env.OIDC_TRUST_EMAIL === '1',
    allowedDomains: (env.OIDC_ALLOWED_DOMAINS ?? '')
      .split(',')
      .map((d) => d.trim().toLowerCase())
      .filter(Boolean),
  };
}

export const base64url = (data: Buffer) => data.toString('base64url');
export const randomToken = () => base64url(randomBytes(32));
export const pkceChallenge = (verifier: string) => base64url(createHash('sha256').update(verifier).digest());

export class OidcError extends Error {
  constructor(
    // kurzer Code für die Login-Seite (?sso=…)
    readonly code: 'config' | 'state' | 'provider' | 'token' | 'email' | 'domain' | 'user',
    message: string,
  ) {
    super(message);
  }
}

export interface IdTokenClaims {
  iss: string;
  aud: string | string[];
  azp?: string;
  exp: number;
  iat?: number;
  nonce?: string;
  email?: string;
  email_verified?: boolean | string;
  sub: string;
}

const ALGORITHMS: Record<string, { hash: string; kty: string; ec?: boolean }> = {
  RS256: { hash: 'sha256', kty: 'RSA' },
  RS384: { hash: 'sha384', kty: 'RSA' },
  RS512: { hash: 'sha512', kty: 'RSA' },
  ES256: { hash: 'sha256', kty: 'EC', ec: true },
  ES384: { hash: 'sha384', kty: 'EC', ec: true },
};

export type Jwk = JsonWebKey & { kid?: string; kty?: string; use?: string };

// ID-Token prüfen: Signatur (Schlüssel aus dem JWKS), Aussteller, Empfänger,
// Ablauf und Nonce. Gibt die Angaben zurück oder wirft OidcError('token').
export function verifyIdToken(
  token: string,
  keys: Jwk[],
  expected: { issuer: string; clientId: string; nonce: string },
  now = Date.now(),
): IdTokenClaims {
  const parts = token.split('.');
  if (parts.length !== 3) throw new OidcError('token', 'ID-Token ist kein JWT.');
  const [headerPart, payloadPart, signaturePart] = parts;
  let header: { alg?: string; kid?: string };
  let claims: IdTokenClaims;
  try {
    header = JSON.parse(Buffer.from(headerPart, 'base64url').toString('utf8'));
    claims = JSON.parse(Buffer.from(payloadPart, 'base64url').toString('utf8'));
  } catch {
    throw new OidcError('token', 'ID-Token ist nicht lesbar.');
  }
  // "none" und HS* (geteiltes Geheimnis) werden nie angenommen
  const alg = ALGORITHMS[header.alg ?? ''];
  if (!alg) throw new OidcError('token', `Signaturverfahren ${header.alg} wird nicht unterstützt.`);
  const candidates = keys.filter(
    (k) => k.kty === alg.kty && (!k.use || k.use === 'sig') && (!header.kid || k.kid === header.kid),
  );
  const data = Buffer.from(`${headerPart}.${payloadPart}`);
  const signature = Buffer.from(signaturePart, 'base64url');
  const valid = candidates.some((jwk) => {
    try {
      const key = createPublicKey({ key: jwk, format: 'jwk' });
      return verifySignature(alg.hash, data, alg.ec ? { key, dsaEncoding: 'ieee-p1363' } : key, signature);
    } catch {
      return false;
    }
  });
  if (!valid) throw new OidcError('token', 'Signatur des ID-Tokens ist ungültig.');

  const audiences = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  // 1 Minute Spielraum für abweichende Uhren
  const seconds = Math.floor(now / 1000);
  // Google schreibt den Aussteller teils ohne https:// ins Token
  const issuerOk =
    claims.iss === expected.issuer ||
    (expected.issuer === 'https://accounts.google.com' && claims.iss === 'accounts.google.com');
  if (!issuerOk) throw new OidcError('token', 'ID-Token stammt von einem anderen Aussteller.');
  if (!audiences.includes(expected.clientId) || (audiences.length > 1 && claims.azp !== expected.clientId))
    throw new OidcError('token', 'ID-Token ist nicht für diese Anwendung ausgestellt.');
  if (typeof claims.exp !== 'number' || claims.exp + 60 < seconds)
    throw new OidcError('token', 'ID-Token ist abgelaufen.');
  if (typeof claims.iat === 'number' && claims.iat - 60 > seconds)
    throw new OidcError('token', 'ID-Token ist aus der Zukunft.');
  if (claims.nonce !== expected.nonce) throw new OidcError('token', 'Nonce des ID-Tokens passt nicht.');
  return claims;
}

// E-Mail aus dem Token: muss vom Anbieter bestätigt sein (sonst könnte sich
// jemand mit einer fremden, unbestätigten Adresse anmelden)
export function verifiedEmail(claims: IdTokenClaims, allowedDomains: string[], trustEmail = false): string {
  const email = claims.email?.trim().toLowerCase();
  // ausdrücklich „nicht bestätigt“ gilt nie; fehlt die Angabe, nur mit OIDC_TRUST_EMAIL
  const verified =
    claims.email_verified === true ||
    claims.email_verified === 'true' ||
    (trustEmail && claims.email_verified === undefined);
  if (!email || !verified)
    throw new OidcError('email', 'Der Anbieter hat keine bestätigte E-Mail-Adresse geliefert.');
  const domain = email.split('@')[1] ?? '';
  if (allowedDomains.length && !allowedDomains.includes(domain))
    throw new OidcError('domain', `Anmeldung mit Adressen von ${domain} ist nicht freigegeben.`);
  return email;
}
