import { test, expect, Page } from '@playwright/test';
import { loginViaUi, SEED } from './fixtures';

// hohes Fenster: Werkzeugleiste und Zeichenfläche ganz sichtbar (Klicks per Koordinate)
test.use({ viewport: { width: 1280, height: 1000 } });

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
    // Mengen ins Angebot: Rasen -> Leistung in m² (Menge 75 vorbelegt)
    await page.getByTestId('plan-to-quote').click();
    const lawnRow = page.getByTestId('plan-quote-row').filter({ hasText: 'Rasenfläche: 75 m²' });
    await lawnRow.getByTestId('plan-quote-service').selectOption({ label: '1 m² Terrasse verlegen (m²)' });
    await expect(lawnRow.getByTestId('plan-quote-quantity')).toHaveValue('75');
    // eindeutige Menge je Testlauf, um das neue Angebot sicher zu finden
    const quantity = String(100 + (Number(run) % 800));
    await lawnRow.getByTestId('plan-quote-quantity').fill(quantity);
    await page.getByTestId('plan-quote-create').click();
    await expect(page).toHaveURL(new RegExp(`/projekte/${SEED.projectId}$`));
    await expect(
      page.getByTestId('quote-line').filter({ hasText: `1 m² Terrasse verlegen (${quantity} m²)` }),
    ).toHaveCount(1);

    // in der Projektliste
    const item = page.getByTestId('plan-item').filter({ hasText: `Garten ${run}` });
    await expect(item).toContainText('3 Objekte');
    page.on('dialog', (dialog) => dialog.accept());
    await item.getByRole('button', { name: 'Löschen' }).click();
    await expect(item).toHaveCount(0);
  });

  test('Leitung unter der Rasenfläche: DN, Tiefe, Auswahl, Ebenen', async ({ page }) => {
    const run = String(Date.now()).slice(-6);
    await loginViaUi(page);
    await page.goto(`/projekte/${SEED.projectId}`);
    await page.getByTestId('plan-new-name').fill(`Leitungen ${run}`);
    await page.getByTestId('plan-create').click();
    await expect(page.getByTestId('plan-editor')).toBeVisible();

    await page.getByTestId('plan-tool-lawn').click();
    await clickAt(page, 100, 100);
    await clickAt(page, 400, 100);
    await clickAt(page, 400, 300);
    await clickAt(page, 100, 300, { dblclick: true });

    // Leitung quer durch den Rasen: Klicks innerhalb der Fläche setzen Punkte
    await page.getByTestId('plan-tool-rainwater').click();
    await clickAt(page, 150, 200);
    await clickAt(page, 350, 200);
    await page.keyboard.press('Enter');
    const pipe = page.locator('[data-testid="plan-object"][data-type="rainwater"]');
    await expect(pipe).toHaveCount(1);
    await page.getByTestId('plan-dn').selectOption('110');
    await page.getByTestId('plan-depth').fill('0,8');
    await page.getByTestId('plan-depth').blur();
    await expect(pipe).toContainText('DN 110 · 0,80 m tief');
    await expect(page.getByTestId('plan-quantities')).toContainText('Regenwasser DN 110');

    // Klick auf die Leitung (über dem Rasen) wählt die Leitung
    await page.getByTestId('plan-tool-select').click();
    await page.keyboard.press('Escape');
    await clickAt(page, 250, 200);
    await expect(page.getByTestId('plan-selection')).toContainText('Regenwasser');

    // Ebenen: Flächen ausblenden, Leitung bleibt sichtbar; Flächen blass
    await page.getByTestId('plan-layer-Flächen').uncheck();
    await expect(page.locator('[data-testid="plan-object"][data-type="lawn"]')).toHaveCount(0);
    await expect(pipe).toHaveCount(1);
    await page.getByTestId('plan-layer-Flächen').check();
    await page.getByTestId('plan-pale-areas').check();
    await expect(page.locator('[data-testid="plan-object"][data-type="lawn"] path').first()).toHaveAttribute(
      'fill-opacity',
      '0.3',
    );

    await page.getByTestId('plan-save').click();
    await expect(page.getByTestId('plan-state')).toHaveText('gespeichert');
    await page.reload();
    await expect(page.locator('[data-testid="plan-object"][data-type="rainwater"]')).toContainText(
      'DN 110 · 0,80 m tief',
    );

    await page.goto(`/projekte/${SEED.projectId}`);
    page.on('dialog', (dialog) => dialog.accept());
    const item = page.getByTestId('plan-item').filter({ hasText: `Leitungen ${run}` });
    await item.getByRole('button', { name: 'Löschen' }).click();
    await expect(item).toHaveCount(0);
  });

  test('exakte Maße: Rechteck per Längeneingabe, Kante fixieren, Tiefe ändern', async ({ page }) => {
    const run = String(Date.now()).slice(-6);
    await loginViaUi(page);
    await page.goto(`/projekte/${SEED.projectId}`);
    await page.getByTestId('plan-new-name').fill(`Maße ${run}`);
    await page.getByTestId('plan-create').click();
    await expect(page.getByTestId('plan-editor')).toBeVisible();
    const box = (await page.getByTestId('plan-canvas').boundingBox())!;
    const move = (x: number, y: number) => page.mouse.move(box.x + x, box.y + y);
    const entry = page.getByTestId('plan-length-entry');

    // Rechteck 10 × 4 m: Punkt A, dann Längen in Richtung der Maus; mit
    // gedrückter Umschalttaste genau waagerecht bzw. senkrecht
    await page.getByTestId('plan-tool-lawn').click();
    await clickAt(page, 120, 80);
    await page.keyboard.down('Shift');
    for (const [x, y, m] of [
      [400, 82, '10'],
      [330, 300, '4'],
      [20, 300, '10'],
    ] as const) {
      await move(x, y);
      await entry.fill(m);
      await entry.press('Enter');
    }
    await page.keyboard.up('Shift');
    await page.getByTestId('plan-finish').click();
    const quantities = page.getByTestId('plan-quantities');
    await expect(quantities).toContainText('Rasen40,00 m²');

    // Kanten A–B, B–C, C–D, D–A
    const segment = page.getByTestId('plan-segment');
    await expect(segment).toHaveCount(4);
    await expect(segment.nth(0)).toHaveValue('10,00');
    await expect(segment.nth(1)).toHaveValue('4,00');

    // ohne Fixierung: Breite A–B auf 12 m, das Rechteck bleibt rechteckig (B und C wandern)
    await segment.nth(0).fill('12');
    await segment.nth(0).press('Enter');
    await expect(quantities).toContainText('Rasen48,00 m²');
    await expect(segment.nth(2)).toHaveValue('12,00');
    await expect(segment.nth(3)).toHaveValue('4,00');
    // Eingabe und direkt in die leere Zeichenfläche klicken (Auswahl endet): wird trotzdem übernommen
    await page.getByTestId('plan-tool-select').click();
    await segment.nth(0).fill('10');
    await clickAt(page, 550, 250);
    await expect(page.getByTestId('plan-selection')).toHaveCount(0);
    await expect(quantities).toContainText('Rasen40,00 m²');
    const lawnPath = page.locator('[data-testid="plan-object"][data-type="lawn"] path').first();
    const area = (await lawnPath.boundingBox())!;
    await page.mouse.click(area.x + area.width / 2, area.y + area.height / 2);
    await expect(segment.nth(0)).toHaveValue('10,00');

    // Kante A–B fixieren, Tiefe B–C auf 6 m: C und D wandern mit
    const fix = page.getByTestId('plan-fix-point');
    await fix.nth(0).click();
    await fix.nth(1).click();
    await segment.nth(1).fill('6');
    await segment.nth(1).press('Enter');
    await expect(quantities).toContainText('Rasen60,00 m²');
    await expect(segment.nth(0)).toHaveValue('10,00');
    await expect(segment.nth(2)).toHaveValue('10,00');
    await expect(segment.nth(3)).toHaveValue('6,00');

    // fixiert: Ziehen verschiebt nicht
    await page.getByTestId('plan-tool-select').click();
    await expect(page.getByTestId('plan-vertex-fixed')).toHaveCount(2);
    const lawn = page.locator('[data-testid="plan-object"][data-type="lawn"] path').first();
    const before = await lawn.getAttribute('d');
    const inside = (await lawn.boundingBox())!;
    await page.mouse.move(inside.x + inside.width / 2, inside.y + inside.height / 2);
    await page.mouse.down();
    await page.mouse.move(inside.x + inside.width / 2 + 60, inside.y + inside.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    await expect(lawn).toHaveAttribute('d', before!);

    // Fixierung lösen: jetzt verschiebt sich die ganze Fläche, Maße bleiben
    await fix.nth(0).click();
    await fix.nth(1).click();
    await page.mouse.move(inside.x + inside.width / 2, inside.y + inside.height / 2);
    await page.mouse.down();
    await page.mouse.move(inside.x + inside.width / 2 + 60, inside.y + inside.height / 2 + 40, { steps: 5 });
    await page.mouse.up();
    await expect(lawn).not.toHaveAttribute('d', before!);
    await expect(quantities).toContainText('Rasen60,00 m²');

    await page.getByTestId('plan-save').click();
    await expect(page.getByTestId('plan-state')).toHaveText('gespeichert');
    await page.goto(`/projekte/${SEED.projectId}`);
    page.on('dialog', (dialog) => dialog.accept());
    const item = page.getByTestId('plan-item').filter({ hasText: `Maße ${run}` });
    await item.getByRole('button', { name: 'Löschen' }).click();
    await expect(item).toHaveCount(0);
  });

  test('Rundungen: Eckradien, Punkte einfügen/löschen, Bogen, Kreis und Schacht', async ({ page }) => {
    const run = String(Date.now()).slice(-6);
    await loginViaUi(page);
    await page.goto(`/projekte/${SEED.projectId}`);
    await page.getByTestId('plan-new-name').fill(`Rundungen ${run}`);
    await page.getByTestId('plan-create').click();
    await expect(page.getByTestId('plan-editor')).toBeVisible();
    const box = (await page.getByTestId('plan-canvas').boundingBox())!;
    const move = (x: number, y: number) => page.mouse.move(box.x + x, box.y + y);
    const entry = page.getByTestId('plan-length-entry');
    const quantities = page.getByTestId('plan-quantities');

    // Pflaster 10 × 6 m
    await page.getByTestId('plan-tool-paving').click();
    await clickAt(page, 120, 80);
    await page.keyboard.down('Shift');
    for (const [x, y, m] of [
      [400, 82, '10'],
      [330, 300, '6'],
      [20, 300, '10'],
    ] as const) {
      await move(x, y);
      await entry.fill(m);
      await entry.press('Enter');
    }
    await page.keyboard.up('Shift');
    await page.getByTestId('plan-finish').click();
    await expect(quantities).toContainText('Pflaster60,00 m²');

    // alle vier Ecken mit 1 m abrunden: 60 − (4 − π) m²
    const radius = page.getByTestId('plan-corner-radius');
    await expect(radius).toHaveCount(4);
    for (let i = 0; i < 4; i++) {
      await radius.nth(i).fill('1');
      await radius.nth(i).press('Enter');
    }
    await expect(quantities).toContainText('Pflaster59,14 m²');

    // Punkt auf der Kante A–B einfügen und wieder löschen
    await page.getByTestId('plan-tool-select').click();
    await page.getByTestId('plan-insert-point').first().click();
    await expect(page.getByTestId('plan-point')).toHaveCount(5);
    await expect(page.getByTestId('plan-segment').nth(0)).toHaveValue('5,00');
    await expect(quantities).toContainText('Pflaster59,14 m²');
    await page.getByTestId('plan-delete-point').nth(1).click();
    await expect(page.getByTestId('plan-point')).toHaveCount(4);
    await expect(page.getByTestId('plan-segment').nth(0)).toHaveValue('10,00');

    // Kante C–D als Bogen nach außen: Halbkreis mit r = 5 m (Ecken C, D dann spitz)
    await page.getByTestId('plan-edge-bulge').nth(2).selectOption('1');
    await expect(page.getByTestId('plan-edge-radius')).toHaveValue('5,00');
    const bulged = await quantities.innerText();
    const area = Number(/Pflaster\s*([\d.,]+) m²/.exec(bulged)![1].replace('.', '').replace(',', '.'));
    expect(area).toBeGreaterThan(98.8);
    expect(area).toBeLessThan(98.9);
    // Radius größer: flacherer Bogen, weniger Fläche
    await page.getByTestId('plan-edge-radius').fill('8');
    await page.getByTestId('plan-edge-radius').press('Enter');
    await expect(quantities).not.toContainText(bulged.match(/Pflaster\s*[\d.,]+ m²/)![0]);

    // Schacht: Kreis mit Durchmesser 1 m, danach auf 0,8 m ändern
    await page.getByTestId('plan-tool-manhole').click();
    await expect(page.getByTestId('plan-draw-circle')).toBeChecked();
    await clickAt(page, 500, 200);
    await move(560, 200);
    await entry.fill('1');
    await entry.press('Enter');
    await expect(quantities).toContainText('Schacht Ø 1,00 m1 Stk');
    await page.getByTestId('plan-diameter').fill('0,8');
    await page.getByTestId('plan-diameter').press('Enter');
    await expect(quantities).toContainText('Schacht Ø 0,80 m1 Stk');

    // Rasen als Kreis (Ø 4 m) mit Mähkante
    await page.getByTestId('plan-tool-lawn').click();
    await page.getByTestId('plan-draw-circle').check();
    await clickAt(page, 520, 80);
    await move(600, 80);
    await entry.fill('4');
    await entry.press('Enter');
    await page.getByTestId('plan-mowing-edge').check();
    await expect(quantities).toContainText('Rasen12,57 m²');
    await expect(quantities).toContainText('Mähkante12,57 m');

    // speichern und neu laden: gleiche Mengen vom Server
    const shown = (await quantities.textContent())!;
    await page.getByTestId('plan-save').click();
    await expect(page.getByTestId('plan-state')).toHaveText('gespeichert');
    await page.reload();
    await expect(page.getByTestId('plan-quantities')).toHaveText(shown);

    await page.goto(`/projekte/${SEED.projectId}`);
    page.on('dialog', (dialog) => dialog.accept());
    const item = page.getByTestId('plan-item').filter({ hasText: `Rundungen ${run}` });
    await item.getByRole('button', { name: 'Löschen' }).click();
    await expect(item).toHaveCount(0);
  });

  test('DXF-Import: Layer zuordnen, Mengen aus der Zeichnung', async ({ page }) => {
    const run = String(Date.now()).slice(-6);
    await loginViaUi(page);
    await page.goto(`/projekte/${SEED.projectId}`);
    await page.getByTestId('plan-new-name').fill(`DXF ${run}`);
    await page.getByTestId('plan-create').click();
    await expect(page.getByTestId('plan-editor')).toBeVisible();

    // Zeichnung in Metern: Rasen 10 × 4 m, Regenwasserleitung 12 m, Hilfslinie, Text
    const entities = [
      ['0', 'LWPOLYLINE', '8', 'Rasen', '90', '4', '70', '1'],
      ['10', '0', '20', '0', '10', '10', '20', '0', '10', '10', '20', '4', '10', '0', '20', '4'],
      ['0', 'LINE', '8', 'RW_Leitung', '10', '0', '20', '-2', '11', '12', '21', '-2'],
      ['0', 'LINE', '8', 'Hilfslinien', '10', '0', '20', '0', '11', '5', '21', '5'],
      ['0', 'TEXT', '8', 'Beschriftung', '10', '1', '20', '1', '1', 'Spielwiese'],
    ].flat();
    const text = [
      ...['0', 'SECTION', '2', 'HEADER', '9', '$INSUNITS', '70', '6', '0', 'ENDSEC'],
      ...['0', 'SECTION', '2', 'ENTITIES', ...entities, '0', 'ENDSEC', '0', 'EOF'],
    ].join('\n');
    await page.getByTestId('plan-dxf').setInputFiles({
      name: 'garten.dxf',
      mimeType: 'application/dxf',
      buffer: Buffer.from(text),
    });
    const dialog = page.getByTestId('dxf-import');
    await expect(dialog).toBeVisible();
    // erraten: Rasen, Regenwasser, Beschriftung; Hilfslinien ausgelassen
    await expect(dialog.locator('[data-layer="Rasen"]')).toHaveValue('lawn');
    await expect(dialog.locator('[data-layer="RW_Leitung"]')).toHaveValue('rainwater');
    await expect(dialog.locator('[data-layer="Hilfslinien"]')).toHaveValue('');
    await expect(page.getByTestId('dxf-summary')).toContainText('3 Objekte');
    await page.getByTestId('dxf-apply').click();

    const quantities = page.getByTestId('plan-quantities');
    await expect(quantities).toContainText('Rasen40,00 m²');
    await expect(quantities).toContainText('Regenwasser12,00 m');
    await expect(page.locator('[data-testid="plan-object"][data-type="text"]')).toContainText('Spielwiese');
    // Rückgängig nimmt den ganzen Import zurück
    await page.getByTestId('plan-undo').click();
    await expect(page.getByTestId('plan-object')).toHaveCount(0);
    await page.goto(`/projekte/${SEED.projectId}`);
    page.on('dialog', (d) => d.accept());
    const item = page.getByTestId('plan-item').filter({ hasText: `DXF ${run}` });
    await item.getByRole('button', { name: 'Löschen' }).click();
    await expect(item).toHaveCount(0);
  });
});
