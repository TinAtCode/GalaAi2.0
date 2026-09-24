import { test, expect } from '@playwright/test';
import { ChildProcess, spawn } from 'node:child_process';
import { SEED } from './fixtures';

// Die App ohne Netz neu öffnen – mit dem fertigen Build und dem echten Service
// Worker (im Entwicklungsserver ist er aus). Der Test startet die Vorschau
// selbst und stoppt sie dann: so ist der Server wirklich weg.
// Läuft nur mit E2E_PWA=1 nach `npm run build` (siehe .github/workflows/ci-e2e.yml).
const PORT = 4173;
const BASE = `http://localhost:${PORT}`;

function startPreview(): ChildProcess {
  return spawn('npx', ['vite', 'preview', '--port', String(PORT), '--strictPort'], {
    stdio: 'ignore',
    detached: true,
  });
}
async function waitFor(up: boolean) {
  for (let i = 0; i < 60; i++) {
    const ok = await fetch(BASE).then(
      (r) => r.ok,
      () => false,
    );
    if (ok === up) return;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Vorschau ${up ? 'startet nicht' : 'endet nicht'}`);
}

test.describe('App ohne Netz', () => {
  test.skip(!process.env.E2E_PWA, 'nur mit fertigem Build (E2E_PWA=1)');
  let preview: ChildProcess | undefined;
  test.afterEach(() => {
    if (preview?.pid) process.kill(-preview.pid);
  });

  test('startet ohne Server, auch nachgeladene Seiten', async ({ page }) => {
    preview = startPreview();
    await waitFor(true);
    await page.goto(`${BASE}/login`);
    await page.getByTestId('login-email').fill(SEED.email);
    await page.getByTestId('login-password').fill(SEED.password);
    await page.getByTestId('login-submit').click();
    await expect(page.getByTestId('nav-site')).toBeVisible();

    // der Service Worker hat alle Dateien der Version gespeichert
    await page.evaluate(() => navigator.serviceWorker.ready);
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const cache = await caches.open((await caches.keys())[0]);
          return (await cache.keys()).some((r) => r.url.includes('/assets/FinancePage-'));
        }),
      )
      .toBe(true);

    process.kill(-preview.pid!);
    preview = undefined;
    await waitFor(false);

    // neu öffnen: Hauptseite und eine Seite, die vorher nie aufgerufen wurde
    await page.goto(`${BASE}/`);
    await expect(page.getByTestId('nav-site')).toBeVisible();
    await page.goto(`${BASE}/finanzen`);
    await expect(page.getByRole('heading', { level: 2, name: 'Finanzen' })).toBeVisible();
  });

  // Den Versand über Google/Mozilla/Apple kann der Testbrowser nicht; geprüft
  // wird, dass der Service Worker eine ankommende Nachricht richtig anzeigt.
  test('Push-Nachricht: der Service Worker zeigt sie an', async ({ page, context }) => {
    preview = startPreview();
    await waitFor(true);
    await context.grantPermissions(['notifications'], { origin: BASE });
    await page.goto(`${BASE}/login`);
    await page.evaluate(() => navigator.serviceWorker.ready);
    const cdp = await context.newCDPSession(page);
    const registrationId = new Promise<string>((resolve) => {
      cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
        const found = registrations.find((r: { scopeURL: string }) => r.scopeURL.startsWith(BASE));
        if (found) resolve(found.registrationId);
      });
    });
    await cdp.send('ServiceWorker.enable');
    await cdp.send('ServiceWorker.deliverPushMessage', {
      origin: BASE,
      registrationId: await registrationId,
      data: JSON.stringify({
        title: 'Neuer Termin',
        body: 'Mo 9:00 Uhr: Hecke',
        url: '/baustelle',
        tag: 't1',
      }),
    });
    await expect
      .poll(() =>
        page.evaluate(async () => {
          const reg = await navigator.serviceWorker.ready;
          return (await reg.getNotifications()).map((n) => `${n.title}|${n.body}|${n.tag}`);
        }),
      )
      .toEqual(['Neuer Termin|Mo 9:00 Uhr: Hecke|t1']);
  });
});
