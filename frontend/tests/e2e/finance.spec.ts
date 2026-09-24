import { test, expect } from '@playwright/test';
import { API_BASE_URL, apiLogin, loginViaUi } from './fixtures';

// Finanzbereich: Kontostand und Abbuchungen aus einem Kontoauszug,
// Monatsgrafik mit Tabellenansicht, Kontobewegungen mit Filter.
test.describe('Finanzen', () => {
  test('Kontostand, Monatsübersicht und Abbuchungen', async ({ page, request }) => {
    const run = String(Date.now());
    const iban = `DE44500105${run.slice(-12)}`;
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>FIN-${run}</MsgId><CreDtTm>2026-09-23T08:00:00</CreDtTm></GrpHdr>
    <Stmt>
      <Id>FIN-${run}</Id><CreDtTm>2026-09-23T08:00:00</CreDtTm>
      <Acct><Id><IBAN>${iban}</IBAN></Id></Acct>
      <Bal><Tp><CdOrPrtry><Cd>CLBD</Cd></CdOrPrtry></Tp><Amt Ccy="EUR">8421.07</Amt>
        <CdtDbtInd>CRDT</CdtDbtInd><Dt><Dt>2026-09-22</Dt></Dt></Bal>
      <Ntry>
        <Amt Ccy="EUR">89.95</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>2026-09-22</Dt></BookgDt><AcctSvcrRef>FIN-${run}-1</AcctSvcrRef><BkTxCd/>
        <NtryDtls><TxDtls>
          <RltdPties><Cdtr><Pty><Nm>Aral Tankstelle ${run}</Nm></Pty></Cdtr></RltdPties>
          <RmtInf><Ustrd>Diesel ${run}</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>
    </Stmt>
  </BkToCstmrStmt>
</Document>`;
    const token = await apiLogin(request);
    const imported = await request.post(`${API_BASE_URL}/bank/import`, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: { file: { name: 'auszug.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) } },
    });
    expect(await imported.json()).toMatchObject({ debits: 1, balances: 1 });

    await loginViaUi(page);
    await page.getByTestId('nav-finance').click();
    await expect(page.getByTestId('finance-balance')).toContainText(
      `${iban.slice(0, 4)} ${iban.slice(4, 8)} … ${iban.slice(-4)}: Stand 22.09.2026`,
    );
    await expect(page.getByTestId('finance-receivables')).toContainText('Offene Forderungen');

    // Monatsgrafik: Hover zeigt die Werte, Tabellenansicht mit zwölf Monaten
    await page.getByTestId('finance-chart-month').last().hover();
    await expect(page.getByTestId('finance-chart-tooltip')).toContainText('Ausgaben');
    await page.getByTestId('finance-chart-toggle').click();
    await expect(page.getByTestId('finance-month-table').locator('tbody tr')).toHaveCount(12);

    // Kontobewegungen: Suche und Filter
    await page.getByTestId('finance-tab-transactions').click();
    await page.getByTestId('finance-search').fill(run);
    await page.getByRole('button', { name: 'Suchen' }).click();
    const row = page.getByTestId('finance-transaction');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Aral Tankstelle');
    await expect(row.getByTestId('finance-transaction-amount')).toHaveText('−89,95 €');
    // Kategorie beim Import per Stichwort-Regel ("aral" -> Fahrzeuge)
    const category = row.getByTestId('finance-transaction-category');
    await expect(category.locator('option:checked')).toHaveText('Fahrzeuge');
    await expect(row).toContainText('per Regel');
    // von Hand ändern: gelernt, auf Wunsch als feste Regel
    await category.selectOption({ label: 'Maschinen' });
    await expect(page.getByTestId('finance-assigned')).toContainText(`Aral Tankstelle ${run} → Maschinen`);
    await page.getByTestId('finance-make-rule').click();
    await expect(page.getByTestId('finance-assigned')).toHaveCount(0);
    await page.getByTestId('finance-category-filter').selectOption({ label: 'Maschinen' });
    await expect(row).toHaveCount(1);
    await page.getByTestId('finance-direction').selectOption('credit');
    await expect(row).toHaveCount(0);

    await page.getByTestId('finance-tab-categories').click();
    const machines = page.getByTestId('category').filter({ hasText: 'Maschinen' });
    await expect(
      machines.getByTestId('category-rule').filter({ hasText: `aral tankstelle ${run}` }),
    ).toHaveCount(1);
    // aufräumen: Regel wieder entfernen
    await machines.getByRole('button', { name: `Regel aral tankstelle ${run} entfernen` }).click();
    await expect(machines.getByTestId('category-rule').filter({ hasText: run })).toHaveCount(0);
  });

  test('Kategorie mit Regel, Fixkosten und Jahresüberblick', async ({ page }) => {
    const run = String(Date.now()).slice(-6);
    const year = new Date().getFullYear();
    await loginViaUi(page);
    await page.getByTestId('nav-finance').click();

    // ältere Abbuchungen ohne Kategorie nachträglich zuordnen
    await page.getByTestId('finance-tab-transactions').click();
    await page.getByTestId('finance-categorize').click();
    await expect(page.getByTestId('finance-categorize-notice')).toBeVisible();

    await page.getByTestId('finance-tab-categories').click();
    await page.getByTestId('category-name').fill(`Entsorgung ${run}`);
    await page.getByRole('button', { name: 'Anlegen' }).click();
    const created = page.getByTestId('category').filter({ hasText: `Entsorgung ${run}` });
    await created.getByTestId('rule-pattern').fill(`deponie ${run}`);
    await created.getByTestId('rule-add').click();
    await expect(created.getByTestId('category-rule')).toHaveText(new RegExp(`deponie ${run}`));

    // Fixkosten anlegen, im Jahresüberblick als geplant im Dezember
    await page.getByTestId('finance-tab-recurring').click();
    await page.getByTestId('recurring-new').click();
    await page.getByTestId('recurring-name').fill(`Container ${run}`);
    await page.getByTestId('recurring-amount').fill('123,40');
    await page.getByTestId('recurring-interval').selectOption('yearly');
    await page.getByTestId('recurring-next-due').fill(`${year}-12-15`);
    await page
      .getByTestId('recurring-form')
      .getByRole('combobox')
      .last()
      .selectOption({ label: `Entsorgung ${run}` });
    await page.getByTestId('recurring-save').click();
    const entry = page.getByTestId('recurring').filter({ hasText: `Container ${run}` });
    await expect(entry).toContainText('123,40 € jährlich');
    await expect(entry).toContainText(`nächste Fälligkeit 15.12.${year}`);

    await page.getByTestId('finance-tab-year').click();
    await expect(page.getByTestId('year-title')).toHaveText(String(year));
    const december = page.getByTestId('year-month').last();
    await december.getByRole('button').click();
    await expect(page.getByTestId('year-month-details')).toContainText(
      `geplant 15.12.${year}: Container ${run} 123,40 €`,
    );
    await expect(page.getByTestId('year-categories')).toContainText(`Entsorgung ${run}`);
    await expect(page.getByTestId('year-table').locator('tbody tr[data-testid="year-month"]')).toHaveCount(
      12,
    );

    // aufräumen
    page.on('dialog', (dialog) => dialog.accept());
    await page.getByTestId('finance-tab-recurring').click();
    await entry.getByRole('button', { name: 'Löschen' }).click();
    await expect(entry).toHaveCount(0);
    await page.getByTestId('finance-tab-categories').click();
    await created.getByTestId('category-delete').click();
    await expect(created).toHaveCount(0);
  });
});
