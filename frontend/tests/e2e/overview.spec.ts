import { test, expect } from '@playwright/test';
import { API_BASE_URL, apiLogin, createDraftQuote, loginViaUi, SEED } from './fixtures';

// Mein Tag: „Zu erledigen“ mit Sprung an die richtige Stelle; Schnellsuche
// nach Angebotsnummern; Termine führen zur Baustelle.
test('Zu erledigen führt zum Angebot, Schnellsuche findet die Angebotsnummer', async ({ page, request }) => {
  const token = await apiLogin(request);
  const quoteId = await createDraftQuote(request, token);
  const quote = await (
    await request.get(`${API_BASE_URL}/quotes/${quoteId}`, { headers: { Authorization: `Bearer ${token}` } })
  ).json();

  await loginViaUi(page);
  const todo = page.getByTestId('todo-quotes_draft');
  await expect(todo).toContainText('Angebote freigeben');
  await expect(todo.getByRole('link').first()).toBeVisible();

  // Schnellsuche: Angebotsnummer → Projekt, Abschnitt Angebote
  await page.getByTestId('search-open').click();
  await page.getByRole('dialog', { name: 'Schnellsuche' }).locator('input').fill(quote.number);
  await expect(page.getByTestId('command-palette')).toContainText('Angebot ·');
  await page.keyboard.press('Enter');
  await expect(page).toHaveURL(new RegExp(`/projekte/${SEED.projectId}#angebote$`));
  await expect(page.locator(`[data-quote-id="${quoteId}"]`)).toBeVisible();
});

test('Termin auf Mein Tag öffnet die Baustelle, Route zur Adresse', async ({ page, request }) => {
  // Termin heute (Mittag, damit die Zeitzone keine Rolle spielt) für den angemeldeten Chef
  const token = await apiLogin(request);
  const headers = { Authorization: `Bearer ${token}` };
  const me = await (await request.get(`${API_BASE_URL}/auth/me`, { headers })).json();
  // eigenes Projekt: andere Tests ändern den Status des Demo-Projekts
  const customer = await (
    await request.post(`${API_BASE_URL}/customers`, { headers, data: { name: `Mein-Tag ${Date.now()}` } })
  ).json();
  const property = await (
    await request.post(`${API_BASE_URL}/properties`, {
      headers,
      data: { customerId: customer.id, label: 'Garten', street: 'Lindenweg 3', city: 'Köln' },
    })
  ).json();
  const project = await (
    await request.post(`${API_BASE_URL}/projects`, {
      headers,
      data: { propertyId: property.id, title: 'Rasenpflege' },
    })
  ).json();
  // freie Viertelstunde heute suchen: Termine desselben Nutzers dürfen sich nicht überschneiden
  const title = `Rasen mähen ${Date.now()}`;
  let created = false;
  for (let slot = 0; slot < 60 && !created; slot++) {
    const start = new Date();
    start.setHours(6, 0, 0, 0);
    start.setMinutes(start.getMinutes() + slot * 15);
    const res = await request.post(`${API_BASE_URL}/appointments`, {
      headers,
      data: {
        projectId: project.id,
        title,
        startTime: start.toISOString(),
        endTime: new Date(start.getTime() + 10 * 60_000).toISOString(),
        assignedUserId: me.id,
      },
    });
    created = res.ok();
  }
  expect(created).toBeTruthy();

  await loginViaUi(page);
  const item = page.getByTestId('my-day-item').filter({ hasText: title });
  await expect(item.getByTestId('my-day-route')).toHaveAttribute('href', /maps/);
  await item.getByTestId('my-day-project').click();
  await expect(page).toHaveURL(/\/baustelle\//);
});
