import { Controller, Get, NotFoundException } from '@nestjs/common';
import { DEMO_LOGINS, DEMO_PASSWORD } from '../cli/demo-data';

// Nur in der Demo (DEMO_MODE=1, docker-compose.demo.yml): Adressen im LAN für
// den QR-Code und die Demo-Anmeldungen für die Anmeldeseite. Sonst 404 –
// im Betrieb gibt es diese Daten nicht.
@Controller('demo')
export class DemoController {
  @Get('info')
  info() {
    if (process.env.DEMO_MODE !== '1') throw new NotFoundException();
    const urls = (process.env.DEMO_URLS ?? '')
      .split(',')
      .map((url) => url.trim())
      .filter((url) => /^https?:\/\/[^\s]+$/.test(url));
    return { urls, password: DEMO_PASSWORD, logins: DEMO_LOGINS };
  }
}
