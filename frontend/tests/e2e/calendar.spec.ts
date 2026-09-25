import { test, expect } from '@playwright/test';
import { API_BASE_URL, apiLogin, loginViaUi, SEED } from './fixtures';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test.describe('Kalender', () => {
  test('Firmentermin anlegen, Einsatz sehen und Ebenen ausblenden', async ({ page, request }) => {
    const run = String(Date.now()).slice(-6);
    const token = await apiLogin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const start = new Date();
    start.setHours(10, 0, 0, 0);
    const appointment = await request.post(`${API_BASE_URL}/appointments`, {
      headers,
      data: { projectId: SEED.projectId, title: `Einsatz ${run}`, startTime: start.toISOString() },
    });
    expect(appointment.ok()).toBeTruthy();
    const { id } = await appointment.json();

    try {
      await loginViaUi(page);
      await page.getByTestId('nav-calendar').click();
      await expect(page.getByTestId('calendar-grid')).toBeVisible();
      const today = page.locator(`[data-testid="calendar-day"][data-day="${iso(new Date())}"]`);
      await today.click();
      const panel = page.getByTestId('calendar-panel');
      await expect(panel.getByText(`Einsatz ${run}`)).toBeVisible();

      await page.getByTestId('calendar-title').fill(`Betriebsfeier ${run}`);
      await page.getByTestId('calendar-scope').selectOption('company');
      await page.getByTestId('calendar-allday').check();
      await page.getByTestId('calendar-save').click();
      await expect(panel.getByText(`Betriebsfeier ${run}`)).toBeVisible();
      await expect(today.getByText(`Betriebsfeier ${run}`)).toBeVisible();

      // Ebene Baustellen ausblenden: der Einsatz verschwindet, der Firmentermin bleibt
      await page.getByTestId('calendar-layer-site').uncheck();
      await expect(panel.getByText(`Einsatz ${run}`)).toHaveCount(0);
      await expect(panel.getByText(`Betriebsfeier ${run}`)).toBeVisible();

      page.once('dialog', (d) => void d.accept());
      await panel.getByRole('button', { name: 'Löschen' }).click();
      await expect(panel.getByText(`Betriebsfeier ${run}`)).toHaveCount(0);
    } finally {
      await request.patch(`${API_BASE_URL}/appointments/${id}/status`, {
        headers,
        data: { status: 'cancelled' },
      });
    }
  });
});
