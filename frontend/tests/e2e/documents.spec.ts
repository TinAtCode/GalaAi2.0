import { test, expect } from '@playwright/test';
import { SEED, loginViaUi } from './fixtures';

// Minimale PDF mit Textebene (wie backend/test/fixtures/test-pdf.ts)
function buildTestPdf(text: string): Buffer {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 400 200]/Contents 5 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  const stream = `BT /F1 14 Tf 20 150 Td (${text}) Tj ET`;
  objects.push(`<</Length ${stream.length}>>\nstream\n${stream}\nendstream`);

  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xrefStart = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => {
    pdf += `${String(off).padStart(10, '0')} 00000 n \n`;
  });
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xrefStart}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
}

// Dokumente am Projekt: PDF mit Texterkennung hochladen, im Text suchen,
// herunterladen, löschen.
test.describe('Dokumente', () => {
  test('hochladen mit Texterkennung, suchen, herunterladen, löschen', async ({ page }) => {
    const run = String(Date.now());
    const fileName = `lieferschein-${run}.pdf`;
    await loginViaUi(page);
    await page.goto(`/projekte/${SEED.projectId}`);
    const section = page.getByTestId('documents-section');
    await section.getByTestId('document-type').selectOption('delivery_note');
    await section.getByTestId('document-upload').setInputFiles({
      name: fileName,
      mimeType: 'application/pdf',
      buffer: buildTestPdf(`Lieferschein ${run} Rasengittersteine 40 Stueck`),
    });
    const item = section.getByTestId('document-item').filter({ hasText: fileName });
    await expect(item).toContainText('Lieferschein');
    // die Texterkennung läuft im Hintergrund; die Liste lädt nach
    await expect(item.getByTestId('document-ocr-status')).toHaveText(' · Text erkannt', { timeout: 15000 });
    await expect(item.getByTestId('document-snippet')).toContainText('Rasengittersteine');

    await section.getByTestId('document-search').fill(run);
    await section.getByRole('button', { name: 'Suchen' }).click();
    await expect(section.getByTestId('document-item')).toHaveCount(1);
    await section.getByTestId('document-search').fill(`nichtvorhanden${run}`);
    await section.getByRole('button', { name: 'Suchen' }).click();
    await expect(section.getByTestId('document-item')).toHaveCount(0);
    await section.getByRole('button', { name: 'Alle zeigen' }).click();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      item.getByTestId('document-download').click(),
    ]);
    expect(download.suggestedFilename()).toBe(fileName);

    page.once('dialog', (dialog) => dialog.accept());
    await item.getByTestId('document-delete').click();
    await expect(item).toHaveCount(0);
  });
});
