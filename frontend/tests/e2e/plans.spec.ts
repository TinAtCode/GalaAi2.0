import { test, expect, Page } from '@playwright/test';
import { loginViaUi, SEED } from './fixtures';

// Klick in die Zeichenfläche, relativ zu ihrer linken oberen Ecke
async function clickAt(page: Page, x: number, y: number, options: { dblclick?: boolean } = {}) {
  const box = (await page.getByTestId('plan-canvas').boundingBox())!;
  if (options.dblclick) await page.mouse.dblclick(box.x + x, box.y + y);
  else await page.mouse.click(box.x + x, box.y + y);
}

// Lageplan: anlegen, Rasen mit Mähkante, Regenwasserleitung, Gully zeichnen,
// Maßstab kalibrieren, speichern, neu laden
test.describe('Lagepläne', () => {
  test('zeichnen, messen, Maßstab, speichern', async ({ page }) => {
    const run = String(Date.now()).slice(-6);
    await loginViaUi(page);
    await page.goto(`/projekte/${SEED.projectId}`);
    await page.getByTestId('plan-new-name').fill(`Garten ${run}`);
    await page.getByTestId('plan-create').click();
    await expect(page.getByTestId('plan-editor')).toBeVisible();
    await expect(page.getByTestId('plan-name')).toHaveValue(`Garten ${run}`);

    // Rasenfläche: drei Ecken, Doppelklick auf der vierten schließt
    await page.getByTestId('plan-tool-lawn').click();
    await clickAt(page, 100, 100);
    await clickAt(page, 300, 100);
    await clickAt(page, 300, 250);
    await clickAt(page, 100, 250, { dblclick: true });
    await expect(page.locator('[data-testid="plan-object"][data-type="lawn"]')).toHaveCount(1);
    await page.getByTestId('plan-mowing-edge').check();

    // Regenwasserleitung: zwei Punkte, Enter
    await page.getByTestId('plan-tool-rainwater').click();
    await clickAt(page, 350, 300);
    await clickAt(page, 550, 300);
    await page.keyboard.press('Enter');
    await expect(page.locator('[data-testid="plan-object"][data-type="rainwater"]')).toHaveCount(1);

    // Gully
    await page.getByTestId('plan-tool-gully').click();
    await clickAt(page, 560, 300);
    await expect(page.locator('[data-testid="plan-object"][data-type="gully"]')).toHaveCount(1);

    const quantities = page.getByTestId('plan-quantities');
    await expect(quantities).toContainText('Rasen');
    await expect(quantities).toContainText('Mähkante');
    await expect(quantities).toContainText('Gully / Ablauf1 Stk');

    // Maßstab: dieselbe Strecke wie die Leitung = 10 m
    await page.getByTestId('plan-tool-calibrate').click();
    await clickAt(page, 350, 300);
    await clickAt(page, 550, 300);
    await page.getByTestId('plan-calibration-meters').fill('10');
    await page.getByTestId('plan-calibration-apply').click();
    await expect(quantities).toContainText('Regenwasser10,00 m');
    // Rasen: 200 × 150 px bei 20 px je Meter = 10 × 7,5 m = 75 m², Mähkante 35 m
    await expect(quantities).toContainText('Rasen75,00 m²');
    await expect(quantities).toContainText('Mähkante35,00 m');

    // Rückgängig und wiederherstellen
    await page.getByTestId('plan-tool-select').click();
    await page.getByTestId('plan-undo').click();
    await expect(page.locator('[data-testid="plan-object"][data-type="gully"]')).toHaveCount(0);
    await page.keyboard.press('Control+y');
    await expect(page.locator('[data-testid="plan-object"][data-type="gully"]')).toHaveCount(1);

    await expect(page.getByTestId('plan-state')).toHaveText('nicht gespeichert');
    await page.getByTestId('plan-save').click();
    await expect(page.getByTestId('plan-state')).toHaveText('gespeichert');

    await page.reload();
    await expect(page.locator('[data-testid="plan-object"]')).toHaveCount(3);
    await expect(page.getByTestId('plan-quantities')).toContainText('Regenwasser10,00 m');

    // in der Projektliste
    await page.goto(`/projekte/${SEED.projectId}`);
    const item = page.getByTestId('plan-item').filter({ hasText: `Garten ${run}` });
    await expect(item).toContainText('3 Objekte');
    page.on('dialog', (dialog) => dialog.accept());
    await item.getByRole('button', { name: 'Löschen' }).click();
    await expect(item).toHaveCount(0);
  });
});
