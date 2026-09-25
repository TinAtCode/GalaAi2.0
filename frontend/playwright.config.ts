import { defineConfig, devices } from '@playwright/test';

// Erwartet Backend auf :3000 und Frontend-Dev-Server auf :5173 (siehe
// TESTANLEITUNG.md). In CI übernimmt das `webServer` unten das Starten
// beider Server automatisch.
//
// Testcode und Browser rechnen wie das Backend in deutscher Zeit: „heute um
// 9 Uhr“ ist sonst auf einem Runner in UTC nach 22 Uhr schon der Vortag
process.env.TZ = 'Europe/Berlin';

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Tests teilen sich denselben Seed-Datensatz -> sequenziell sicherer
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }]] : 'list',
  use: {
    timezoneId: 'Europe/Berlin',
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
