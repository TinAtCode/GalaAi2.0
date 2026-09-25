import { test, expect, Page, BrowserContext } from '@playwright/test';

// Checkliste BUERO-TEST.md im Browser, gegen eine frisch mit
// ops/buero/start.sh gestartete Installation (ops/tests/buero-smoke.sh).
// Die Schritte bauen aufeinander auf (erst einrichten, dann anmelden …).
const CODE = process.env.BUERO_SETUP_CODE ?? '';
const CHEF = {
  email: process.env.BUERO_EMAIL ?? 'clara@gruen-stein.de',
  password: process.env.BUERO_PASSWORD ?? 'ein-langes-passwort',
};
const TEAM_PASSWORD = 'startpasswort-123';
const TEAM = [
  { role: 'Buchhaltung', email: 'buchhaltung@gruen-stein.de' },
  { role: 'Einsatzplaner', email: 'planung@gruen-stein.de' },
  { role: 'Mitarbeiter', email: 'mitarbeiter@gruen-stein.de' },
];
// alle Bereiche der Navigation (AppShell NAV_ITEMS)
const PAGES = [
  '/',
  '/baustelle',
  '/projekte',
  '/kunden',
  '/kalender',
  '/plantafel',
  '/vertraege',
  '/geraete',
  '/checklisten',
  '/offline',
  '/kalkulation',
  '/lieferscheine',
  '/stammdaten',
  '/offene-posten',
  '/bankabgleich',
  '/finanzen',
  '/team',
  '/einstellungen',
];

async function login(page: Page, email: string, password: string) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill(password);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL('/');
}

// Fehler im Browser und Server-Fehler der Schnittstelle mitschreiben
function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(`${page.url()}: ${error.message}`));
  page.on('response', (response) => {
    if (response.url().includes('/api/') && response.status() >= 500)
      errors.push(`${response.status()} ${response.request().method()} ${response.url()}`);
  });
  return errors;
}

// eine Sitzung für alle Schritte des Chefs – wie im Büro, und unter der
// Anmeldesperre (5 Versuche je Konto und Minute)
test.describe.configure({ mode: 'serial' });
let context: BrowserContext;
let page: Page;
let errors: string[];
test.beforeAll(async ({ browser }) => {
  context = await browser.newContext();
  page = await context.newPage();
  errors = watchErrors(page);
});
test.afterAll(async () => {
  await context.close();
});

