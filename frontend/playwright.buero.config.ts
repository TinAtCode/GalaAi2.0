import { defineConfig, devices } from '@playwright/test';

// Browser-Test der Mini-Vollversion (docker-compose.buero.yml) über HTTPS mit
// der eigenen Zertifizierungsstelle – aufgerufen von ops/tests/buero-smoke.sh,
// nachdem ops/buero/start.sh die Installation frisch gestartet hat.
// Ist das Stammzertifikat im Browser installiert (BUERO_CA_TRUSTED=1, wie auf
// dem Büro-Rechner nach BUERO.md), prüft der Test ohne Ausnahme für Zertifikate.
export default defineConfig({
  testDir: './tests/buero',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: 'list',
  use: {
    baseURL: process.env.BUERO_URL ?? 'https://localhost:8443',
    ignoreHTTPSErrors: process.env.BUERO_CA_TRUSTED !== '1',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
