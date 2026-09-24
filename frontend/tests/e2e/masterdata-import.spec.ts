import { test, expect } from '@playwright/test';
import { API_BASE_URL, apiLogin, loginViaUi } from './fixtures';

test.describe('Stammdaten-Import', () => {
  test('Lieferanten aus eingefügtem Text: Zuordnung, Vorschau, Auswahl, Übernahme', async ({
    page,
    request,
  }) => {
    // zufällig genug, dass frühere Läufe nicht als ähnliche Namen gelten
    const run = Math.random().toString(36).slice(2, 12);
    const token = await apiLogin(request);
    const headers = { Authorization: `Bearer ${token}` };
    // ein Lieferant existiert schon
    await request.post(`${API_BASE_URL}/suppliers`, {
      headers,
      data: { name: `Baustoff Nord ${run}`, email: `alt${run}@nord.example` },
    });

    await loginViaUi(page);
    await page.getByTestId('nav-masterdata').click();
    await page.getByTestId('tab-import').click();
    await page
      .getByTestId('import-text')
      .fill(
        [
          'Lieferant\tMail\tTelefon',
          `Baustoff Nord ${run}\tneu${run}@nord.example\t0221 12`,
          `Pflanzen Süd ${run}\t\t089 34`,
          `Kaputt ${run}\tkeine-mail\t`,
        ].join('\n'),
      );
    await page.getByTestId('import-text-read').click();

    // als Lieferanten erkannt, E-Mail-Spalte von Hand zuordnen
    await expect(page.getByTestId('import-entity-suppliers')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.getByTestId('import-map-name')).toHaveValue('Lieferant');
    await page.getByTestId('import-map-email').selectOption('Mail');

    const preview = page.getByTestId('import-preview');
    await expect(preview.getByTestId('import-row')).toHaveCount(3);
    await expect(preview.locator('[data-status="update"]')).toContainText(`neu${run}@nord.example`);
    await expect(preview.locator('[data-status="new"]')).toContainText(`Pflanzen Süd ${run}`);
    await expect(preview.locator('[data-status="invalid"]')).toContainText('keine E-Mail-Adresse');
    await expect(page.getByTestId('import-apply')).toHaveText('2 Einträge übernehmen');

    // nur den neuen übernehmen
    await preview.locator('[data-status="update"] input[type="checkbox"]').uncheck();
    await page.getByTestId('import-apply').click();
    await expect(page.getByTestId('import-result')).toContainText('1 neu, 0 geändert');

    const suppliers = await (await request.get(`${API_BASE_URL}/suppliers`, { headers })).json();
    const list = (Array.isArray(suppliers) ? suppliers : suppliers.items) as {
      name: string;
      email: string | null;
    }[];
    expect(list.find((s) => s.name === `Pflanzen Süd ${run}`)).toBeTruthy();
    expect(list.find((s) => s.name === `Baustoff Nord ${run}`)?.email).toBe(`alt${run}@nord.example`);
  });
});
