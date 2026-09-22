import { Body, Controller, Post } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';

@Controller('auth')
export class AuthController {
  constructor(private authService: AuthService) {}

  // Engeres Limit als der globale Standard (siehe app.module.ts): Login ist
  // das klassische Brute-Force-Ziel, 5 Versuche/Minute pro IP reichen für
  // legitime Nutzung, bremsen aber automatisiertes Durchprobieren aus.
  // LOGIN_RATE_LIMIT nur für automatisierte Tests erhöhen (die E2E-Suite
  // meldet sich pro Test neu an), in Produktion beim Standard lassen.
  @Throttle({ default: { limit: () => Number(process.env.LOGIN_RATE_LIMIT) || 5, ttl: 60000 } })
  @Post('login')
  async login(@Body() dto: LoginDto) {
    return this.authService.login(dto.email, dto.password);
  }
}
