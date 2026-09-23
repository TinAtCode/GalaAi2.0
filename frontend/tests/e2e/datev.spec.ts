import { test, expect } from '@playwright/test';
import { API_BASE_URL, apiLogin, createDraftQuote, loginViaUi } from './fixtures';

// DATEV-Export: Berater- und Mandantennummer in den Einstellungen pflegen,
// dann den Buchungsstapel des heutigen Tages herunterladen.
test.describe('DATEV-Export', () => {
  test('Einstellungen speichern und Buchungsstapel herunterladen', async ({ page, request }) => {
    // Arrange per API: Firmendaten und eine ausgestellte Rechnung von heute
    const token = await apiLogin(request);
    const headers = { Authorization: `Bearer ${token}` };
    const settings = await request.patch(`${API_BASE_URL}/company/settings`, {
      headers,
      data: { street: 'Hauptstraße 5', postalCode: '12345', city: 'Musterstadt', taxNumber: '123/456/78901' },
    });
    expect(settings.ok()).toBeTruthy();
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
    const issued = await request.post(`${API_BASE_URL}/invoices/${draft.id}/issue`, { headers, data: {} });
    expect(issued.ok()).toBeTruthy();
    const { number } = await issued.json();

    await loginViaUi(page);
    await page.getByTestId('nav-settings').click();
    const section = page.getByTestId('datev-section');
    await section.getByTestId('datev-consultant').fill('29098');
    await section.getByTestId('datev-client').fill('55003');
    await section.getByTestId('datev-chart').selectOption('SKR03');
    await section.getByTestId('datev-submit').click();
    await expect(section.getByTestId('datev-message')).toHaveText('DATEV-Einstellungen gespeichert.');

    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    await section.getByTestId('datev-from').fill(today);
    await section.getByTestId('datev-to').fill(today);
    const [download] = await Promise.all([
      page.waitForEvent('download', { predicate: (d) => d.suggestedFilename().endsWith('.csv') }),
      section.getByTestId('datev-export').click(),
    ]);
    expect(download.suggestedFilename()).toBe(
      `EXTF_Buchungsstapel_${today.replace(/-/g, '')}_${today.replace(/-/g, '')}.csv`,
    );
    const content = Buffer.concat(await (await download.createReadStream()).toArray()).toString('latin1');
    const [header, , ...rows] = content.split('\r\n');
    expect(header).toMatch(/^"EXTF";700;21;"Buchungsstapel";12;\d{17};;"RE";"GartenAI";"";29098;55003;/);
    expect(rows.some((r) => r.includes(`"${number}"`) && r.includes(';8400;'))).toBe(true);

    // Mit Zahlungseingängen: derselbe Export mit payments=1
    await section.getByTestId('datev-with-payments').check();
    const [withPayments] = await Promise.all([
      page.waitForResponse((r) => r.url().includes('/datev/bookings') && r.url().includes('payments=1')),
      section.getByTestId('datev-export').click(),
    ]);
    expect(withPayments.status()).toBe(200);
    await section.getByTestId('datev-with-payments').uncheck();

    // Leerer Zeitraum: verständliche Meldung statt leerer Datei
    await section.getByTestId('datev-from').fill('2000-01-01');
    await section.getByTestId('datev-to').fill('2000-01-31');
    await section.getByTestId('datev-export').click();
    await expect(section.getByTestId('datev-export-message')).toHaveText(
      'Im Zeitraum gibt es keine ausgestellten Rechnungen.',
    );
  });
});
