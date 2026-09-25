import { test, expect } from '@playwright/test';
import { SEED, loginViaUi } from './fixtures';

// Bautagebuch am Projekt: Tag schreiben, Verzögerung mit Ursache, Liste und Summe
test('Bautagebuch: Eintrag mit Verzögerung', async ({ page }) => {
  const run = Date.now().toString().slice(-6);
  await loginViaUi(page);
  await page.goto(`/projekte/${SEED.projectId}`);
  const diary = page.getByTestId('diary');
  await diary.getByTestId('diary-weather').selectOption('rain');
  await diary.getByTestId('diary-temperature').fill('9');
  await diary.getByTestId('diary-crew').fill('Max, Lena');
  await diary.getByTestId('diary-work').fill(`Unterbau verdichtet ${run}`);
  await diary.getByTestId('diary-delayHours').fill('2,5');
  // (der heutige Eintrag kann aus einem früheren Lauf stammen: Ursache leeren)
  await diary.getByTestId('diary-delayReason').selectOption('');
  // Stunden ohne Ursache: der Server lehnt ab
  await diary.getByTestId('diary-save').click();
  await expect(diary.getByTestId('diary-message')).toContainText('Ursache');
  await diary.getByTestId('diary-delayReason').selectOption('weather');
  await diary.getByTestId('diary-delayNote').fill('Starkregen ab Mittag');
  await diary.getByTestId('diary-save').click();
  await expect(diary.getByTestId('diary-message')).toContainText('gespeichert');

  const entry = diary.getByTestId('diary-entry').filter({ hasText: `Unterbau verdichtet ${run}` });
  await expect(entry).toContainText('Regen 9 °C');
  await expect(entry).toContainText('Verzögerung 2,5 h (Wetter): Starkregen ab Mittag');
  await expect(diary.getByTestId('diary-delays')).toContainText('Wetter');

  // nach dem Neuladen steht der Eintrag im Formular des heutigen Tages
  await page.reload();
  await expect(page.getByTestId('diary').getByTestId('diary-work')).toHaveValue(`Unterbau verdichtet ${run}`);
});
