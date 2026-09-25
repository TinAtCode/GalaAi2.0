import { test, expect, APIRequestContext, Page } from '@playwright/test';
import { API_BASE_URL, apiLogin, createDraftQuote, SEED } from './fixtures';

// Rechte je Rolle im echten Ablauf: Nutzer mit Standardrolle anlegen, als
// dieser Nutzer anmelden und prüfen, was die Oberfläche zeigt – und dass die
// Schnittstelle Verbotenes auch ohne Oberfläche ablehnt.
async function userWithRole(request: APIRequestContext, roleName: string) {
  const token = await apiLogin(request);
  const headers = { Authorization: `Bearer ${token}` };
  const roles = (await (await request.get(`${API_BASE_URL}/roles`, { headers })).json()) as {
    id: string;
    name: string;
  }[];
  const role = roles.find((r) => r.name === roleName);
  expect(role, `Rolle ${roleName}`).toBeTruthy();
  const email = `${roleName.toLowerCase()}-${Date.now()}@musterbetrieb.de`;
  const res = await request.post(`${API_BASE_URL}/users`, {
    headers,
    data: { email, firstName: roleName, lastName: 'Test', password: 'rollentest123', roleIds: [role!.id] },
  });
  expect(res.ok(), await res.text()).toBeTruthy();
  // der Request-Kontext trägt schon das Session-Cookie des Admins: ohne
  // X-Requested-With lehnt der CSRF-Schutz die Anmeldung ab (richtig so)
  const login = await request.post(`${API_BASE_URL}/auth/login`, {
    headers: { 'X-Requested-With': 'XMLHttpRequest' },
    data: { email, password: 'rollentest123' },
  });
  expect(login.ok(), await login.text()).toBeTruthy();
  const accessToken = (await login.json()).accessToken as string;
  return { email, token: accessToken, adminToken: token };
}

async function loginAs(page: Page, email: string) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(email);
  await page.getByTestId('login-password').fill('rollentest123');
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL('/');
}

test('Mitarbeiter: sieht Projekte, aber keine Preise, keine Finanzen', async ({ page, request }) => {
  const { email, token, adminToken } = await userWithRole(request, 'Mitarbeiter');
  const quoteId = await createDraftQuote(request, adminToken);
  const auth = { Authorization: `Bearer ${token}` };

  await loginAs(page, email);
  await expect(page.getByTestId('nav-finance')).toHaveCount(0);
  await expect(page.getByTestId('nav-open-items')).toHaveCount(0);
  await expect(page.getByTestId('nav-team')).toHaveCount(0);

  await page.goto(`/projekte/${SEED.projectId}`);
  const card = page.locator(`[data-testid="quote-card"][data-quote-id="${quoteId}"]`);
  await expect(card).toBeVisible();
  await expect(card).not.toContainText('€');
  await expect(card.getByTestId('quote-pdf')).toHaveCount(0);
  await expect(card.getByTestId('quote-copy')).toHaveCount(0);
  await expect(page.getByTestId('postcalc-margin')).toHaveCount(0);
  await expect(page.getByTestId('postcalc-material')).toHaveCount(0);

  // die Schnittstelle lehnt es auch direkt ab bzw. liefert keine Preise
  expect((await request.get(`${API_BASE_URL}/open-items`, { headers: auth })).status()).toBe(403);
  expect((await request.get(`${API_BASE_URL}/finance/payables`, { headers: auth })).status()).toBe(403);
  expect((await request.get(`${API_BASE_URL}/quotes/${quoteId}/pdf`, { headers: auth })).status()).toBe(403);
  const quote = await (await request.get(`${API_BASE_URL}/quotes/${quoteId}`, { headers: auth })).json();
  expect(quote.totalNet).toBeUndefined();
  expect(quote.lineItems[0].unitPrice).toBeUndefined();
  const calc = await (
    await request.get(`${API_BASE_URL}/post-calculation/${SEED.projectId}`, { headers: auth })
  ).json();
  expect(calc.margin).toBeNull();
  expect(calc.material).toBeNull();
  expect(
    (await request.post(`${API_BASE_URL}/quotes/${quoteId}/copy`, { headers: auth, data: {} })).status(),
  ).toBe(403);
});

test('Buchhaltung: Finanzen und Verkaufspreise, aber keine Einkaufspreise', async ({ page, request }) => {
  const { email, token, adminToken } = await userWithRole(request, 'Buchhaltung');
  const quoteId = await createDraftQuote(request, adminToken);
  const auth = { Authorization: `Bearer ${token}` };

  await loginAs(page, email);
  await expect(page.getByTestId('nav-finance')).toBeVisible();
  await expect(page.getByTestId('nav-open-items')).toBeVisible();

  await page.goto(`/projekte/${SEED.projectId}`);
  const card = page.locator(`[data-testid="quote-card"][data-quote-id="${quoteId}"]`);
  await expect(card).toContainText('€'); // Verkaufspreise
  await expect(card.getByTestId('quote-pdf')).toBeVisible();
  // Deckungsbeitrag braucht Einkaufspreise
  await expect(page.getByTestId('postcalc-margin')).toHaveCount(0);

  const quote = await (await request.get(`${API_BASE_URL}/quotes/${quoteId}`, { headers: auth })).json();
  expect(quote.totalNet).toBeDefined();
  expect(quote.lineItems[0].costPerUnit).toBeUndefined();
  expect(quote.lineItems[0].marginPerUnit).toBeUndefined();
  const calc = await (
    await request.get(`${API_BASE_URL}/post-calculation/${SEED.projectId}`, { headers: auth })
  ).json();
  expect(calc.margin).toBeNull();
  expect(calc.purchases).toBeNull();
  expect((await request.get(`${API_BASE_URL}/finance/payables`, { headers: auth })).status()).toBe(200);
  // Nutzerverwaltung bleibt der Geschäftsführung vorbehalten
  expect(
    (
      await request.post(`${API_BASE_URL}/users`, {
        headers: auth,
        data: { email: `x-${Date.now()}@m.de`, firstName: 'X', lastName: 'Y', password: 'rollentest123' },
      })
    ).status(),
  ).toBe(403);
});
