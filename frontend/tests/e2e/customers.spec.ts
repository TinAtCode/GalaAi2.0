import { test, expect } from '@playwright/test';
import { loginViaUi } from './fixtures';

// Vom neuen Kunden bis zum Projekt komplett in der Oberfläche.
test.describe('Kunden, Objekte, Projekte', () => {
  test('Kunde anlegen, Anschrift pflegen, Objekt und Projekt anlegen', async ({ page }) => {
    const name = `Familie Test ${Date.now()}`;
    await loginViaUi(page);
    await page.getByTestId('nav-customers').click();

    await page.getByTestId('customer-new-name').fill(name);
    await page.getByTestId('customer-new-submit').click();
    await expect(page.getByTestId('customer-heading')).toHaveText(name);

    await page.getByTestId('customer-street').fill('Birkenallee 7');
    await page.getByTestId('customer-postalCode').fill('53111');
    await page.getByTestId('customer-city').fill('Bonn');
    await page.getByTestId('customer-save').click();
    await expect(page.getByTestId('customer-saved')).toBeVisible();

    await page.getByTestId('property-new-label').fill('Ferienhaus');
    await page.getByTestId('property-new-city').fill('Bonn');
    await page.getByTestId('property-new-submit').click();
    await expect(page.getByTestId('property-card').filter({ hasText: 'Ferienhaus' })).toBeVisible();

    await page.getByTestId('project-new-title').fill('Hecke pflanzen');
    await page.getByTestId('project-new-submit').click();
    await expect(page.getByTestId('project-heading')).toHaveText('Hecke pflanzen');
    await expect(page.getByText(name)).toBeVisible(); // Link zurück zum Kunden

    // Nach dem Neuladen ist die Anschrift gespeichert
    await page.getByText(name).click();
    await expect(page.getByTestId('customer-street')).toHaveValue('Birkenallee 7');
  });
});
