import { test, expect } from '@playwright/test';
import { API_BASE_URL, apiLogin, loginViaUi, SEED } from './fixtures';

// minimale PDF mit Text-Layer (wie im Backend-Test), Seite breit genug für die Zeile
function textPdf(text: string) {
  const objects = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/Resources<</Font<</F1 4 0 R>>>>/MediaBox[0 0 800 200]/Contents 5 0 R>>',
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
  ];
  const stream = `BT /F1 12 Tf 20 150 Td (${text}) Tj ET`;
  objects.push(`<</Length ${stream.length}>>\nstream\n${stream}\nendstream`);
  let pdf = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(pdf.length);
    pdf += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  offsets.forEach((off) => (pdf += `${String(off).padStart(10, '0')} 00000 n \n`));
  pdf += `trailer\n<</Size ${objects.length + 1}/Root 1 0 R>>\nstartxref\n${xref}\n%%EOF`;
  return Buffer.from(pdf, 'binary');
}

test('Lieferschein: erkennen, bestätigen, am Projekt, Mail an Lieferanten', async ({ page, request }) => {
  const run = Date.now().toString().slice(-6);
  const token = await apiLogin(request);
  const headers = { Authorization: `Bearer ${token}` };
  const project = await (await request.get(`${API_BASE_URL}/projects/${SEED.projectId}`, { headers })).json();
  expect(project.number).toMatch(/^P-\d{4}-\d{4}$/);
  const supplierName = `Kiesmeyer${run} GmbH`;
  const supplier = await request.post(`${API_BASE_URL}/suppliers`, {
    headers,
    data: { name: supplierName, email: `info@kiesmeyer${run}.de`, customerNumber: `K-${run}` },
  });
  expect(supplier.ok()).toBeTruthy();

  await loginViaUi(page);
  await page.getByTestId('nav-delivery-notes').click();
  await page.getByTestId('delivery-upload').setInputFiles({
    name: `ls-${run}.pdf`,
    mimeType: 'application/pdf',
    buffer: textPdf(
      `Kiesmeyer${run} GmbH Lieferschein Nr. LS-${run} Datum: 24.09.2026 Ihr Zeichen ${project.number}`,
    ),
  });

  const card = page.getByTestId('delivery-open').filter({ hasText: `ls-${run}.pdf` });
  await expect(card.getByTestId('delivery-number')).toHaveValue(`LS-${run}`, { timeout: 15_000 });
  await expect(card.getByTestId('delivery-supplier').locator('option:checked')).toHaveText(supplierName);
  await expect(card.getByTestId('delivery-project').locator('option:checked')).toContainText(project.number);
  await card.getByTestId('delivery-confirm').click();
  await expect(page.getByTestId('delivery-confirmed').filter({ hasText: `LS-${run}` })).toBeVisible();

  await page.goto(`/projekte/${SEED.projectId}`);
  await expect(page.getByTestId('project-number')).toContainText(project.number);
  const section = page.getByTestId('project-delivery');
  await expect(section.getByTestId('project-delivery-note').filter({ hasText: `LS-${run}` })).toBeVisible();
  await section.getByTestId('supplier-mail-select').selectOption({ label: supplierName });
  await expect(section.getByTestId('supplier-mail-body')).toContainText(`Projektnummer: ${project.number}`);
  await expect(section.getByTestId('supplier-mail-body')).toContainText(`K-${run}`);
  await expect(section.getByTestId('supplier-mail-open')).toHaveAttribute('href', /^mailto:info%40kiesmeyer/);
});
