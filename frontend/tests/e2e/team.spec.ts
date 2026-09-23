import { test, expect } from '@playwright/test';
import { loginViaUi, apiLogin, createCompletedTimeEntry } from './fixtures';

test.describe('Team – Zeiterfassungs-Freigabe', () => {
  test('ein abgeschlossener Zeiteintrag kann freigegeben werden', async ({ page, request }) => {
    const token = await apiLogin(request);
    await createCompletedTimeEntry(request, token);

    await loginViaUi(page);
    await page.getByTestId('nav-team').click();
    await expect(page).toHaveURL('/team');

    // Den Admin aus dem Seed gezielt auswählen – andere Tests (Benutzer-
    // verwaltung) legen weitere Mitarbeiter an.
    await page.getByTestId('team-employee-tab').filter({ hasText: 'Max Mustermann' }).click();
    const entry = page.getByTestId('time-entry-item').filter({ hasText: 'E2E-Test-Tätigkeit' }).first();
    await expect(entry).toBeVisible();
    await expect(entry.getByTestId('time-entry-status')).toHaveText('Abgeschlossen');

    await entry.getByTestId('time-entry-approve').click();
    await expect(entry.getByTestId('time-entry-status')).toHaveText('Freigegeben');
    // Nach Freigabe verschwindet der Freigeben-Button (nur bei "completed" sichtbar).
    await expect(entry.getByTestId('time-entry-approve')).toHaveCount(0);
  });

  test.skip('ohne employee.data.read-Berechtigung ist "Team" in der Navigation nicht sichtbar', async () => {
    // Dokumentiert das erwartete Verhalten für eine eingeschränkte Rolle;
    // übersprungen, solange es im Seed keinen zweiten User ohne diese
    // Berechtigung gibt (siehe STATUS.md: kein Rollen-Verwaltungs-UI).
  });
});
