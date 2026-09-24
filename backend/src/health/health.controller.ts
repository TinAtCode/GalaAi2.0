import { Controller, Get } from '@nestjs/common';

// Bewusst OHNE Guards: für Monitoring/Load-Balancer/CI-Healthchecks, die
// sich nicht einloggen können. Liefert absichtlich keine Geschäftsdaten,
// nur ein Lebenszeichen.
@Controller('health')
export class HealthController {
  @Get()
  check() {
    // version: ausgerollte Version (ops/deploy.sh prüft sie nach dem Start)
    return {
      status: 'ok',
      version: process.env.GARTENAI_VERSION ?? 'dev',
      timestamp: new Date().toISOString(),
    };
  }
}
