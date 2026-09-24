import { test, expect, APIRequestContext } from '@playwright/test';
import { API_BASE_URL, apiLogin, loginViaUi, SEED } from './fixtures';

// Eigenes Projekt mit angenommenem Angebot und Auftrag (über die API)
async function projectWithOrder(request: APIRequestContext, token: string, run: string) {
  const headers = { Authorization: `Bearer ${token}` };
  const post = async (path: string, data?: object) => {
    const res = await request.post(`${API_BASE_URL}${path}`, { headers, data });
    expect(res.ok(), await res.text()).toBeTruthy();
    return res.json();
  };
  const customer = await post('/customers', { name: `Suchkunde ${run}`, city: `Lindenau${run}` });
  const property = await post('/properties', { customerId: customer.id, label: 'Vorgarten' });
  const project = await post('/projects', { propertyId: property.id, title: `Pflaster ${run}` });
  const quote = await post('/quotes', {
    projectId: project.id,
    lineItems: [{ serviceId: SEED.serviceId, quantity: 5 }],
  });
  await post(`/quotes/${quote.id}/approve`);
  await post(`/quotes/${quote.id}/send`);
  await post(`/quotes/${quote.id}/outcome`, { status: 'accepted' });
  await post('/orders', { quoteId: quote.id });
  return project.id as string;
}

test.describe('Oberfläche und Querverbindungen', () => {
  test('Suche, Schnellsuche, Auftragsstatus, Termine, Material und Nachkalkulation', async ({
    page,
    request,
  }) => {
    const run = String(Date.now()).slice(-6);
    const token = await apiLogin(request);
    const projectId = await projectWithOrder(request, token, run);
    await loginViaUi(page);

    // Projektliste: Suche nach Kundenname, Statusfilter
    await page.getByTestId('nav-projects').click();
    await page.getByTestId('project-search').fill(`Suchkunde ${run}`);
    await expect(page.getByTestId('project-list-item')).toHaveCount(1);
    await expect(page.getByTestId('project-title')).toHaveText(`Pflaster ${run}`);
    await page.getByTestId('project-filter-done').click();
    await expect(page.getByTestId('project-list-item')).toHaveCount(0);
    await page.getByTestId('project-filter-all').click();
    await expect(page.getByTestId('project-list-item')).toHaveCount(1);

    // Kundenliste: Suche nach Ort
    await page.getByTestId('nav-customers').click();
    await page.getByTestId('customer-search').fill(`lindenau${run}`);
    await expect(page.getByTestId('customer-list-item')).toHaveCount(1);

    // Schnellsuche (Strg+K) öffnet das Projekt
    await page.keyboard.press('Control+k');
    await page.getByTestId('command-input').fill(`Pflaster ${run}`);
    await page.getByRole('option', { name: new RegExp(`Pflaster ${run}`) }).click();
    await expect(page).toHaveURL(`/projekte/${projectId}`);
    await expect(page.getByTestId('project-heading')).toHaveText(`Pflaster ${run}`);

    // Auftrag beginnen und abschließen
    const order = page.getByTestId('order-item');
    await expect(order.getByTestId('order-status')).toHaveText('Offen');
    await order.getByTestId('order-in_progress').click();
    await expect(order.getByTestId('order-status')).toHaveText('In Arbeit');
    await order.getByTestId('order-done').click();
    await expect(order.getByTestId('order-status')).toHaveText('Erledigt');
    await expect(order.getByTestId('order-cancelled')).toHaveCount(0);

    // Termin anlegen und erledigen
    await page.getByTestId('appointment-title').fill('Abnahme');
    await page.getByTestId('appointment-date').fill('2030-05-02');
    await page.getByTestId('appointment-submit').click();
    const appointment = page.getByTestId('appointment-item').filter({ hasText: 'Abnahme' });
    await appointment.getByTestId('appointment-done').click();
    await expect(appointment).toContainText('Erledigt');

    // Material erfassen: erscheint in der Liste und in der Nachkalkulation
    const postcalc = page.getByTestId('postcalc-material');
    await expect(postcalc).toBeVisible();
    await page.getByTestId('material-article').selectOption({ label: 'Schotter 0/32 (Sack)' });
    await page.getByTestId('material-quantity').fill('4');
    await page.getByTestId('material-submit').click();
    await expect(page.getByTestId('material-item')).toHaveCount(1);
    await expect(page.getByTestId('material-item')).toContainText('4 Sack');
    await expect(postcalc).toContainText('14,00 €');
  });

  test('Preisliste einlesen: Vorschau, Auswahl, Übernahme', async ({ page }) => {
    const run = String(Date.now()).slice(-6);
    await loginViaUi(page);
    await page.getByTestId('nav-masterdata').click();
    await page.getByTestId('tab-pricelist').click();
    const csv = [
      'Artikelnummer;Bezeichnung;Einheit;EK;VK',
      `PL-${run}-1;Kies 8/16;t;21,50;32,00`,
      `PL-${run}-2;Rindenmulch;m³;18,00;29,90`,
    ].join('\n');
    await page.getByTestId('pricelist-file').setInputFiles({
      name: 'preisliste.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf-8'),
    });
    const preview = page.getByTestId('pricelist-preview');
    await expect(preview).toContainText('Neue Artikel (2)');
    await expect(preview).toContainText('Kies 8/16');
    // Rindenmulch auslassen
    await preview.getByTestId('pricelist-accept').nth(1).uncheck();
    await page.getByTestId('pricelist-apply').click();
    await expect(page.getByTestId('pricelist-result')).toHaveText(
      'Übernommen: 1 neu, 0 geändert, 1 ausgelassen.',
    );
    await page.getByTestId('tab-articles').click();
    await expect(page.getByText('Kies 8/16')).toBeVisible();
    await expect(page.getByText('Rindenmulch')).toHaveCount(0);
  });

  test('Dunkelmodus', async ({ page }) => {
    await loginViaUi(page);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('theme-mode-dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    expect(background).toBe('rgb(20, 23, 21)');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('theme-mode-system').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
  });
});
