import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { ChangePasswordDto, LoginDto } from './dto/login.dto';
import { JwtAuthGuard } from './jwt-auth.guard';
import { CurrentUser } from '../common/current-user.decorator';
import { AuthenticatedUser } from '../common/authenticated-request';
import { loginIpLimit } from './login-throttle';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // Login ist das klassische Brute-Force-Ziel: 5 Versuche/Minute je Konto
  // und IP (Throttler "login-account", app.module.ts) plus 30/Minute je IP
  // über alle Konten hinweg (hier). Details in auth/login-throttle.ts.
  @Throttle({ default: { limit: loginIpLimit, ttl: 60000 } })
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }

  // Eigenes Passwort ändern. Meldet alle anderen Sitzungen ab und gibt für
  // dieses Gerät ein neues Token zurück.
  @UseGuards(JwtAuthGuard)
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('change-password')
  changePassword(@CurrentUser() user: AuthenticatedUser, @Body() dto: ChangePasswordDto) {
    return this.authService.changeOwnPassword(user.userId, dto.currentPassword, dto.newPassword);
  }
}
