import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { HttpAdapterHost } from '@nestjs/core';
import { corsOrigins, csrfGuard } from './auth/session-cookie';
import { requestLogger } from './logging/request-logger';
import { ExceptionLoggerFilter } from './logging/exception-logger.filter';

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
  app.use(requestLogger);
  app.useGlobalFilters(new ExceptionLoggerFilter(app.get(HttpAdapterHost).httpAdapter));
  app.use(helmet());

  // Global: Eingaben werden validiert und auf die erwartete Form
  // "whitelisted" (unbekannte Felder fliegen raus) – wichtig, damit z.B.
  // niemand versehentlich oder absichtlich companyId im Body mitschickt.
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));

  // CORS: nur die eigenen Frontends (CORS_ORIGIN, kommagetrennt; ohne Wert
  // das lokale Vite-Frontend), mit Cookies (credentials) für die Sitzung.
  // X-Total-Count: Gesamtzahl bei seitenweise geladenen Listen (common/pagination.ts).
  app.enableCors({
    origin: corsOrigins(),
    credentials: true,
    exposedHeaders: ['X-Total-Count', 'X-Request-Id'],
  });
  app.use(csrfGuard);
}
