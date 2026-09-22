import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

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

  await app.listen(process.env.PORT ?? 3000);
  console.log(`GartenAI Backend läuft auf Port ${process.env.PORT ?? 3000}`);
}
bootstrap();
