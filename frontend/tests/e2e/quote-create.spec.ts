import { test, expect } from '@playwright/test';
import { SEED, loginViaUi } from './fixtures';

// Angebot direkt in der Projektansicht anlegen: Leistung aus dem Katalog,
// Menge eingeben – die Preise rechnet das Backend aus der Rezeptur.
test.describe('Angebot anlegen (Projekt-Detail)', () => {
  test('Angebot mit zwei Positionen und § 13b anlegen', async ({ page }) => {
    await loginViaUi(page);
    await page.goto(`/projekte/${SEED.projectId}`);

    await page.getByTestId('quote-new').click();
    const form = page.getByTestId('quote-form');
    await form.getByTestId('quote-line-quantity').first().fill('12,5');
    await form.getByTestId('quote-line-add').click();
    await form.getByTestId('quote-line-quantity').nth(1).fill('3');
    await form.getByTestId('quote-reverse-charge').check();

    const [response] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/quotes') && r.request().method() === 'POST'),
      form.getByTestId('quote-submit').click(),
    ]);
    expect(response.status()).toBe(201);
    const quote = await response.json();
    expect(quote.lineItems).toHaveLength(2);
    expect(quote.vatTreatment).toBe('reverse_charge');
    expect(Number(quote.lineItems[0].quantity)).toBe(12.5);

    // Formular schließt sich, das neue Angebot erscheint als Entwurf mit Nummer
    await expect(page.getByTestId('quote-form')).toHaveCount(0);
    const card = page.locator(`[data-testid="quote-card"][data-quote-id="${quote.id}"]`);
    await expect(card.getByTestId('quote-status')).toHaveText('Entwurf');
    await expect(card.getByTestId('quote-number')).toHaveText(quote.number);
    await expect(card).toContainText('§ 13b UStG');
  });

  test('ohne gültige Menge wird nichts angelegt', async ({ page }) => {
    await loginViaUi(page);
    await page.goto(`/projekte/${SEED.projectId}`);
    await page.getByTestId('quote-new').click();
    const form = page.getByTestId('quote-form');
    await form.getByTestId('quote-line-quantity').first().fill('0');
    await form.getByTestId('quote-submit').click();
    await expect(form.locator('.field-error')).toContainText('Menge größer 0');
  });
});