test('B3/B4: Ersteinrichtung nur mit dem richtigen Code, danach angemeldet', async () => {
  expect(CODE, 'BUERO_SETUP_CODE fehlt').toMatch(/^[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  await page.goto('/');
  await expect(page.getByTestId('first-setup')).toBeVisible();
  const fill = async (code: string) => {
    await page.getByTestId('setup-code').fill(code);
    await page.getByTestId('setup-companyName').fill('Grün & Stein GmbH');
    await page.getByTestId('setup-firstName').fill('Clara');
    await page.getByTestId('setup-lastName').fill('Stein');
    await page.getByTestId('setup-email').fill(CHEF.email);
    await page.getByTestId('setup-password').fill(CHEF.password);
    await page.getByTestId('setup-repeat').fill(CHEF.password);
    await page.getByTestId('setup-submit').click();
  };
  await fill('FALS-CH00');
  await expect(page.getByTestId('setup-error')).toContainText('Einrichtungscode stimmt nicht');
  // Kleinbuchstaben zählen auch (Code vom Bildschirm abgetippt)
  await fill(CODE.toLowerCase());
  await expect(page).toHaveURL('/');
  await expect(page.getByTestId('brand')).toBeVisible();
});

test('B5: Sitzung bleibt nach dem Neuladen, Abmelden, falsches Passwort', async () => {
  await page.reload();
  await expect(page.getByTestId('nav-logout')).toBeVisible();
  await page.getByTestId('nav-logout').click();
  await expect(page.getByTestId('login-email')).toBeVisible();
  // Einrichtung ist abgeschlossen: keine zweite
  await expect(page.getByTestId('first-setup')).toHaveCount(0);
  await page.getByTestId('login-email').fill(CHEF.email);
  await page.getByTestId('login-password').fill('falsches-passwort');
  await page.getByTestId('login-submit').click();
  await expect(page.getByTestId('login-error')).toBeVisible();
  await page.getByTestId('login-password').fill(CHEF.password);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL('/');
});

test('B6: Firmenangaben speichern, bleiben nach dem Neuladen', async () => {
  await page.goto('/einstellungen');
  const values: Record<string, string> = {
    street: 'Gartenweg 5',
    postalCode: '04109',
    city: 'Leipzig',
    taxNumber: '231/123/45678',
    iban: 'DE02120300000000202051',
  };
  for (const [key, value] of Object.entries(values)) await page.getByTestId(`company-${key}`).fill(value);
  await page.getByTestId('company-submit').click();
  await expect(page.getByTestId('company-message')).toBeVisible();
  await page.reload();
  for (const [key, value] of Object.entries(values))
    await expect(page.getByTestId(`company-${key}`)).toHaveValue(value);
});

test('B8: Dunkelmodus und Erscheinungsbild bleiben nach dem Neuladen', async () => {
  await page.goto('/einstellungen');
  await page.getByTestId('theme-mode-dark').click();
  await page.getByTestId('look-gartenai').click();
  await page.reload();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await expect(page.locator('html')).toHaveAttribute('data-look', 'gartenai');
  await page.getByTestId('theme-mode-system').click();
  await page.getByTestId('look-gala').click();
});

test('A4: jeder Bereich lädt ohne Fehler – auch ganz ohne Daten', async () => {
  for (const path of PAGES) {
    await page.goto(path);
    await expect(page.locator('main h2').first(), path).toBeVisible();
    await page.waitForLoadState('networkidle');
  }
  expect(errors).toEqual([]);
});

test('B7: Zugänge für Buchhaltung, Einsatzplaner, Mitarbeiter – jeder sieht seins', async () => {
  await page.goto('/einstellungen');
  for (const member of TEAM) {
    await page.getByTestId('user-first-name').fill(member.role);
    await page.getByTestId('user-last-name').fill('Test');
    await page.getByTestId('user-email').fill(member.email);
    await page.getByTestId('user-password').fill(TEAM_PASSWORD);
    await page.getByTestId('user-role').selectOption({ label: member.role });
    await page.getByTestId('user-submit').click();
    await expect(page.getByTestId('user-item').filter({ hasText: member.email })).toBeVisible();
  }
  await page.getByTestId('nav-logout').click();

  const sees = async (email: string, visible: string[], hidden: string[]) => {
    await login(page, email, TEAM_PASSWORD);
    for (const id of visible) await expect(page.getByTestId(id), `${email}: ${id}`).toHaveCount(1);
    for (const id of hidden) await expect(page.getByTestId(id), `${email}: ${id}`).toHaveCount(0);
    await page.getByTestId('nav-logout').click();
  };
  await sees(TEAM[0].email, ['nav-finance', 'nav-open-items'], ['nav-team']);
  await sees(TEAM[1].email, ['nav-board', 'nav-checklists'], ['nav-finance']);
  await sees(TEAM[2].email, ['nav-site', 'nav-projects'], ['nav-finance', 'nav-open-items', 'nav-team']);
});

test('C1–C5: Handy im WLAN – Mitarbeiter, installierbare App, ohne Netz', async ({ browser }) => {
  // Service Worker gibt es nur mit gültigem Zertifikat (Stammzertifikat installiert)
  test.skip(process.env.BUERO_CA_TRUSTED !== '1', 'Stammzertifikat nicht im Browser installiert');
  const mobile = await browser.newContext({
    baseURL: process.env.BUERO_LAN_URL || undefined,
    viewport: { width: 390, height: 844 },
    isMobile: true,
    hasTouch: true,
  });
  const phone = await mobile.newPage();
  const phoneErrors = watchErrors(phone);
  await login(phone, TEAM[2].email, TEAM_PASSWORD);
  await expect(phone.getByTestId('nav-site')).toBeVisible();
  const manifest = await phone.request.get('/manifest.webmanifest');
  expect(manifest.ok()).toBe(true);
  expect((await manifest.json()).display).toBe('standalone');

  // App-Dateien im Service Worker, dann ohne Netz neu öffnen
  await phone.evaluate(() => navigator.serviceWorker.ready);
  await phone.goto('/baustelle');
  await expect(phone.getByRole('heading', { level: 2, name: 'Baustelle' })).toBeVisible();
  await mobile.setOffline(true);
  await phone.reload();
  await expect(phone.getByTestId('offline-banner')).toContainText('Keine Verbindung');
  await expect(phone.getByRole('heading', { level: 2, name: 'Baustelle' })).toBeVisible();
  await mobile.setOffline(false);
  await expect(phone.getByTestId('offline-banner')).toHaveCount(0);
  expect(phoneErrors).toEqual([]);
  await mobile.close();
});
