import { test, expect, APIRequestContext } from '@playwright/test';
import { API_BASE_URL, SEED, apiLogin, createDraftQuote, loginViaUi } from './fixtures';

// Angebot bis zum Auftrag per API vorbereiten (Arrange), dann in der UI:
// Firmendaten pflegen, Schlussrechnung erstellen, ausstellen, stornieren.
async function createOrder(request: APIRequestContext, token: string) {
  const headers = { Authorization: `Bearer ${token}` };
  const quoteId = await createDraftQuote(request, token);
  await request.post(`${API_BASE_URL}/quotes/${quoteId}/approve`, { headers });
  await request.post(`${API_BASE_URL}/quotes/${quoteId}/send`, { headers });
  await request.post(`${API_BASE_URL}/quotes/${quoteId}/outcome`, { headers, data: { status: 'accepted' } });
  const order = await request.post(`${API_BASE_URL}/orders`, { headers, data: { quoteId } });
  expect(order.ok()).toBeTruthy();
  return (await order.json()).id as string;
}

test.describe('Rechnungen', () => {
  test('Firmendaten pflegen, Schlussrechnung ausstellen und stornieren', async ({ page, request }) => {
    const token = await apiLogin(request);
    const orderId = await createOrder(request, token);

    await loginViaUi(page);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('company-street').fill('Hauptstraße 5');
    await page.getByTestId('company-postalCode').fill('12345');
    await page.getByTestId('company-city').fill('Musterstadt');
    await page.getByTestId('company-taxNumber').fill('123/456/78901');
    await page.getByTestId('company-submit').click();
    await expect(page.getByTestId('company-message')).toHaveText('Firmendaten gespeichert.');

    await page.goto(`/projekte/${SEED.projectId}`);
    // Gezielt den eben angelegten Auftrag abrechnen (andere Tests legen
    // weitere an); die ID des Entwurfs direkt aus der Antwort lesen.
    const [response] = await Promise.all([
      page.waitForResponse(
        (r) => r.url().endsWith('/invoices/from-order') && r.request().method() === 'POST',
      ),
      page.locator(`[data-order-id="${orderId}"]`).getByTestId('invoice-new-final').click(),
    ]);
    expect(response.status()).toBe(201);
    const { id: invoiceId } = await response.json();
    const card = page.locator(`[data-testid="invoice-item"][data-invoice-id="${invoiceId}"]`);
    await expect(card.getByTestId('invoice-status')).toHaveText('Entwurf');
    await card.getByTestId('invoice-issue').click();
    await expect(card.getByTestId('invoice-status')).toHaveText('Ausgestellt');
    await expect(card.getByTestId('invoice-number')).toHaveText(/^R-\d{4}-\d{4}$/);

    // PDF öffnet sich in einem neuen Tab (mit Token geladen)
    const [pdfTab] = await Promise.all([
      page.context().waitForEvent('page'),
      card.getByTestId('invoice-pdf').click(),
    ]);
    expect(pdfTab.url()).toMatch(/^blob:/);
    await pdfTab.close();

    page.once('dialog', (dialog) => dialog.accept('Falsche Menge'));
    await card.getByTestId('invoice-cancel').click();
    await expect(card.getByTestId('invoice-status')).toHaveText('Storniert');
    await expect(page.getByTestId('invoice-item').filter({ hasText: 'Stornorechnung' }).last()).toBeVisible();
  });
});
