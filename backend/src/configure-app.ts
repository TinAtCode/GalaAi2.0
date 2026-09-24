import { INestApplication, ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { json } from 'express';
import { HttpAdapterHost } from '@nestjs/core';
import { corsOrigins, csrfGuard } from './auth/session-cookie';
import { requestLogger } from './logging/request-logger';
import { httpMetrics } from './metrics/metrics';
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
  app.use(httpMetrics);
  app.useGlobalFilters(new ExceptionLoggerFilter(app.get(HttpAdapterHost).httpAdapter));
  app.use(helmet());
  // Lagepläne werden als Ganzes gespeichert (bis 50.000 Punkte): mehr als die
  // Standardgrenze von 100 kB, nur für diese Route
  // (eingepackt: eine Middleware namens "jsonParser" hielte Nest davon ab,
  // den globalen JSON-Parser für alle anderen Routen zu registrieren)
  const planJson = json({ limit: '4mb' });
  app.use(
    '/plans',
    (req: Parameters<typeof planJson>[0], res: Parameters<typeof planJson>[1], next: () => void) =>
      planJson(req, res, next),
  );

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
