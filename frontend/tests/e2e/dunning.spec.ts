import { test, expect } from '@playwright/test';
import { loginViaUi } from './fixtures';

// Mahnen aus den offenen Posten. Eine überfällige Rechnung lässt sich über die
// API nicht erzeugen (ausgestellte Rechnungen sind unveränderlich), daher
// liefert hier ein abgefangener Aufruf die offenen Posten; die Mahnlogik selbst
// prüfen die Integrationstests (dunning.int-spec.ts).
test.describe('Mahnwesen (Offene Posten)', () => {
  test('Zahlungserinnerung erstellen, als PDF öffnen und per E-Mail senden', async ({ page }) => {
    const invoiceId = '00000000-0000-4000-8000-000000000001';
    const item = {
      invoiceId,
      number: 'R-2026-0099',
      kind: 'final',
      dueDate: '2026-09-01',
      daysOverdue: 22,
      totalGross: '595',
      paid: '0',
      open: '595',
      project: { id: 'p1', title: 'Gartenpflege' },
      customer: { id: 'c1', name: 'Familie Linde' },
      dunning: [] as object[],
      nextDunningLevel: 1 as number | null,
    };
    await page.route('**/open-items', (route) => route.fulfill({ json: [item] }));
    const created: string[] = [];
    await page.route(`**/invoices/${invoiceId}/dunning`, (route) => {
      created.push(route.request().method());
      item.dunning = [{ id: 'd1', level: 1, issuedOn: '2026-09-23', deadline: '2026-09-30', sentAt: null }];
      item.nextDunningLevel = null;
      return route.fulfill({ status: 201, json: { id: 'd1', level: 1 } });
    });
    await page.route(`**/invoices/${invoiceId}/dunning/d1/send`, (route) =>
      route.fulfill({ status: 201, json: { sent: true, to: 'linde@example.com' } }),
    );
    await page.route(`**/invoices/${invoiceId}/dunning/d1/pdf`, (route) =>
      route.fulfill({ status: 200, contentType: 'application/pdf', body: '%PDF-1.7\n%%EOF' }),
    );

    await loginViaUi(page);
    await page.getByTestId('nav-open-items').click();
    const row = page.locator(`[data-testid="open-item"][data-invoice-id="${invoiceId}"]`);
    await expect(row.getByTestId('open-item-overdue')).toHaveText('22 Tage überfällig');
    await row.getByTestId('dunning-create').click();
    await expect.poll(() => created).toEqual(['POST']);
    await expect(row.getByTestId('dunning-entry')).toContainText('Zahlungserinnerung vom 23.09.2026');
    await expect(row.getByTestId('dunning-entry')).toContainText('Frist 30.09.2026');
    // Frist läuft: keine weitere Mahnstufe anbieten
    await expect(row.getByTestId('dunning-create')).toHaveCount(0);

    const [pdf] = await Promise.all([
      page.waitForResponse((r) => r.url().endsWith(`/dunning/d1/pdf`)),
      row.getByTestId('dunning-pdf').click(),
    ]);
    expect(pdf.status()).toBe(200);
    for (const tab of page.context().pages()) {
      if (tab !== page) await tab.close();
    }

    page.once('dialog', (dialog) => dialog.accept(''));
    await row.getByTestId('dunning-send').click();
    await expect(page.getByTestId('open-items-notice')).toHaveText(
      'Zahlungserinnerung zu R-2026-0099 an linde@example.com gesendet.',
    );
  });
});
