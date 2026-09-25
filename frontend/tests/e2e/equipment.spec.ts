import { test, expect } from '@playwright/test';
import { loginViaUi } from './fixtures';

// Geräte: anlegen, Schaden melden (Zustand defekt), Wartung überfällig und
// erledigt, Inventur zählen und abschließen
test('Geräte: Schaden, Wartung und Inventur', async ({ page }) => {
  const run = Date.now().toString().slice(-6);
  const name = `Rüttelplatte ${run}`;
  await loginViaUi(page);
  await page.getByTestId('nav-equipment').click();
  await page.getByTestId('equipment-new').click();
  await page.getByTestId('equipment-name').fill(name);
  await page.getByTestId('equipment-kind').selectOption('machine');
  await page.getByTestId('equipment-inventory').fill(`RP-${run}`);
  await page.getByTestId('equipment-save').click();
  await page.getByTestId('equipment-item').filter({ hasText: name }).click();

  const detail = page.getByTestId('equipment-detail');
  await expect(detail.getByTestId('equipment-status')).toHaveText('einsatzbereit');
  await detail.getByTestId('damage-description').fill('Keilriemen gerissen');
  await detail.getByTestId('damage-severity').selectOption('unusable');
  await detail.getByTestId('damage-report').click();
  await expect(detail.getByTestId('equipment-status')).toHaveText('defekt');

  // Wartung mit Fälligkeit in der Vergangenheit ist überfällig
  await detail.getByTestId('maintenance-title').fill('UVV-Prüfung');
  await detail.getByTestId('maintenance-interval').fill('12');
  await detail.getByTestId('maintenance-next').fill('2026-01-15');
  await detail.getByTestId('maintenance-add').click();
  const row = detail.getByTestId('maintenance-row').filter({ hasText: 'UVV-Prüfung' });
  await expect(row.getByTestId('maintenance-due')).toContainText('überfällig seit 15.1.2026');
  await row.getByTestId('maintenance-done').click();
  await expect(row.getByTestId('maintenance-due')).not.toContainText('überfällig');

  // Schaden erledigt: wieder einsatzbereit
  const damage = detail.getByTestId('damage-row').filter({ hasText: 'Keilriemen gerissen' });
  await damage.getByTestId('damage-status').selectOption('fixed');
  await damage.getByTestId('damage-save').click();
  await expect(detail.getByTestId('equipment-status')).toHaveText('einsatzbereit');

  // Inventur: (laufende übernehmen oder neue starten), Gerät zählen, abschließen
  await page.goto('/geraete?tab=inventur');
  const inventory = page.getByTestId('inventory');
  const start = inventory.getByTestId('inventory-start');
  const close = inventory.getByTestId('inventory-close');
  await expect(start.or(close)).toBeVisible();
  if (await start.isVisible()) await start.click();
  const counted = inventory.getByTestId('inventory-row').filter({ hasText: name });
  await counted.getByTestId('inventory-found').click();
  await expect(counted).toContainText('vorhanden');
  page.once('dialog', (d) => void d.accept());
  await close.click();
  await expect(inventory.getByTestId('inventory-summary')).toContainText('abgeschlossen');
});
