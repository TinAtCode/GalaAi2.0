import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './configure-app';

async function bootstrap() {
  // backend/.env laden (JWT_SECRET, CORS_ORIGIN, UPLOADS_DIR, ...). Bisher las
  // nur Prisma diese Datei selbst – alle anderen Werte kamen nie an. Bereits
  // gesetzte Umgebungsvariablen (z.B. in CI) haben Vorrang. Fehlt die Datei,
  // wird nur mit den vorhandenen Umgebungsvariablen gestartet.
  try {
    process.loadEnvFile();
  } catch {
    // keine .env vorhanden
  }

  const app = await NestFactory.create(AppModule);

  configureApp(app);

  await app.listen(process.env.PORT ?? 3000);
  console.log(`GartenAI Backend läuft auf Port ${process.env.PORT ?? 3000}`);
}
bootstrap();
