import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';

// Globale App-Konfiguration an einer Stelle – main.ts und die
// Integrationstests nutzen dieselbe, damit die Tests genau das prüfen,
// was auch in Produktion läuft.
export function configureApp(app: INestApplication) {
  // Hinter einem Reverse-Proxy (nginx, Traefik, Load-Balancer) sieht das
  // Backend sonst nur die IP des Proxys – dann teilen sich ALLE Nutzer ein
  // Rate-Limit. TRUST_PROXY=1 heißt: einem Proxy davor vertrauen und die
  // echte Client-IP aus X-Forwarded-For nehmen. Ohne Proxy leer lassen,
  // sonst kann jeder Client seine IP per Header fälschen.
  const trustProxy = process.env.TRUST_PROXY;
  if (trustProxy) {
    const hops = Number(trustProxy);
    app
      .getHttpAdapter()
      .getInstance()
      .set('trust proxy', Number.isInteger(hops) ? hops : trustProxy);
  }

  // Sicherheits-Header (Punkt 38: "sichere API") – u.a. X-Content-Type-Options,
  // X-Frame-Options, keine Preisgabe der Express-Version im Header.
  app.use(helmet());

  // Global: Eingaben werden validiert und auf die erwartete Form
  // "whitelisted" (unbekannte Felder fliegen raus) – wichtig, damit z.B.
  // niemand versehentlich oder absichtlich companyId im Body mitschickt.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  // CORS_ORIGIN in der .env setzen (z.B. "https://app.gartenai.de"), um auf
  // eine bestimmte Domain einzuschränken; ohne gesetzten Wert bleibt es
  // offen (praktisch für lokale Entwicklung, für Produktion einschränken).
  const corsOrigin = process.env.CORS_ORIGIN;
  app.enableCors(corsOrigin ? { origin: corsOrigin } : undefined);
}
