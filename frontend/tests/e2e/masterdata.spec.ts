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

  test('ändert den Einkaufspreis eines Artikels', async ({ page }) => {
    const articleNumber = `E2E-EDIT-${Date.now()}`;
    await page.getByTestId('article-number').fill(articleNumber);
    await page.getByTestId('article-name').fill('Zu ändern');
    await page.getByTestId('article-unit').fill('Sack');
    await page.getByTestId('article-purchase-price').fill('4.00');
    await page.getByTestId('article-sale-price').fill('6.00');
    await page.getByTestId('article-submit').click();

    const item = page.getByTestId('article-item').filter({ hasText: articleNumber });
    await item.getByTestId('article-edit').click();
    await item.getByTestId('article-purchasePrice').fill('4,75');
    await item.getByTestId('article-save').click();
    await expect(item).toContainText('EK 4,75 €');
  });
});

test.describe('Stammdaten – Leistungen mit Rezeptur', () => {
  test('legt eine Leistung mit Arbeitszeit an und entfernt den Bestandteil wieder', async ({ page }) => {
    const name = `E2E-Leistung ${Date.now()}`;
    await loginViaUi(page);
    await page.getByTestId('nav-masterdata').click();
    await page.getByTestId('tab-services').click();

    await page.getByTestId('service-new-name').fill(name);
    await page.getByTestId('service-new-unit').fill('m2');
    await page.getByTestId('service-new-submit').click();

    const card = page.getByTestId('service-card').filter({ hasText: name });
    await expect(card).toContainText('Noch keine Bestandteile.');
    await card.getByTestId('component-amount').fill('12');
    await card.getByTestId('component-add').click();
    await expect(card.getByTestId('service-component')).toHaveText(/12 Min\. Arbeitszeit/);

    await card.getByTestId('service-component-remove').click();
    await expect(card).toContainText('Noch keine Bestandteile.');
  });
});
