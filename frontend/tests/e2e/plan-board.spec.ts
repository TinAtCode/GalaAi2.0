import { test, expect } from '@playwright/test';
import { API_BASE_URL, apiLogin, loginViaUi, SEED } from './fixtures';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test.describe('Plantafel', () => {
  test('Termin in der nächsten Woche ziehen und im Dialog ändern', async ({ page, request }) => {
    const run = String(Date.now()).slice(-6);
    const token = await apiLogin(request);
    const headers = { Authorization: `Bearer ${token}` };
    // Montag und Mittwoch der nächsten Woche, 9–11 Uhr, nicht zugeteilt
    const monday = new Date();
    monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7) + 7);
    monday.setHours(9, 0, 0, 0);
    const wednesday = new Date(monday);
    wednesday.setDate(monday.getDate() + 2);
    const created = await request.post(`${API_BASE_URL}/appointments`, {
      headers,
      data: {
        projectId: SEED.projectId,
        title: `Tafel ${run}`,
        startTime: monday.toISOString(),
        endTime: new Date(monday.getTime() + 2 * 3_600_000).toISOString(),
      },
    });
    expect(created.ok()).toBeTruthy();
    const appointment = await created.json();

    try {
      await loginViaUi(page);
      await page.getByTestId('nav-board').click();
      await page.getByTestId('board-next').click();
      const item = page.getByTestId('board-item').filter({ hasText: `Tafel ${run}` });
      await expect(item).toBeVisible();
      const unassigned = page.locator('[data-testid="board-row"][data-row="none"]');
      await expect(unassigned.locator(`[data-day="${iso(monday)}"]`)).toContainText(`Tafel ${run}`);

      // auf Mittwoch ziehen (bleibt nicht zugeteilt, Uhrzeit bleibt)
      // Ziehen mit der Maus ist im Testbrowser nicht immer zuverlässig: notfalls noch einmal
      const target = unassigned.locator(`[data-day="${iso(wednesday)}"]`);
      await expect(async () => {
        if (!(await target.getByText(`Tafel ${run}`).count())) await item.dragTo(target);
        await expect(target).toContainText(`Tafel ${run}`, { timeout: 2000 });
      }).toPass({ timeout: 15_000 });
      await expect(unassigned.locator(`[data-day="${iso(wednesday)}"]`)).toContainText('09:00–11:00');

      // im Dialog: 13 Uhr, sich selbst zuteilen
      await item.click();
      const dialog = page.getByTestId('board-dialog');
      await dialog.locator('input[type="time"]').first().fill('13:00');
      await dialog.locator('input[type="time"]').nth(1).fill('15:30');
      const assignee = dialog.getByTestId('board-dialog-assignee');
      const me = await assignee.locator('option').nth(1).getAttribute('value');
      await assignee.selectOption(me!);
      await dialog.getByTestId('board-dialog-save').click();
      await expect(dialog).toHaveCount(0);
      const mine = page.locator(`[data-testid="board-row"][data-row="${me}"]`);
      await expect(mine.locator(`[data-day="${iso(wednesday)}"]`)).toContainText('13:00–15:30');

      const saved = await (
        await request.get(`${API_BASE_URL}/appointments/by-project/${SEED.projectId}`, { headers })
      ).json();
      const moved = saved.find((a: { id: string }) => a.id === appointment.id);
      expect(moved.assignedUserId).toBe(me);
      expect(new Date(moved.startTime).getDate()).toBe(wednesday.getDate());
    } finally {
      // aufräumen, auch wenn der Test scheitert (sonst liegt der Termin beim nächsten Lauf im Weg)
      await request.patch(`${API_BASE_URL}/appointments/${appointment.id}/status`, {
        headers,
        data: { status: 'cancelled' },
      });
    }
  });
});
