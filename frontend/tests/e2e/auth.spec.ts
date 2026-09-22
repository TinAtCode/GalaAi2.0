import { test, expect } from '@playwright/test';
import { SEED, loginViaUi } from './fixtures';

test.describe('Login', () => {
  test('mit korrekten Zugangsdaten gelangt man auf "Mein Tag"', async ({ page }) => {
    await loginViaUi(page);
    await expect(page.getByRole('heading', { name: 'Mein Tag' })).toBeVisible();
    // Navigation mit allen Berechtigungen (Admin-Rolle aus dem Seed) sichtbar.
    await expect(page.getByTestId('nav-team')).toBeVisible();
  });

  test('mit falschem Passwort erscheint eine Fehlermeldung, keine Navigation', async ({ page }) => {
    await page.goto('/login');
    await page.getByTestId('login-email').fill(SEED.email);
    await page.getByTestId('login-password').fill('falsches-passwort');
    await page.getByTestId('login-submit').click();

    await expect(page.getByTestId('login-error')).toBeVisible();
    await expect(page).toHaveURL('/login');
  });

  test('ohne Login wird man von einer geschützten Seite zum Login umgeleitet', async ({ page }) => {
    await page.goto('/projekte');
    await expect(page).toHaveURL('/login');
  });

  test('mit abgelaufener Sitzung landet man mit Hinweis auf der Login-Seite', async ({ page }) => {
    await loginViaUi(page);
    // Token serverseitig ungültig machen (z.B. abgelaufen oder Secret geändert)
    await page.evaluate(() => {
      const [header, payload] = localStorage.getItem('gartenai.token')!.split('.');
      localStorage.setItem('gartenai.token', `${header}.${payload}.ungueltige-signatur`);
    });
    await page.goto('/projekte');

    await expect(page).toHaveURL('/login');
    await expect(page.getByTestId('login-session-expired')).toBeVisible();
  });
});
