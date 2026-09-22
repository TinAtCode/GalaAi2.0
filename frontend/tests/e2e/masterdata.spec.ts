import { test, expect } from '@playwright/test';
import { loginViaUi } from './fixtures';

test.describe('Stammdaten – Artikel', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUi(page);
    await page.getByTestId('nav-masterdata').click();
    await expect(page).toHaveURL('/stammdaten');
  });

  test('Artikel-Tab ist standardmäßig aktiv und zeigt die Seed-Artikel', async ({ page }) => {
    await expect(page.getByTestId('tab-articles')).toHaveClass(/active/);
    await expect(page.getByTestId('article-item').first()).toBeVisible();
  });

  test('legt einen neuen Artikel an und er erscheint sofort in der Liste', async ({ page }) => {
    const articleNumber = `E2E-${Date.now()}`;

    await page.getByTestId('article-number').fill(articleNumber);
    await page.getByTestId('article-name').fill('E2E-Testartikel');
    await page.getByTestId('article-unit').fill('Stk');
    await page.getByTestId('article-purchase-price').fill('1.50');
    await page.getByTestId('article-sale-price').fill('2.90');
    await page.getByTestId('article-submit').click();

    await expect(page.getByTestId('article-item').filter({ hasText: articleNumber })).toBeVisible();
  });

  test('wechselt zwischen den Tabs Artikel/Lieferanten/Maschinen', async ({ page }) => {
    await page.getByTestId('tab-suppliers').click();
    await expect(page.getByTestId('tab-suppliers')).toHaveClass(/active/);
    await expect(page.getByTestId('tab-articles')).not.toHaveClass(/active/);

    await page.getByTestId('tab-machines').click();
    await expect(page.getByTestId('tab-machines')).toHaveClass(/active/);
  });
});
