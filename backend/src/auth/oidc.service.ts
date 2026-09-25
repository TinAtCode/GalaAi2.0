import { Injectable, Logger } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { AuthService } from './auth.service';
import { getJwtSecret } from './jwt-secret';
import {
  Jwk,
  OidcConfig,
  OidcError,
  oidcConfig,
  pkceChallenge,
  randomToken,
  verifiedEmail,
  verifyIdToken,
} from './oidc';

interface Discovery {
  issuer: string;
  authorization_endpoint: string;
  token_endpoint: string;
  jwks_uri: string;
}

interface FlowState {
  state: string;
  nonce: string;
  verifier: string;
}

const STATE_TTL = '10m';
const CACHE_MS = 60 * 60 * 1000;

// Ablauf „Anmelden mit Google“ (oder einem anderen OIDC-Anbieter):
// start() leitet zum Anbieter, finish() tauscht den Code gegen das ID-Token,
// prüft es und meldet das passende bestehende Konto an.
@Injectable()
export class OidcService {
  private readonly logger = new Logger(OidcService.name);
  private cache: { issuer: string; at: number; discovery: Discovery; keys: Jwk[] } | null = null;

  constructor(
    private jwt: JwtService,
    private auth: AuthService,
  ) {}

  config(): OidcConfig | null {
    return oidcConfig();
  }

  // eigenes Geheimnis für den Zwischenstand: ein Sitzungs-Token lässt sich
  // damit nicht fälschen und umgekehrt
  private stateSecret() {
    return `${getJwtSecret()}.oidc-state`;
  }

  private async fetchJson<T>(url: string, init?: RequestInit): Promise<T> {
    const response = await fetch(url, { ...init, signal: AbortSignal.timeout(10_000) });
    if (!response.ok) throw new OidcError('provider', `${url} antwortet mit ${response.status}.`);
    return (await response.json()) as T;
  }

  private async provider(config: OidcConfig, refreshKeys = false) {
    const fresh =
      this.cache &&
      this.cache.issuer === config.issuer &&
      Date.now() - this.cache.at < CACHE_MS &&
      !refreshKeys;
    if (!fresh) {
      const discovery = await this.fetchJson<Discovery>(`${config.issuer}/.well-known/openid-configuration`);
      if (discovery.issuer.replace(/\/+$/, '') !== config.issuer)
        throw new OidcError('provider', 'Aussteller in der Anbieter-Konfiguration passt nicht.');
      const jwks = await this.fetchJson<{ keys: Jwk[] }>(discovery.jwks_uri);
      this.cache = { issuer: config.issuer, at: Date.now(), discovery, keys: jwks.keys ?? [] };
    }
    return this.cache!;
  }

  // Adresse beim Anbieter plus signierter Zwischenstand (kommt ins Cookie)
  async start(): Promise<{ url: string; stateToken: string }> {
    const config = this.config();
    if (!config) throw new OidcError('config', 'Anmeldung über einen Anbieter ist nicht eingerichtet.');
    const { discovery } = await this.provider(config);
    const flow: FlowState = { state: randomToken(), nonce: randomToken(), verifier: randomToken() };
    const url = new URL(discovery.authorization_endpoint);
    url.search = new URLSearchParams({
      response_type: 'code',
      client_id: config.clientId,
      redirect_uri: config.redirectUri,
      scope: 'openid email profile',
      state: flow.state,
      nonce: flow.nonce,
      code_challenge: pkceChallenge(flow.verifier),
      code_challenge_method: 'S256',
      prompt: 'select_account',
    }).toString();
    const stateToken = this.jwt.sign({ ...flow }, { secret: this.stateSecret(), expiresIn: STATE_TTL });
    return { url: url.toString(), stateToken };
  }

  async finish(query: { code?: string; state?: string; error?: string }, stateToken: string | null) {
    const config = this.config();
    if (!config) throw new OidcError('config', 'Anmeldung über einen Anbieter ist nicht eingerichtet.');
    if (query.error) throw new OidcError('provider', `Anbieter meldet: ${query.error}`);
    let flow: FlowState;
    try {
      flow = this.jwt.verify<FlowState>(stateToken ?? '', { secret: this.stateSecret() });
    } catch {
      throw new OidcError('state', 'Anmeldevorgang abgelaufen oder in einem anderen Browser gestartet.');
    }
    if (!query.state || query.state !== flow.state || !query.code)
      throw new OidcError('state', 'Anmeldevorgang passt nicht zu diesem Browser.');

    const { discovery } = await this.provider(config);
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code: query.code,
      redirect_uri: config.redirectUri,
      client_id: config.clientId,
      code_verifier: flow.verifier,
    });
    if (config.clientSecret) body.set('client_secret', config.clientSecret);
    const tokens = await this.fetchJson<{ id_token?: string }>(discovery.token_endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body,
    });
    if (!tokens.id_token) throw new OidcError('token', 'Anbieter hat kein ID-Token geliefert.');

    const expected = { issuer: discovery.issuer, clientId: config.clientId, nonce: flow.nonce };
    let claims;
    try {
      claims = verifyIdToken(tokens.id_token, this.cache!.keys, expected);
    } catch (err) {
      // Anbieter hat die Schlüssel gewechselt: einmal neu laden
      if (!(err instanceof OidcError) || !err.message.startsWith('Signatur')) throw err;
      const { keys } = await this.provider(config, true);
      claims = verifyIdToken(tokens.id_token, keys, expected);
    }
    const email = verifiedEmail(claims, config.allowedDomains);
    const session = await this.auth.loginWithVerifiedEmail(email);
    if (!session) {
      this.logger.warn(`Anmeldung über ${config.label} ohne passendes aktives Konto`);
      throw new OidcError('user', 'Zu dieser E-Mail-Adresse gibt es kein aktives Konto.');
    }
    return { session, config };
  }
}
