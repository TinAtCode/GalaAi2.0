import { test, expect } from '@playwright/test';
import { loginViaUi } from './fixtures';

// Einkauf am Projekt über die Oberfläche: Projekt anlegen → Eingangsrechnung
// in den Finanzen erfassen und dem Projekt zuordnen → in der Nachkalkulation
// (Eingangsrechnungen, Deckungsbeitrag) sehen → über „ansehen“ zurück zur
// gefilterten Liste → Zuordnung aufheben.
test('Durchstich Einkauf: Eingangsrechnung am Projekt bis in die Nachkalkulation', async ({ page }) => {
  const run = String(Date.now()).slice(-6);
  const title = `Zaun ${run}`;
  const supplier = `Holzhandel ${run}`;
  page.on('dialog', (dialog) => void dialog.accept());

  await loginViaUi(page);
  await page.getByTestId('nav-customers').click();
  await page.getByTestId('customer-new-name').fill(`Familie Einkauf ${run}`);
  await page.getByTestId('customer-new-submit').click();
  await page.getByTestId('property-new-label').fill('Garten');
  await page.getByTestId('property-new-submit').click();
  await page.getByTestId('project-new-title').fill(title);
  await page.getByTestId('project-new-submit').click();
  await expect(page.getByTestId('project-heading')).toHaveText(title);
  const projectUrl = page.url();

  // Eingangsrechnung ohne Beleg, 595 € brutto / 500 € netto, dem Projekt zugeordnet
  await page.getByTestId('nav-finance').click();
  await page.getByTestId('finance-tab-payables').click();
  await page.getByTestId('payable-new').click();
  await page.getByTestId('payable-supplier').fill(supplier);
  await page.getByTestId('payable-number').fill(`HH-${run}`);
  await page.getByTestId('payable-amount').fill('595,00');
  await page.getByTestId('payable-net').fill('500,00');
  // Auswahl zeigt „P-Jahr-Nr · Titel“
  const option = page.getByTestId('payable-project').locator('option', { hasText: title });
  await page.getByTestId('payable-project').selectOption((await option.getAttribute('value'))!);
  await page.getByTestId('payable-save').click();

  const row = page.getByTestId('payable').filter({ hasText: supplier });
  await expect(row.getByTestId('payable-project-link')).toContainText(title);

  // Projekt: Nachkalkulation zeigt die Rechnung netto und zieht sie im Deckungsbeitrag ab
  await row.getByTestId('payable-project-link').click();
  await expect(page).toHaveURL(projectUrl);
  await expect(page.getByTestId('postcalc-purchases')).toContainText('1 · 500,00 € netto');
  await expect(page.getByTestId('postcalc-margin')).toContainText('− 500,00 €');
  await expect(page.getByTestId('postcalc-contribution')).toContainText('-500,00 €');

  // „ansehen“ → nur die Rechnungen dieses Projekts
  await page.getByTestId('postcalc-purchases').getByRole('link', { name: 'ansehen' }).click();
  await expect(page.getByTestId('payable-project-filter')).toContainText(title);
  await expect(page.getByTestId('payable')).toHaveCount(1);

  // Zuordnung aufheben: bearbeiten, „keinem Projekt“
  await row.getByTestId('payable-edit').click();
  await page.getByTestId('payable-project').selectOption({ label: '– keinem Projekt –' });
  await page.getByTestId('payable-save').click();
  await expect(page.getByTestId('payable')).toHaveCount(0); // Filter zeigt nur das Projekt
  await page.getByRole('button', { name: 'alle anzeigen' }).click();
  await expect(row.getByTestId('payable-project-link')).toHaveCount(0);

  // aufräumen
  await row.getByTestId('payable-more').click();
  await row.getByTestId('payable-delete').click();
  await expect(row).toHaveCount(0);
});
