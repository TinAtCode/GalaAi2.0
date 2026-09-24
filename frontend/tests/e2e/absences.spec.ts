import { test, expect } from '@playwright/test';
import { API_BASE_URL, apiLogin, loginViaUi, SEED } from './fixtures';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Abwesenheit in der Plantafel eintragen (übernächste Woche, stört andere Tests nicht)
test.describe('Abwesenheiten', () => {
  test('Urlaub eintragen, in der Plantafel sehen, Termin an dem Tag abgelehnt', async ({ page, request }) => {
    const token = await apiLogin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const me = await (await request.get(`${API_BASE_URL}/auth/me`, { headers })).json();
    const monday = new Date();
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + 14);
    const wednesday = new Date(monday);
    wednesday.setDate(monday.getDate() + 2);
    const thursday = new Date(monday);
    thursday.setDate(monday.getDate() + 3);
    // Reste früherer Läufe entfernen
    const old = await (
      await request.get(`${API_BASE_URL}/absences?from=${iso(monday)}&to=${iso(thursday)}`, { headers })
    ).json();
    for (const a of old) await request.delete(`${API_BASE_URL}/absences/${a.id}`, { headers });

    try {
      await loginViaUi(page);
      await page.getByTestId('nav-board').click();
      await page.getByTestId('board-next').click();
      await page.getByTestId('board-next').click();
      await page.getByTestId('absence-open').click();
      const dialog = page.getByTestId('absence-dialog');
      await dialog.getByTestId('absence-user').selectOption(me.id);
      await dialog.getByTestId('absence-kind').selectOption('vacation');
      await dialog.getByTestId('absence-from').fill(iso(wednesday));
      await dialog.getByTestId('absence-to').fill(iso(thursday));
      await dialog.getByTestId('absence-save').click();
      await expect(page.getByTestId('board-notice')).toContainText('Abwesenheit eingetragen');
      const row = page.locator(`[data-testid="board-row"][data-row="${me.id}"]`);
      await expect(row.locator(`[data-day="${iso(wednesday)}"]`).getByTestId('board-absence')).toHaveText(
        /Urlaub/,
      );
      await expect(row.locator(`[data-day="${iso(thursday)}"]`).getByTestId('board-absence')).toBeVisible();

      const start = new Date(wednesday);
      start.setHours(9, 0, 0, 0);
      const blocked = await request.post(`${API_BASE_URL}/appointments`, {
        headers,
        data: {
          projectId: SEED.projectId,
          title: 'Im Urlaub',
          startTime: start.toISOString(),
          assignedUserId: me.id,
        },
      });
      expect(blocked.status()).toBe(400);
      expect((await blocked.json()).message).toContain('abwesend');
    } finally {
      const left = await (
        await request.get(`${API_BASE_URL}/absences?from=${iso(monday)}&to=${iso(thursday)}`, { headers })
      ).json();
      for (const a of left) await request.delete(`${API_BASE_URL}/absences/${a.id}`, { headers });
    }
  });
});
