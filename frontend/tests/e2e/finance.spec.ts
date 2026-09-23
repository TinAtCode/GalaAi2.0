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
          <RltdPties><Cdtr><Pty><Nm>Aral Tankstelle</Nm></Pty></Cdtr></RltdPties>
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
    await page.getByTestId('finance-search').fill(run);
    await page.getByRole('button', { name: 'Suchen' }).click();
    const row = page.getByTestId('finance-transaction');
    await expect(row).toHaveCount(1);
    await expect(row).toContainText('Aral Tankstelle');
    await expect(row.getByTestId('finance-transaction-amount')).toHaveText('−89,95 €');
    await page.getByTestId('finance-direction').selectOption('credit');
    await expect(row).toHaveCount(0);
  });
});
