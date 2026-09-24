import { test, expect, Page } from '@playwright/test';
import { API_BASE_URL, apiLogin, loginViaUi, SEED } from './fixtures';

async function clickAt(page: Page, x: number, y: number) {
  const box = (await page.getByTestId('plan-canvas').boundingBox())!;
  await page.mouse.click(box.x + x, box.y + y);
}

// Leitung mit exakter Länge zeichnen (Richtung: nach rechts)
async function drawPipe(page: Page, meters: string, y: number) {
  const box = (await page.getByTestId('plan-canvas').boundingBox())!;
  await page.getByTestId('plan-tool-rainwater').click();
  await clickAt(page, 80, y);
  await page.mouse.move(box.x + 400, box.y + y);
  await page.getByTestId('plan-length-entry').fill(meters);
  await page.getByTestId('plan-length-entry').press('Enter');
  await page.getByTestId('plan-finish').click();
  await page.getByTestId('plan-tool-select').click();
}

test.describe('Aufmaß offline', () => {
  test('ohne Netz ändern und speichern, danach automatisch übertragen; Konflikt lösen', async ({
    page,
    context,
    request,
  }) => {
    const run = String(Date.now()).slice(-6);
    const token = await apiLogin(request);
    const headers = { Authorization: `Bearer ${token}` };
    await loginViaUi(page);
    await page.goto(`/projekte/${SEED.projectId}`);
    await page.getByTestId('plan-new-name').fill(`Baustelle ${run}`);
    await page.getByTestId('plan-create').click();
    await expect(page.getByTestId('plan-editor')).toBeVisible();
    const planId = page.url().split('/').pop()!;
    const quantities = page.getByTestId('plan-quantities');
    const state = page.getByTestId('plan-state');

    // online zeichnen und speichern -> liegt auch auf dem Gerät
    await drawPipe(page, '10', 120);
    await page.getByTestId('plan-save').click();
    await expect(state).toHaveText('gespeichert');

    // Netz weg: weiterzeichnen und speichern
    await context.setOffline(true);
    await expect(page.getByTestId('offline-banner')).toContainText('Keine Verbindung');
    await drawPipe(page, '5', 220);
    await expect(quantities).toContainText('Regenwasser15,00 m');
    await page.getByTestId('plan-save').click();
    await expect(state).toHaveText('auf dem Gerät gespeichert');
    await expect(page.getByTestId('offline-banner')).toContainText('1 Planänderung warten');

    // Offline-Pläne: der Plan wartet; wieder öffnen (vom Gerät)
    await page.getByTestId('nav-offline').click();
    const item = page.getByTestId('offline-plan').filter({ hasText: `Baustelle ${run}` });
    await expect(item).toContainText('wartet');
    await item.click();
    await expect(page.getByTestId('plan-offline')).toBeVisible();
    await expect(quantities).toContainText('Regenwasser15,00 m');

    // Netz wieder da: wird übertragen
    await context.setOffline(false);
    await expect(state).toHaveText('gespeichert');
    await expect(page.getByTestId('offline-banner')).toHaveCount(0);
    const saved = await (await request.get(`${API_BASE_URL}/plans/${planId}`, { headers })).json();
    expect(saved.objects).toHaveLength(2);

    // Konflikt: offline ändern, während jemand anderes den Plan speichert
    await page.reload();
    await expect(quantities).toContainText('Regenwasser15,00 m');
    await context.setOffline(true);
    await drawPipe(page, '3', 320);
    await page.getByTestId('plan-save').click();
    await expect(state).toHaveText('auf dem Gerät gespeichert');
    const other = await request.put(`${API_BASE_URL}/plans/${planId}`, {
      headers,
      data: { version: saved.version, name: `Baustelle ${run} (Büro)` },
    });
    expect(other.ok()).toBeTruthy();
    await context.setOffline(false);
    await expect(page.getByTestId('plan-conflict')).toBeVisible();
    await expect(state).toHaveText('Konflikt');
    await page.getByTestId('plan-conflict-keep').click();
    await expect(page.getByTestId('plan-conflict')).toHaveCount(0);
    await expect(state).toHaveText('gespeichert');
    const final = await (await request.get(`${API_BASE_URL}/plans/${planId}`, { headers })).json();
    expect(final.objects).toHaveLength(3);

    // aufräumen
    await request.delete(`${API_BASE_URL}/plans/${planId}`, { headers });
  });
});
