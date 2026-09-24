import { test, expect } from '@playwright/test';
import { API_BASE_URL, apiLogin, loginViaUi, SEED } from './fixtures';

test.describe('Pflegeverträge', () => {
  test('am Projekt anlegen, Termine planen, abrechnen, in der Übersicht sehen', async ({ page, request }) => {
    const run = String(Date.now()).slice(-6);
    const title = `Grünpflege ${run}`;
    const token = await apiLogin(request);
    const headers = { Authorization: `Bearer ${token}` };

    await loginViaUi(page);
    await page.goto(`/projekte/${SEED.projectId}`);
    await page.getByTestId('contract-new').click();
    const form = page.getByTestId('contract-form');
    await form.getByTestId('contract-title').fill(title);
    await form.getByTestId('contract-line-description').fill('Rasenpflege pauschal');
    await form.getByTestId('contract-line-price').fill('180');
    await form.getByTestId('contract-task-title').fill('Rasen mähen');
    await form.getByTestId('contract-task-weeks').fill('1');
    // erster Einsatz übermorgen (nicht heute: „Mein Tag“ bleibt unverändert)
    const start = new Date();
    start.setDate(start.getDate() + 2);
    const iso = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
    await form.getByTestId('contract-task-next').fill(iso);
    await form.locator('select[aria-label="Saison von"]').selectOption('1');
    await form.locator('select[aria-label="Saison bis"]').selectOption('12');
    await expect(form.getByTestId('contract-form-total')).toContainText('180,00');
    await form.getByTestId('contract-save').click();

    const card = page.getByTestId('contract-card').filter({ hasText: title });
    await expect(card).toBeVisible();
    await expect(card.getByTestId('contract-net')).toHaveText(/180,00/);
    await expect(card.getByTestId('contract-billing-due')).toBeVisible();

    // Termine für 4 Wochen: übermorgen und dann wöchentlich
    await card.getByTestId('contract-plan').click();
    await expect(page.getByTestId('contract-message')).toContainText('Termine für die nächsten 4 Wochen geplant');
    await expect(page.getByTestId('appointment-item').filter({ hasText: 'Rasen mähen' }).first()).toBeVisible();

    // Abrechnen: Entwurf erscheint unter Rechnungen
    await card.getByTestId('contract-invoice').click();
    await expect(page.getByTestId('contract-message')).toContainText('Rechnungsentwurf');
    await expect(page.locator('#rechnungen')).toContainText('Rechnung (Pflegevertrag)');
    await expect(card.getByTestId('contract-billing-due')).toHaveCount(0);

    // Übersicht
    await page.getByTestId('nav-contracts').click();
    await expect(page.getByTestId('contract-card').filter({ hasText: title })).toBeVisible();
    await expect(page.getByTestId('contracts-active')).not.toHaveText('0');

    // aufräumen: Entwurf löschen, Vertrag löschen (sagt die Termine ab)
    const contracts = await (await request.get(`${API_BASE_URL}/contracts`, { headers })).json();
    const contract = contracts.find((c: { title: string }) => c.title === title);
    const invoices = await (
      await request.get(`${API_BASE_URL}/invoices/by-project/${SEED.projectId}`, { headers })
    ).json();
    for (const invoice of invoices.filter(
      (i: { contractId: string | null; status: string }) => i.contractId === contract.id && i.status === 'draft',
    )) {
      expect((await request.delete(`${API_BASE_URL}/invoices/${invoice.id}`, { headers })).ok()).toBeTruthy();
    }
    expect((await request.delete(`${API_BASE_URL}/contracts/${contract.id}`, { headers })).ok()).toBeTruthy();
  });
});
