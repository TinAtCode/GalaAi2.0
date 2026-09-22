import { defineConfig, devices } from '@playwright/test';

// Erwartet Backend auf :3000 und Frontend-Dev-Server auf :5173 (siehe
// TESTANLEITUNG.md). In CI übernimmt das `webServer` unten das Starten
// beider Server automatisch.
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false, // Tests teilen sich denselben Seed-Datensatz -> sequenziell sicherer
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
  ],
});
