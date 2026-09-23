import { Page, APIRequestContext, expect } from '@playwright/test';

// Zugangsdaten und IDs aus prisma/seed.ts im Backend – siehe TESTANLEITUNG.md.
export const SEED = {
  email: 'admin@musterbetrieb.de',
  password: 'demo12345',
  projectId: 'demo-project-id',
  serviceId: 'demo-service-id',
};

export const API_BASE_URL = process.env.E2E_API_URL ?? 'http://localhost:3000';

// UI-Login über das echte Formular – für Tests, die den Login-Vorgang
// selbst als Teil der User Journey prüfen sollen.
export async function loginViaUi(page: Page) {
  await page.goto('/login');
  await page.getByTestId('login-email').fill(SEED.email);
  await page.getByTestId('login-password').fill(SEED.password);
  await page.getByTestId('login-submit').click();
  await expect(page).toHaveURL('/');
}

// Direkter API-Login – für Tests, die NICHT den Login-Vorgang selbst
// prüfen, sondern nur einen gültigen Token brauchen, um Testdaten über die
// API vorzubereiten (Arrange-Schritt, siehe TESTING_GUIDE.md AAA-Pattern).
export async function apiLogin(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API_BASE_URL}/auth/login`, {
    data: { email: SEED.email, password: SEED.password },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.accessToken as string;
}

// Erzeugt ein frisches Angebot im Status "draft" für das Seed-Projekt über
// die API – für Tests, die nicht das Anlegen selbst prüfen (das prüft
// quote-create.spec.ts über das Formular).
export async function createDraftQuote(request: APIRequestContext, token: string): Promise<string> {
  const res = await request.post(`${API_BASE_URL}/quotes`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      projectId: SEED.projectId,
      lineItems: [{ serviceId: SEED.serviceId, quantity: 5 }],
    },
  });
  expect(res.ok()).toBeTruthy();
  const body = await res.json();
  return body.id as string;
}

// Startet und beendet sofort wieder eine Zeiterfassung für den eingeloggten
// User (admin@musterbetrieb.de aus dem Seed) – für Tests, die einen
// ABGESCHLOSSENEN Zeiteintrag zum Freigeben brauchen (Team-Seite).
export async function createCompletedTimeEntry(request: APIRequestContext, token: string): Promise<void> {
  const headers = { Authorization: `Bearer ${token}` };
  await request.post(`${API_BASE_URL}/time-entries/start`, {
    headers,
    data: { activity: 'E2E-Test-Tätigkeit' },
  });
  const stopRes = await request.post(`${API_BASE_URL}/time-entries/stop`, { headers, data: {} });
  expect(stopRes.ok()).toBeTruthy();
}
