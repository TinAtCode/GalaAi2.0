import { test, expect } from '@playwright/test';
import { API_BASE_URL, apiLogin, loginViaUi, SEED } from './fixtures';

// kleinstes gültiges PNG (1×1)
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

test.describe('Baustelle', () => {
  test('Termin morgen, Nachricht, Foto, ohne Netz senden, Büro sieht es, erledigt', async ({
    page,
    context,
    request,
  }) => {
    const run = Math.random().toString(36).slice(2, 8);
    const token = await apiLogin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const me = await (await request.get(`${API_BASE_URL}/auth/me`, { headers })).json();
    // morgen um 5 Uhr (morgens früh: stört andere Tests nicht)
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    tomorrow.setHours(5, 0, 0, 0);
    const created = await request.post(`${API_BASE_URL}/appointments`, {
      headers,
      data: {
        projectId: SEED.projectId,
        title: `Hecke ${run}`,
        startTime: tomorrow.toISOString(),
        endTime: new Date(tomorrow.getTime() + 3_600_000).toISOString(),
        assignedUserId: me.id,
      },
    });
    expect(created.ok()).toBeTruthy();
    const appointment = await created.json();
    try {
      await loginViaUi(page);
      await page.getByTestId('nav-site').click();
      await page.getByTestId('site-tomorrow').click();
      const card = page.getByTestId('site-appointment').filter({ hasText: `Hecke ${run}` });
      await expect(card).toBeVisible();
      await expect(card.locator('.site-address')).toHaveAttribute('href', /google\.com\/maps\/dir/);

      // Fotos & Nachrichten
      await card.getByTestId('site-open').click();
      await page.getByTestId('site-text').fill(`Bin da ${run}`);
      await page.getByTestId('site-send').click();
      await expect(page.getByTestId('site-message').filter({ hasText: `Bin da ${run}` })).toBeVisible();
      await page
        .getByTestId('site-photo-input')
        .setInputFiles({ name: 'hecke.png', mimeType: 'image/png', buffer: PNG });
      await expect(page.getByTestId('site-photo').last()).toBeVisible();

      // ohne Netz: wartet auf dem Gerät, danach automatisch übertragen
      await context.setOffline(true);
      await page.getByTestId('site-text').fill(`Offline ${run}`);
      await page.getByTestId('site-send').click();
      await expect(page.getByTestId('site-pending')).toContainText('wartet auf Netz');
      await context.setOffline(false);
      await expect(page.getByTestId('site-pending')).toHaveCount(0);
      await expect(page.getByTestId('site-message').filter({ hasText: `Offline ${run}` })).toHaveCount(1);

      // das Büro sieht alles am Projekt
      await page.goto(`/projekte/${SEED.projectId}`);
      const office = page.locator('#baustelle');
      await expect(office.getByTestId('site-message').filter({ hasText: `Offline ${run}` })).toBeVisible();

      // Termin erledigt. Die Antwort für heute kommt absichtlich zu spät: sie darf
      // den inzwischen gewählten Tag (morgen) nicht überschreiben
      const today = new Date();
      const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
      await page.route(`**/site/today?date=${todayKey}`, async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        await route.continue();
      });
      const lateToday = page.waitForResponse((r) => r.url().includes(`/site/today?date=${todayKey}`));
      await page.goto('/baustelle');
      await page.getByTestId('site-tomorrow').click();
      await lateToday;
      await card.getByTestId('site-done').click();
      await expect(card).toContainText('Erledigt');
    } finally {
      // aufräumen, auch wenn der Test scheitert (sonst überschneidet sich der Termin beim nächsten Versuch)
      await request.patch(`${API_BASE_URL}/appointments/${appointment.id}/status`, {
        headers,
        data: { status: 'cancelled' },
      });
    }
  });
});
