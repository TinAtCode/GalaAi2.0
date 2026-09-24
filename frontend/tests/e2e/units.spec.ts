import { test, expect } from '@playwright/test';
import { SEED, loginViaUi } from './fixtures';

// Einheiten & Rundung: eigene Einheit mit Rundung anlegen, im Angebot
// verwenden (gerundet, genaue Menge sichtbar), Rundung je Position.
// Ändert nur eine eigene Einheit – andere Tests bleiben unberührt.
test.describe('Einheiten und Rundung', () => {
  test('eigene Einheit aufrunden, Rundung je Position im Angebot', async ({ page }) => {
    const code = `Rl${String(Date.now()).slice(-5)}`;
    await loginViaUi(page);
    await page.getByTestId('nav-masterdata').click();
    await page.getByTestId('tab-units').click();
    const tab = page.getByTestId('units-tab');
    await expect(tab.locator('[data-testid="unit-row"][data-code="Stk"]')).toContainText('ganze');

    await tab.getByTestId('unit-new-code').fill(code);
    await tab.getByTestId('unit-new-label').fill('Rolle Vlies');
    await tab.getByTestId('unit-new-submit').click();
    const row = tab.locator(`[data-testid="unit-row"][data-code="${code}"]`);
    await expect(row).toContainText('eigene Einheit');
    await row.getByTestId('unit-edit').click();
    await row.getByTestId('unit-decimals').selectOption('0');
    await row.getByTestId('unit-mode').selectOption('up');
    await row.getByTestId('unit-save').click();
    await expect(row).toContainText('ganze, aufrunden (angepasst)');

    // Angebot: freie Position in der eigenen Einheit, Katalog-Leistung genau
    await page.goto(`/projekte/${SEED.projectId}`);
    await page.getByTestId('quote-new').click();
    const form = page.getByTestId('quote-form');
    await form.getByTestId('quote-line-quantity').first().fill('1,125');
    await form.getByTestId('quote-line-rounding').first().selectOption('3|half_up');
    await form.getByTestId('quote-free-add').click();
    const free = form.getByTestId('quote-free-line');
    await free.getByTestId('quote-free-description').fill('Unkrautvlies');
    await free.getByTestId('quote-free-unit').fill(code);
    await free.getByTestId('quote-free-quantity').fill('2,2');
    await free.getByTestId('quote-free-price').fill('40');
    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/quotes') && r.request().method() === 'POST'),
      form.getByTestId('quote-submit').click(),
    ]);
    expect(response.status()).toBe(201);
    const quote = await response.json();
    const card = page.locator(`[data-testid="quote-card"][data-quote-id="${quote.id}"]`);
    const lines = card.getByTestId('quote-line');
    await expect(lines.nth(0)).toContainText('(1,125 ');
    await expect(lines.nth(1)).toContainText(`Unkrautvlies (3 ${code})`);
    await expect(lines.nth(1).getByTestId('quote-line-exact')).toHaveText(` · genau 2,2 ${code}`);

    // aufräumen: eigene Einheit entfernen
    await page.getByTestId('nav-masterdata').click();
    await page.getByTestId('tab-units').click();
    await row.getByTestId('unit-reset').click();
    await expect(row).toHaveCount(0);
  });
});
