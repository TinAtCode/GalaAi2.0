import { test, expect } from '@playwright/test';
import { loginViaUi } from './fixtures';

const iso = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// Versicherung erfassen: Frist naht (Laufzeitende in gut drei Monaten, 3 Monate
// Frist), Kosten pro Jahr und Ringdiagramm, dann kündigen und löschen
test('Versicherungen & Verträge: Frist, Jahreskosten, kündigen', async ({ page }) => {
  const run = Date.now().toString().slice(-6);
  const name = `Haftpflicht ${run}`;
  const end = new Date();
  end.setMonth(end.getMonth() + 3);
  end.setDate(end.getDate() + 10);

  await loginViaUi(page);
  await page.goto('/finanzen?tab=contracts');
  await page.getByTestId('contract-new').click();
  await page.getByTestId('contract-name').fill(name);
  await page.getByTestId('contract-kind').selectOption('insurance');
  await page.getByTestId('contract-amount').fill('120');
  await page.getByTestId('contract-interval').selectOption('quarterly');
  await page.getByTestId('contract-termEnd').fill(iso(end));
  await page.getByTestId('contract-renewalMonths').fill('12');
  await page.getByTestId('contract-noticeMonths').fill('3');
  await page.getByTestId('contract-save').click();

  const item = page.getByTestId('contract-item').filter({ hasText: name });
  await expect(item.getByTestId('contract-state')).toHaveText('Kündigungsfrist naht');
  await expect(item).toContainText('480,00 € im Jahr');
  await expect(item.getByTestId('contract-terms')).toContainText('kündigen bis');
  await expect(page.getByTestId('contracts-donut').getByTestId('donut-legend').first()).toBeVisible();

  await item.getByTestId('contract-edit').click();
  await page.getByTestId('contract-cancelledOn').fill(iso(new Date()));
  await page.getByTestId('contract-save').click();
  await expect(item.getByTestId('contract-state')).toHaveText('gekündigt');

  page.once('dialog', (d) => void d.accept());
  await item.getByRole('button', { name: 'Löschen' }).click();
  await expect(page.getByTestId('contract-item').filter({ hasText: name })).toHaveCount(0);
});
