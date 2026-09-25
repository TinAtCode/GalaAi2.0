import { test, expect } from '@playwright/test';
import { loginViaUi } from './fixtures';

// Ein ganzer Auftrag nur über die Oberfläche: Kunde → Objekt → Projekt →
// Angebot → Freigabe → Versand → Annahme → Auftrag → Schlussrechnung →
// Zahlung → offene Posten → Kundenverlauf und Deckungsbeitrag.
for (const [label, viewport] of [
  ['Bildschirm', { width: 1280, height: 720 }],
  ['Handy', { width: 390, height: 844 }],
] as const) {
  test(`Durchstich (${label}): vom neuen Kunden bis zur bezahlten Rechnung`, async ({ page }) => {
    await page.setViewportSize(viewport);
    const run = String(Date.now()).slice(-6);
    const customer = `Familie Durchstich ${run}`;
    // Dialoge (Rückfragen beim Ausstellen o.Ä.) bestätigen
    page.on('dialog', (dialog) => void dialog.accept());

    await loginViaUi(page);
    await page.getByTestId('nav-customers').click();
    await page.getByTestId('customer-new-name').fill(customer);
    await page.getByTestId('customer-new-submit').click();
    await expect(page.getByTestId('customer-heading')).toHaveText(customer);
    await page.getByTestId('customer-street').fill('Lindenweg 3');
    await page.getByTestId('customer-postalCode').fill('50667');
    await page.getByTestId('customer-city').fill('Köln');
    await page.getByTestId('customer-save').click();
    await expect(page.getByTestId('customer-saved')).toBeVisible();

    await page.getByTestId('property-new-label').fill('Vorgarten');
    await page.getByTestId('property-new-city').fill('Köln');
    await page.getByTestId('property-new-submit').click();
    await page.getByTestId('project-new-title').fill(`Pflaster ${run}`);
    await page.getByTestId('project-new-submit').click();
    await expect(page.getByTestId('project-heading')).toHaveText(`Pflaster ${run}`);

    // Angebot mit einer freien Position: 2 × 500 € netto
    await page.getByTestId('quote-new').click();
    const form = page.getByTestId('quote-form');
    // die vorgegebene Katalogzeile erscheint, sobald der Katalog geladen ist – hier nur eine freie Position
    await expect(form.getByTestId('quote-line-quantity').first()).toBeVisible();
    await form.getByTestId('quote-free-add').click();
    const free = form.getByTestId('quote-free-line').last();
    await free.getByTestId('quote-free-description').fill('Pflasterfläche anlegen');
    await free.getByTestId('quote-free-unit').fill('psch');
    await free.getByTestId('quote-free-quantity').fill('2');
    await free.getByTestId('quote-free-price').fill('500');
    await form.getByRole('button', { name: 'Position entfernen' }).first().click();
    await expect(form.getByTestId('quote-line-quantity')).toHaveCount(0);
    const [created] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith('/quotes') && r.request().method() === 'POST'),
      form.getByTestId('quote-submit').click(),
    ]);
    expect(created.status()).toBe(201);
    const quote = await created.json();
    const card = page.locator(`[data-testid="quote-card"][data-quote-id="${quote.id}"]`);
    await expect(card.getByTestId('quote-status')).toHaveText('Entwurf');

    await card.getByTestId('quote-approve').click();
    await expect(card.getByTestId('quote-status')).toHaveText('Freigegeben');
    await card.getByTestId('quote-send').click();
    await expect(card.getByTestId('quote-status')).toHaveText('Versendet');
    await card.getByTestId('quote-accept').click();
    await expect(card.getByTestId('quote-status')).toHaveText('Angenommen');
    await card.getByTestId('quote-create-order').click();
    await expect(page.getByTestId('order-item')).toHaveCount(1);

    // Schlussrechnung aus dem Auftrag, ausstellen
    await page.getByTestId('invoice-new-final').click();
    const invoice = page.getByTestId('invoice-item').first();
    await expect(invoice.getByTestId('invoice-status')).toContainText('Entwurf');
    await invoice.getByTestId('invoice-issue').click();
    await expect(invoice.getByTestId('invoice-number')).not.toBeEmpty();
    await expect(invoice.getByTestId('invoice-open')).toContainText('offen');
    const number = (await invoice.getByTestId('invoice-number').textContent())!.trim();

    // Kundenseite: offener Posten und Verlauf
    await page.getByRole('link', { name: customer }).first().click();
    await expect(page.getByTestId('customer-open-items')).toContainText(number);
    await expect(page.getByTestId('customer-history')).toContainText(number);
    await expect(page.getByTestId('customer-revenue')).toBeVisible();
    await expect(page.getByTestId('customer-acceptance')).toContainText('1 von 1');

    // zurück ins Projekt, komplett bezahlen (Vorschlag = offener Betrag)
    await page.getByTestId('customer-open-item').first().click();
    const paid = page.getByTestId('invoice-item').first();
    await paid.getByTestId('invoice-payment').click();
    await paid.getByTestId('payment-submit').click();
    await expect(paid.getByTestId('invoice-open')).toContainText('bezahlt');

    // Nachkalkulation: Umsatz ist die Rechnung netto
    const margin = page.getByTestId('postcalc-margin');
    await expect(margin).toContainText('Deckungsbeitrag');
    await expect(margin).toContainText('Umsatz (Rechnungen netto)');

    // offene Posten: diese Rechnung ist weg
    await page.getByTestId('nav-open-items').click();
    await expect(page.getByTestId('open-items-summary')).toBeVisible();
    await expect(page.getByText(number, { exact: false })).toHaveCount(0);
  });
}
