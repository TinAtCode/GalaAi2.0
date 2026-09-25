import { createHash, generateKeyPairSync, KeyObject, sign } from 'crypto';
import { createServer, Server } from 'http';
import { AddressInfo } from 'net';

// Nachgebauter OIDC-Anbieter für Tests: Discovery, JWKS, Token-Endpunkt mit
// PKCE-Prüfung. authorize() spielt „Nutzer meldet sich beim Anbieter an“.
export interface FakeIdentity {
  email?: string;
  email_verified?: boolean;
}

export class FakeOidc {
  issuer = '';
  readonly clientId = 'gartenai-test-client';
  readonly clientSecret = 'geheim';
  private server!: Server;
  private readonly key = generateKeyPairSync('rsa', { modulusLength: 2048 });
  private codes = new Map<
    string,
    { nonce: string; challenge: string; identity: FakeIdentity; redirectUri: string }
  >();
  tokenRequests = 0;
  // zum Testen gefälschter Tokens: mit fremdem Schlüssel signieren
  signingKey: KeyObject = this.key.privateKey;
  overrideClaims: Record<string, unknown> = {};

  async listen() {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((resolve) => this.server.listen(0, '127.0.0.1', resolve));
    this.issuer = `http://127.0.0.1:${(this.server.address() as AddressInfo).port}`;
  }

  close() {
    return new Promise<void>((resolve) => this.server.close(() => resolve()));
  }

  // wie der Anbieter nach erfolgreicher Anmeldung: Code für diese Anfrage
  authorize(authorizeUrl: string, identity: FakeIdentity) {
    const url = new URL(authorizeUrl);
    const code = `code-${this.codes.size + 1}`;
    this.codes.set(code, {
      nonce: url.searchParams.get('nonce')!,
      challenge: url.searchParams.get('code_challenge')!,
      identity,
      redirectUri: url.searchParams.get('redirect_uri')!,
    });
    return { code, state: url.searchParams.get('state')! };
  }

  idToken(claims: Record<string, unknown>) {
    const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1', typ: 'JWT' })).toString('base64url');
    const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
    const signature = sign('sha256', Buffer.from(`${header}.${payload}`), this.signingKey).toString(
      'base64url',
    );
    return `${header}.${payload}.${signature}`;
  }

  private async handle(req: import('http').IncomingMessage, res: import('http').ServerResponse) {
    const json = (status: number, body: unknown) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    if (req.url === '/.well-known/openid-configuration')
      return json(200, {
        issuer: this.issuer,
        authorization_endpoint: `${this.issuer}/authorize`,
        token_endpoint: `${this.issuer}/token`,
        jwks_uri: `${this.issuer}/jwks`,
      });
    if (req.url === '/jwks')
      return json(200, {
        keys: [{ ...this.key.publicKey.export({ format: 'jwk' }), kid: 'k1', use: 'sig' }],
      });
    if (req.url === '/token' && req.method === 'POST') {
      this.tokenRequests++;
      let raw = '';
      for await (const chunk of req) raw += chunk;
      const form = new URLSearchParams(raw);
      const entry = this.codes.get(form.get('code') ?? '');
      const verifier = form.get('code_verifier') ?? '';
      const challenge = createHash('sha256').update(verifier).digest('base64url');
      if (
        !entry ||
        form.get('client_id') !== this.clientId ||
        form.get('client_secret') !== this.clientSecret ||
        form.get('redirect_uri') !== entry.redirectUri ||
        challenge !== entry.challenge
      )
        return json(400, { error: 'invalid_grant' });
      this.codes.delete(form.get('code')!);
      const now = Math.floor(Date.now() / 1000);
      return json(200, {
        access_token: 'unbenutzt',
        token_type: 'Bearer',
        id_token: this.idToken({
          iss: this.issuer,
          aud: this.clientId,
          sub: `sub-${entry.identity.email}`,
          iat: now,
          exp: now + 300,
          nonce: entry.nonce,
          ...entry.identity,
          ...this.overrideClaims,
        }),
      });
    }
    json(404, { error: 'not_found' });
  }
}
