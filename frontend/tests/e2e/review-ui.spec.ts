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
    // Tag je Lauf verschieden: ein Termin vom letzten Lauf stünde sonst im Weg (Überschneidung)
    const day = new Date(Date.UTC(2030, 0, 1) + (Number(run) % 3000) * 86_400_000).toISOString().slice(0, 10);
    await page.getByTestId('appointment-title').fill(`Abnahme ${run}`);
    await page.getByTestId('appointment-date').fill(day);
    await page.getByTestId('appointment-submit').click();
    const appointment = page.getByTestId('appointment-item').filter({ hasText: `Abnahme ${run}` });
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
    // Deckungsbeitrag: Material zählt als Kosten
    const margin = page.getByTestId('postcalc-margin');
    await expect(margin).toContainText('Deckungsbeitrag');
    await expect(margin).toContainText('− 14,00 €');
  });

  test('Preisliste einlesen: Vorschau, Auswahl, Übernahme', async ({ page }) => {
    const run = String(Date.now()).slice(-6);
    await loginViaUi(page);
    await page.getByTestId('nav-masterdata').click();
    await page.getByTestId('tab-pricelist').click();
    const csv = [
      'Artikelnummer;Bezeichnung;Einheit;EK;VK',
      `PL-${run}-1;Kies 8/16 ${run};t;21,50;32,00`,
      `PL-${run}-2;Rindenmulch ${run};m³;18,00;29,90`,
    ].join('\n');
    await page.getByTestId('pricelist-file').setInputFiles({
      name: 'preisliste.csv',
      mimeType: 'text/csv',
      buffer: Buffer.from(csv, 'utf-8'),
    });
    const preview = page.getByTestId('pricelist-preview');
    await expect(preview).toContainText('Neue Artikel (2)');
    await expect(preview).toContainText(`Kies 8/16 ${run}`);
    // Rindenmulch auslassen
    await preview.getByTestId('pricelist-accept').nth(1).uncheck();
    await page.getByTestId('pricelist-apply').click();
    await expect(page.getByTestId('pricelist-result')).toHaveText(
      'Übernommen: 1 neu, 0 geändert, 1 ausgelassen.',
    );
    await page.getByTestId('tab-articles').click();
    await expect(page.getByText(`Kies 8/16 ${run}`)).toBeVisible();
    await expect(page.getByText(`Rindenmulch ${run}`)).toHaveCount(0);
  });

  test('Dunkelmodus', async ({ page }) => {
    await loginViaUi(page);
    await page.getByTestId('nav-settings').click();
    await page.getByTestId('theme-mode-dark').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    const background = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
    // gAla-Dunkelmodus (tokens.css, :root[data-look='gala'][data-theme='dark'])
    expect(background).toBe('rgb(17, 22, 18)');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await page.getByTestId('theme-mode-system').click();
    await expect(page.locator('html')).not.toHaveAttribute('data-theme', /.*/);
  });

  test('Erscheinungsbild: gAla als Standard, GartenAI wählbar, eigene Farben je Look', async ({ page }) => {
    await loginViaUi(page);
    await page.getByTestId('nav-settings').click();
    await expect(page.locator('html')).toHaveAttribute('data-look', 'gala');
    await expect(page.getByTestId('brand')).toHaveAttribute('data-look', 'gala');
    await expect(page).toHaveTitle('gAla');
    const primary = () =>
      page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue('--user-primary').trim(),
      );
    expect(await primary()).toBe('#1f4a2e');
    await page.getByTestId('look-gartenai').click();
    await expect(page.getByTestId('brand')).toHaveAttribute('data-look', 'gartenai');
    await expect(page).toHaveTitle('GartenAI');
    expect(await primary()).toBe('#2f4b3c');
    // bleibt nach dem Neuladen
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-look', 'gartenai');
    await page.getByTestId('look-gala').click();
    await expect(page).toHaveTitle('gAla');
  });
});
