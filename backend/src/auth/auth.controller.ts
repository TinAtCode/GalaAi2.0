import { Body, Controller, Get, HttpCode, Post, Res, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Response } from 'express';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { loginIpLimit } from './login-throttle';
import { clearSessionCookie, setSessionCookie } from './session-cookie';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

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
}
