import { test, expect } from '@playwright/test';
import { SEED, API_BASE_URL, loginViaUi, apiLogin, createDraftQuote } from './fixtures';

// Kritische User Journey (siehe TESTING_GUIDE.md): Angebot → Freigeben →
// Versenden → Kunde nimmt an → Auftrag erzeugen. Das Angebot wird per API
// vorbereitet (Arrange-Schritt); das Formular prüft quote-create.spec.ts,
// hier geht es um die Statuswechsel-Aktionen in der UI.
test.describe('Angebots-Workflow (Projekt-Detail)', () => {
  test('Angebot durchläuft alle Statuswechsel bis zum Auftrag', async ({ page, request }) => {
    const token = await apiLogin(request);
    await createDraftQuote(request, token);

    await loginViaUi(page);
    await page.goto(`/projekte/${SEED.projectId}`);

    const quoteCard = page.getByTestId('quote-card').first();
    await expect(quoteCard).toBeVisible();
    await expect(quoteCard.getByTestId('quote-status')).toHaveText('Entwurf');
    await expect(quoteCard.getByTestId('quote-number')).toHaveText(/^A-\d{4}-\d{4}$/);
    // Beträge als Euro formatiert, nicht als roher Dezimal-String ("151.8")
    await expect(quoteCard).toContainText(/\d+,\d{2}\s€ netto/);
    await expect(quoteCard).toContainText(/\d+,\d{2}\s€ brutto/);

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
    await expect(page.getByRole('heading', { name: 'Aufträge', exact: true })).toBeVisible();
  });

  test('ein abgelehntes Angebot bietet keinen "Auftrag erzeugen"-Button', async ({ page, request }) => {
    const token = await apiLogin(request);
    const quoteId = await createDraftQuote(request, token);
    await request.post(`${API_BASE_URL}/quotes/${quoteId}/approve`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    await request.post(`${API_BASE_URL}/quotes/${quoteId}/send`, {
      headers: { Authorization: `Bearer ${token}` },
    });

    await loginViaUi(page);
    await page.goto(`/projekte/${SEED.projectId}`);

    // Über die ID statt über den Status-Text anpinnen: nach dem Ablehnen passt
    // ein Filter auf "Versendet" nicht mehr und würde auf eine andere Karte springen.
    const quoteCard = page.locator(`[data-testid="quote-card"][data-quote-id="${quoteId}"]`);
    await quoteCard.getByTestId('quote-reject').click();

    await expect(quoteCard.getByTestId('quote-status')).toHaveText('Abgelehnt');
    await expect(quoteCard.getByTestId('quote-create-order')).toHaveCount(0);
  });
});

test.describe('Termine anlegen (Projekt-Detail)', () => {
  test('ein neuer Termin erscheint sofort in der Liste', async ({ page }) => {
    await loginViaUi(page);
    await page.goto(`/projekte/${SEED.projectId}`);

    const now = Date.now();
    const title = `E2E-Testtermin ${now}`;
    // Eindeutiger Zeitpunkt pro Lauf: ein fester Termin würde ab dem zweiten
    // Lauf (oder beim CI-Retry) an der Kollisionsprüfung scheitern.
    const minutesAhead = 60 * 24 * 30 + Math.floor(Math.random() * 60 * 24 * 365 * 5);
    const start = new Date(now + minutesAhead * 60000);
    const pad = (n: number) => String(n).padStart(2, '0');
    await page.getByTestId('appointment-title').fill(title);
    await page
      .getByTestId('appointment-date')
      .fill(`${start.getFullYear()}-${pad(start.getMonth() + 1)}-${pad(start.getDate())}`);
    await page.getByTestId('appointment-time').fill(`${pad(start.getHours())}:${pad(start.getMinutes())}`);
    await page.getByTestId('appointment-submit').click();

    await expect(page.getByTestId('appointment-item').filter({ hasText: title })).toBeVisible();
  });
});
