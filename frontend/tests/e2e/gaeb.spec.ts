import { test, expect } from '@playwright/test';
import { join } from 'path';
import { loginViaUi, SEED } from './fixtures';

// GAEB: Leistungsverzeichnis am Projekt einlesen – daraus wird ein
// Angebotsentwurf mit den Ordnungszahlen; die Abgabe (X84) erst mit Preisen.
// Playwright läuft im Ordner frontend (lokal und in der CI)
const lv = join(process.cwd(), '../backend/test/fixtures/gaeb/aussenanlagen.X83');

test('GAEB-Leistungsverzeichnis einlesen, Ordnungszahlen im Angebot, X84 erst mit Preisen', async ({
  page,
}) => {
  await loginViaUi(page);
  await page.goto(`/projekte/${SEED.projectId}`);
  await page.getByTestId('gaeb-upload').setInputFiles(lv);
  await expect(page.getByTestId('gaeb-message')).toContainText('Leistungsverzeichnis eingelesen');
  await expect(page.getByTestId('gaeb-message')).toContainText('01.0030 (Bedarfsposition');

  const card = page.getByTestId('quote-card').filter({ hasText: 'Oberboden abtragen' }).first();
  await expect(card.getByTestId('quote-line-oz').first()).toHaveText('01.0010');
  await expect(card.getByTestId('quote-status')).toHaveText('Entwurf');

  // ohne Preise: verständliche Meldung statt einer unbrauchbaren Datei
  await card.getByTestId('quote-gaeb').click();
  await expect(page.getByText('Mindestens eine Position hat noch keinen Preis')).toBeVisible();
});
