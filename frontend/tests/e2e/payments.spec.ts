import { test, expect } from '@playwright/test';
import { API_BASE_URL, SEED, apiLogin, createDraftQuote, loginViaUi } from './fixtures';

// Zahlungseingang an der Rechnung erfassen, offene Posten prüfen, Rest zahlen.
test.describe('Zahlungen und offene Posten', () => {
  test('Teilzahlung buchen, in den offenen Posten sehen, Rest begleichen', async ({ page, request }) => {
    // Arrange per API: Firmendaten und eine ausgestellte Schlussrechnung
    const token = await apiLogin(request);
    const headers = { Authorization: `Bearer ${token}` };
    await request.patch(`${API_BASE_URL}/company/settings`, {
      headers,
      data: { street: 'Hauptstraße 5', postalCode: '12345', city: 'Musterstadt', taxNumber: '123/456/78901' },
    });
    const quoteId = await createDraftQuote(request, token);
    await request.post(`${API_BASE_URL}/quotes/${quoteId}/approve`, { headers });
    await request.post(`${API_BASE_URL}/quotes/${quoteId}/send`, { headers });
    await request.post(`${API_BASE_URL}/quotes/${quoteId}/outcome`, {
      headers,
      data: { status: 'accepted' },
    });
    const order = await (await request.post(`${API_BASE_URL}/orders`, { headers, data: { quoteId } })).json();
    const draft = await (
      await request.post(`${API_BASE_URL}/invoices/from-order`, {
        headers,
        data: { orderId: order.id, kind: 'final' },
      })
    ).json();
    const issued = await (
      await request.post(`${API_BASE_URL}/invoices/${draft.id}/issue`, { headers, data: {} })
    ).json();
    const gross = Number(issued.totalGross);

    await loginViaUi(page);
    await page.goto(`/projekte/${SEED.projectId}`);
    const card = page.locator(`[data-testid="invoice-item"][data-invoice-id="${issued.id}"]`);
    await expect(card.getByTestId('invoice-open')).toContainText('offen');

    // Teilzahlung von 10,00 €
    await card.getByTestId('invoice-payment').click();
    await card.getByTestId('payment-amount').fill('10,00');
    await card.getByTestId('payment-method').selectOption('cash');
    await card.getByTestId('payment-submit').click();
    await expect(card.getByTestId('invoice-payment-entry')).toContainText('10,00 €');
    await expect(card.getByTestId('invoice-payment-entry')).toContainText('bar');
    const rest = (gross - 10).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
    await expect(card.getByTestId('invoice-open')).toContainText(rest);

    // Offene Posten zeigen den Rest
    await page.getByTestId('nav-open-items').click();
    const item = page.locator(`[data-testid="open-item"][data-invoice-id="${issued.id}"]`);
    await expect(item.getByTestId('open-item-amount')).toHaveText(rest);
    await expect(item).toContainText('bezahlt 10,00 €');

    // Rest begleichen: das Formular schlägt den offenen Betrag vor
    await item.getByRole('link').click();
    await card.getByTestId('invoice-payment').click();
    await expect(card.getByTestId('payment-amount')).toHaveValue(
      rest.replace(/[^\d,]/g, '').replace(/^0+(?=\d)/, ''),
    );
    await card.getByTestId('payment-submit').click();
    await expect(card.getByTestId('invoice-open')).toHaveText(' · bezahlt');
    await expect(card.getByTestId('invoice-payment')).toHaveCount(0);

    await page.getByTestId('nav-open-items').click();
    await expect(page.locator(`[data-testid="open-item"][data-invoice-id="${issued.id}"]`)).toHaveCount(0);
  });
});
