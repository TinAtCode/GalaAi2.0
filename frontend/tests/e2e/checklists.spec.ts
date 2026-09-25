import { test, expect } from '@playwright/test';
import { SEED, loginViaUi } from './fixtures';

// Checklisten: Vorlage anlegen, Liste am Projekt daraus, abhaken, ergänzen,
// kommentieren und als neue Vorlage speichern
test('Checklisten: Vorlage, Liste am Projekt, abhaken und kommentieren', async ({ page }) => {
  const run = Date.now().toString().slice(-6);
  await loginViaUi(page);
  await page.getByTestId('nav-checklists').click();
  await page.getByTestId('template-title').fill(`Pflaster ${run}`);
  await page
    .getByTestId('template-items')
    .fill('Leitungen geortet\nUnterbau verdichtet\n\nSplittbett abgezogen');
  await page.getByTestId('template-save').click();
  await expect(page.getByTestId('template-card').filter({ hasText: `Pflaster ${run}` })).toContainText(
    '3 Punkte',
  );

  await page.goto(`/projekte/${SEED.projectId}`);
  const section = page.getByTestId('checklists');
  await section.getByTestId('checklist-template').selectOption({ label: `Pflaster ${run} (3)` });
  await expect(section.getByTestId('checklist-title')).toHaveValue(`Pflaster ${run}`);
  await section.getByTestId('checklist-add').click();

  const list = section.getByTestId('checklist').filter({ hasText: `Pflaster ${run}` });
  await expect(list.getByTestId('checklist-progress')).toContainText('0/3 erledigt');
  await list.getByTestId('checklist-check').first().check();
  await expect(list.getByTestId('checklist-progress')).toContainText('1/3 erledigt');

  await list.getByTestId('checklist-new-item').fill('Randsteine in Beton gesetzt');
  await list.getByTestId('checklist-new-item-add').click();
  await expect(list.getByTestId('checklist-progress')).toContainText('1/4 erledigt');

  const item = list.getByTestId('checklist-item').filter({ hasText: 'Unterbau verdichtet' });
  await item.getByTestId('checklist-comment').click();
  await list.getByTestId('checklist-comment-text').fill('Nachverdichten an der Garage');
  await list.getByTestId('checklist-comment-send').click();
  await expect(list.getByTestId('checklist-comment-row')).toContainText('Nachverdichten an der Garage');

  // als Einsatzplaner direkt als freigegebene Vorlage speichern
  page.once('dialog', (d) => void d.accept(`Pflaster erweitert ${run}`));
  await list.getByTestId('checklist-propose').click();
  await expect(section.getByTestId('checklist-message')).toContainText('Vorlage gespeichert');
  await page.goto('/checklisten');
  await expect(
    page.getByTestId('template-card').filter({ hasText: `Pflaster erweitert ${run}` }),
  ).toContainText('4 Punkte');
});
