import { Controller, Get } from '@nestjs/common';

// Bewusst OHNE Guards: für Monitoring/Load-Balancer/CI-Healthchecks, die
// sich nicht einloggen können. Liefert absichtlich keine Geschäftsdaten,
// nur ein Lebenszeichen.
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }
}
