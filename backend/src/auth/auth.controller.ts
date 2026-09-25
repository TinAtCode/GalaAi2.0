import { Body, Controller, Get, HttpCode, Logger, Post, Query, Req, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { loginIpLimit } from './login-throttle';
import { clearSessionCookie, cookieOptions, readCookie, setSessionCookie } from './session-cookie';
import { OidcService } from './oidc.service';
import { OidcError } from './oidc';

const OIDC_STATE_COOKIE = 'gartenai_oidc';

@Controller('auth')
export class AuthController {
  private readonly logger = new Logger(AuthController.name);

  constructor(
    private authService: AuthService,
    private oidc: OidcService,
  ) {}

  // Login ist das klassische Brute-Force-Ziel: 5 Versuche/Minute je Konto
  // und IP (Throttler "login-account", app.module.ts) plus 30/Minute je IP
  // über alle Konten hinweg (hier). Details in auth/login-throttle.ts.
  // Der Browser bekommt die Sitzung als httpOnly-Cookie; das Token in der
  // Antwort ist für API-Clients (Tests, spätere Mobile-App).
  @Throttle({ default: { limit: loginIpLimit, ttl: 60000 } })
  @Post('login')
  async login(@Body() dto: LoginDto, @Res({ passthrough: true }) res: Response) {
    const result = await this.authService.login(dto.email, dto.password);
    setSessionCookie(res, result.accessToken);
    return result;
  }

  // Die angemeldete Person – das Frontend stellt damit nach dem Neuladen die
  // Sitzung aus dem Cookie wieder her.
  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: AuthenticatedUser) {
    return this.authService.me(user.userId);
  }

  @Post('logout')
  @HttpCode(200)
  logout(@Res({ passthrough: true }) res: Response) {
    clearSessionCookie(res);
    return { loggedOut: true };
  }

  // Eigenes Passwort ändern. Meldet alle anderen Sitzungen ab und gibt für
  // dieses Gerät ein neues Token zurück.
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('change-password')
  async changePassword(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: ChangePasswordDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.authService.changeOwnPassword(
      user.userId,
      dto.currentPassword,
      dto.newPassword,
    );
    setSessionCookie(res, result.accessToken);
    return result;
  }

  // Anmelden mit Google (oder einem anderen OIDC-Anbieter). Die Login-Seite
  // fragt, ob es eingerichtet ist, und zeigt dann den Knopf.
  @Get('oidc')
  oidcInfo() {
    const config = this.oidc.config();
    return config ? { enabled: true, label: config.label } : { enabled: false };
  }

  // Der Browser springt hierher und wird zum Anbieter weitergeleitet. State,
  // Nonce und PKCE-Schlüssel liegen signiert in einem kurzlebigen Cookie.
  @Throttle({ default: { limit: loginIpLimit, ttl: 60000 } })
  @Get('oidc/start')
  async oidcStart(@Res() res: Response) {
    try {
      const { url, stateToken } = await this.oidc.start();
      // immer Lax: mit „strict“ schickte der Browser das Cookie beim
      // Rücksprung vom Anbieter (fremde Seite) nicht mit
      res.cookie(OIDC_STATE_COOKIE, stateToken, {
        ...cookieOptions(),
        sameSite: 'lax',
        maxAge: 10 * 60 * 1000,
      });
      res.redirect(302, url);
    } catch (err) {
      this.failOidc(res, err);
    }
  }

  // Rücksprung vom Anbieter: Code eintauschen, Konto anmelden, zurück ins Frontend
  @Throttle({ default: { limit: loginIpLimit, ttl: 60000 } })
  @Get('oidc/callback')
  async oidcCallback(
    @Query() query: { code?: string; state?: string; error?: string },
    @Req() req: Request,
    @Res() res: Response,
  ) {
    try {
      const { session, config } = await this.oidc.finish(
        { code: query.code, state: query.state, error: query.error },
        readCookie(req, OIDC_STATE_COOKIE),
      );
      res.clearCookie(OIDC_STATE_COOKIE, { ...cookieOptions(), sameSite: 'lax' });
      setSessionCookie(res, session.accessToken);
      res.redirect(302, config.afterLogin);
    } catch (err) {
      this.failOidc(res, err);
    }
  }

  // Fehler landen auf der Login-Seite (?sso=Grund), nie als rohe Fehlermeldung
  private failOidc(res: Response, err: unknown) {
    const code = err instanceof OidcError ? err.code : 'provider';
    if (!(err instanceof OidcError) || code === 'provider' || code === 'token')
      this.logger.warn(`Anmeldung über Anbieter fehlgeschlagen: ${(err as Error).message}`);
    res.clearCookie(OIDC_STATE_COOKIE, { ...cookieOptions(), sameSite: 'lax' });
    const config = this.oidc.config();
    const target = new URL('login', config?.afterLogin ?? 'http://localhost/');
    target.searchParams.set('sso', code);
    res.redirect(302, config ? target.toString() : `/login?sso=${code}`);
  }
}
