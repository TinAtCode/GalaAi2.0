import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
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
}
