import { test, expect } from '@playwright/test';
import { loginViaUi } from './fixtures';

// Ein Admin legt über die Einstellungen einen Nutzer an; der neue Nutzer
// meldet sich an und ändert sein Startpasswort.
test.describe('Benutzerverwaltung', () => {
  test('Nutzer anlegen, anmelden, Passwort ändern', async ({ page }) => {
    const email = `mitarbeiter-${Date.now()}@musterbetrieb.de`;

    await loginViaUi(page);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('user-first-name').fill('Mia');
    await page.getByTestId('user-last-name').fill('Muster');
    await page.getByTestId('user-email').fill(email);
    await page.getByTestId('user-password').fill('startpasswort1');
    await page.getByTestId('user-submit').click();
    await expect(page.getByTestId('user-item').filter({ hasText: email })).toBeVisible();

    await page.getByTestId('nav-logout').click();
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill('startpasswort1');
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL('/');

    await page.getByTestId('nav-settings').click();
    // Ohne Admin-Recht keine Benutzerverwaltung
    await expect(page.getByTestId('user-submit')).toHaveCount(0);
    await page.getByTestId('password-current').fill('startpasswort1');
    await page.getByTestId('password-new').fill('meinneuespasswort');
    await page.getByTestId('password-submit').click();
    await expect(page.getByTestId('password-message')).toContainText('Passwort geändert');

    await page.getByTestId('nav-logout').click();
    await page.getByTestId('login-email').fill(email);
    await page.getByTestId('login-password').fill('meinneuespasswort');
    await page.getByTestId('login-submit').click();
    await expect(page).toHaveURL('/');
  });
});
