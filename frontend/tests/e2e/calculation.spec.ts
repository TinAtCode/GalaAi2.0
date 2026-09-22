import { test, expect } from '@playwright/test';
import { loginViaUi } from './fixtures';

test.describe('Kalkulation', () => {
  test.beforeEach(async ({ page }) => {
    await loginViaUi(page);
  });

  test('berechnet einen Verkaufspreis für die Seed-Dienstleistung', async ({ page }) => {
    await page.getByTestId('nav-calculation').click();
    await expect(page).toHaveURL('/kalkulation');

    await page.getByTestId('calc-quantity').fill('10');
    await page.getByTestId('calc-submit').click();

    const result = page.getByTestId('calc-result');
    await expect(result).toBeVisible();
    // Verkaufspreis muss als konkreter Euro-Betrag auftauchen (Admin sieht
    // alle Preisfelder, siehe Preisrechte-Tests im Backend).
    await expect(result).toContainText('€');
  });

  test('lehnt eine Menge von 0 client-seitig ab (HTML5-Validierung, min=0.01)', async ({ page }) => {
    await page.getByTestId('nav-calculation').click();
    const quantityInput = page.getByTestId('calc-quantity');
    await quantityInput.fill('0');

    const isValid = await quantityInput.evaluate((el: HTMLInputElement) => el.checkValidity());
    expect(isValid).toBe(false);
  });
});
