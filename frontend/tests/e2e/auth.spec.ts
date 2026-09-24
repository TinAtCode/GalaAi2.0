import { test, expect } from '@playwright/test';
import { API_BASE_URL, SEED, loginViaUi } from './fixtures';

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
    // Erst wenn "Mein Tag" fertig geladen hat – sonst bekommen noch laufende
    // Anfragen dieser Seite die 401 und zeigen den Hinweis schon dort.
    await expect(page.getByRole('heading', { name: 'Mein Tag' })).toBeVisible();
    await page.waitForLoadState('networkidle');
    // Sitzungs-Cookie ungültig machen (z.B. abgelaufen oder Secret geändert)
    const context = page.context();
    const session = (await context.cookies(API_BASE_URL)).find((c) => c.name === 'gartenai_session');
    expect(session?.httpOnly).toBe(true);
    const [header, payload] = session!.value.split('.');
    await context.addCookies([{ ...session!, value: `${header}.${payload}.ungueltige-signatur` }]);
    await page.goto('/projekte');

    await expect(page).toHaveURL('/login');
    await expect(page.getByTestId('login-session-expired')).toBeVisible();
  });

  test('das Token ist für JavaScript nicht erreichbar, Abmelden beendet die Sitzung', async ({ page }) => {
    await loginViaUi(page);
    const visible = await page.evaluate(() => ({
      cookies: document.cookie,
      storage: Object.keys(localStorage).filter((k) => k.includes('token')),
    }));
    expect(visible.cookies).not.toContain('gartenai_session');
    expect(visible.storage).toEqual([]);

    // Nach dem Neuladen bleibt man angemeldet (Sitzung aus dem Cookie)
    await page.reload();
    await expect(page.getByRole('heading', { name: 'Mein Tag' })).toBeVisible();

    await page.getByTestId('nav-logout').click();
    await expect(page).toHaveURL('/login');
    await expect(page.getByTestId('login-session-expired')).toHaveCount(0);
    await page.goto('/projekte');
    await expect(page).toHaveURL('/login');
  });
});

// Ersteinrichtung (Mini-Vollversion): Der Server wird hier gespielt, weil die
// E2E-Datenbank schon Nutzer hat. Nach der Einrichtung meldet sich die App mit
// dem neuen Zugang an (umgeleitet auf den Zugang aus dem Seed).
test.describe('Ersteinrichtung', () => {
  test('Firma und Zugang anlegen, danach angemeldet', async ({ page }) => {
    let sent: Record<string, string> | null = null;
    await page.route('**/setup/status', (route) => route.fulfill({ json: { needed: true } }));
    await page.route('**/setup', async (route) => {
      sent = route.request().postDataJSON();
      await route.fulfill({ status: 201, json: { email: SEED.email } });
    });
    let loginWith: Record<string, string> | null = null;
    await page.route('**/auth/login', async (route) => {
      loginWith = route.request().postDataJSON();
      await route.continue({ postData: JSON.stringify({ email: SEED.email, password: SEED.password }) });
    });
    await page.goto('/login');
    const form = page.getByTestId('first-setup');
    await form.getByTestId('setup-code').fill('AB12-CD34');
    await form.getByTestId('setup-companyName').fill('Grün & Stein GmbH');
    await form.getByTestId('setup-firstName').fill('Clara');
    await form.getByTestId('setup-lastName').fill('Stein');
    await form.getByTestId('setup-email').fill(SEED.email);
    await form.getByTestId('setup-password').fill('ein-langes-passwort');
    await form.getByTestId('setup-repeat').fill('ein-anderes-passwort');
    await form.getByTestId('setup-submit').click();
    await expect(form.getByTestId('setup-error')).toHaveText('Die Passwörter stimmen nicht überein.');
    expect(sent).toBeNull();

    await form.getByTestId('setup-repeat').fill('ein-langes-passwort');
    await form.getByTestId('setup-submit').click();
    await expect(page.getByRole('heading', { name: 'Mein Tag' })).toBeVisible();
    expect(sent).toMatchObject({ code: 'AB12-CD34', companyName: 'Grün & Stein GmbH', email: SEED.email });
    expect(sent).not.toHaveProperty('repeat');
    expect(loginWith).toEqual({ email: SEED.email, password: 'ein-langes-passwort' });
  });
});
