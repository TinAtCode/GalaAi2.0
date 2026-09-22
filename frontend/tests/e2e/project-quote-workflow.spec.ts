import { test, expect } from '@playwright/test';
import { SEED, loginViaUi, apiLogin, createDraftQuote } from './fixtures';

// Kritische User Journey (siehe TESTING_GUIDE.md): Angebot → Freigeben →
// Versenden → Kunde nimmt an → Auftrag erzeugen. Das Anlegen des
// Angebots selbst läuft über die API (Arrange-Schritt) statt über die UI,
// weil es dafür bewusst kein Formular gibt – Angebote entstehen aus einer
// Kalkulation heraus (siehe STATUS.md); das eigentlich zu testende
// Verhalten sind die Statuswechsel-Aktionen in der UI.
test.describe('Angebots-Workflow (Projekt-Detail)', () => {
  test('Angebot durchläuft alle Statuswechsel bis zum Auftrag', async ({ page, request }) => {
    const token = await apiLogin(request);
    await createDraftQuote(request, token);

    await loginViaUi(page);
    await page.goto(`/projekte/${SEED.projectId}`);

    const quoteCard = page.getByTestId('quote-card').first();
    await expect(quoteCard).toBeVisible();
    await expect(quoteCard.getByTestId('quote-status')).toHaveText('Entwurf');

    await quoteCard.getByTestId('quote-approve').click();
    await expect(quoteCard.getByTestId('quote-status')).toHaveText('Freigegeben');

    await quoteCard.getByTestId('quote-send').click();
    await expect(quoteCard.getByTestId('quote-status')).toHaveText('Versendet');

    await quoteCard.getByTestId('quote-accept').click();
    await expect(quoteCard.getByTestId('quote-status')).toHaveText('Angenommen');

    await expect(quoteCard.getByTestId('quote-create-order')).toBeVisible();
    await quoteCard.getByTestId('quote-create-order').click();

    // Nach Auftragserzeugung verschwindet der "Auftrag erzeugen"-Button
    // (hasOrderForQuote greift) und der neue Auftrag erscheint in der Liste.
    await expect(quoteCard.getByTestId('quote-create-order')).not.toBeVisible();
    await expect(page.getByRole('heading', { name: 'Aufträge' })).toBeVisible();
  });

  test('ein abgelehntes Angebot bietet keinen "Auftrag erzeugen"-Button', async ({ page, request }) => {
    const token = await apiLogin(request);
    const quoteId = await createDraftQuote(request, token);
    await request.post(`http://localhost:3000/quotes/${quoteId}/approve`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await request.post(`http://localhost:3000/quotes/${quoteId}/send`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await loginViaUi(page);
    await page.goto(`/projekte/${SEED.projectId}`);

    const quoteCard = page.locator(`[data-testid="quote-card"]`).filter({ hasText: 'Versendet' }).first();
    await quoteCard.getByTestId('quote-reject').click();

    await expect(quoteCard.getByTestId('quote-status')).toHaveText('Abgelehnt');
    await expect(quoteCard.getByTestId('quote-create-order')).toHaveCount(0);
  });
});

test.describe('Termine anlegen (Projekt-Detail)', () => {
  test('ein neuer Termin erscheint sofort in der Liste', async ({ page }) => {
    await loginViaUi(page);
    await page.goto(`/projekte/${SEED.projectId}`);

    const title = `E2E-Testtermin ${Date.now()}`;
    await page.getByTestId('appointment-title').fill(title);
    await page.getByTestId('appointment-date').fill('2026-12-01');
    await page.getByTestId('appointment-time').fill('09:30');
    await page.getByTestId('appointment-submit').click();

    await expect(page.getByTestId('appointment-item').filter({ hasText: title })).toBeVisible();
  });
});
