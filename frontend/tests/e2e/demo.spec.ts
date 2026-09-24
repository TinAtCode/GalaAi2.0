import { test, expect } from '@playwright/test';

// Demo-Modus (Backend mit DEMO_MODE=1, siehe docker-compose.demo.yml): die
// Anmeldeseite zeigt die Zugänge zum Antippen und den QR-Code fürs Handy.
// In der CI läuft das Backend mit DEMO_MODE=1 (ci-e2e.yml).
test.describe('Demo-Anmeldung', () => {
  test('Zugang antippen meldet an, QR-Code mit Adresse im WLAN', async ({ page, request }) => {
    const api = process.env.E2E_API_URL ?? 'http://localhost:3000';
    test.skip(!(await request.get(`${api}/demo/info`)).ok(), 'Backend nicht im Demo-Modus');
    await page.goto('/login');
    const panel = page.getByTestId('demo-panel');
    await expect(panel.getByTestId('demo-login')).toHaveText(['Chef', 'Büro', 'Mitarbeiter']);
    await expect(panel.getByTestId('demo-url')).toHaveText('http://192.168.1.20:8080');
    await expect(panel.getByTestId('demo-qr')).toBeVisible();
    await page.screenshot({ path: 'test-results/demo-login.png' });
    await panel.getByTestId('demo-login').filter({ hasText: 'Chef' }).click();
    await expect(page.getByTestId('nav-site')).toBeVisible();
  });
});
