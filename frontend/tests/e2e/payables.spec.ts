import { test, expect } from '@playwright/test';
import { API_BASE_URL, apiLogin, loginViaUi } from './fixtures';

const berlinDay = (offset = 0) =>
  new Date(Date.now() + offset * 86_400_000).toLocaleDateString('sv-SE', { timeZone: 'Europe/Berlin' });
const german = (iso: string) => iso.split('-').reverse().join('.');

// Eingangsrechnungen: E-Rechnung einlesen, prüfen, erfassen; der
// Kontoauszug verbucht die Zahlung (mit Skonto) automatisch
test.describe('Eingangsrechnungen', () => {
  test('E-Rechnung einlesen, erfassen und per Kontoauszug bezahlen', async ({ page, request }) => {
    const run = String(Date.now()).slice(-7);
    const number = `BL-${run}`;
    const today = berlinDay();
    const ubl = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>${number}</cbc:ID>
  <cbc:IssueDate>${today}</cbc:IssueDate>
  <cbc:DueDate>${berlinDay(30)}</cbc:DueDate>
  <cac:AccountingSupplierParty><cac:Party><cac:PartyLegalEntity>
    <cbc:RegistrationName>Baumschule Lorenz ${run} GmbH</cbc:RegistrationName>
  </cac:PartyLegalEntity></cac:Party></cac:AccountingSupplierParty>
  <cac:PaymentTerms><cbc:Note>#SKONTO#TAGE=10#PROZENT=2.00#
</cbc:Note></cac:PaymentTerms>
  <cac:LegalMonetaryTotal><cbc:PayableAmount currencyID="EUR">500.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
</Invoice>`;

    await loginViaUi(page);
    await page.getByTestId('nav-finance').click();
    await page.getByTestId('finance-tab-payables').click();
    await page.getByTestId('payable-upload').setInputFiles({
      name: `${number}.xml`,
      mimeType: 'application/xml',
      buffer: Buffer.from(ubl),
    });
    await expect(page.getByTestId('payable-source')).toContainText('E-Rechnung – Angaben exakt übernommen');
    await expect(page.getByTestId('payable-supplier')).toHaveValue(`Baumschule Lorenz ${run} GmbH`);
    await expect(page.getByTestId('payable-number')).toHaveValue(number);
    await expect(page.getByTestId('payable-amount')).toHaveValue('500,00');
    await expect(page.getByTestId('payable-discount')).toHaveValue('2');
    await expect(page.getByTestId('payable-discount-until')).toHaveValue(berlinDay(10));
    await page.getByTestId('payable-category').selectOption({ label: 'Material' });
    await page.getByTestId('payable-save').click();

    const row = page.getByTestId('payable').filter({ hasText: number });
    await expect(row.getByTestId('payable-plan')).toHaveText(
      `Mit 2 % Skonto bis ${german(berlinDay(10))}: 490,00 €`,
    );
    await expect(page.getByTestId('payable-summary')).toContainText('Ersparnis bei Zahlung mit Skonto');

    // Kontoauszug mit der Zahlung (abzüglich Skonto, Rechnungsnummer im Verwendungszweck)
    const token = await apiLogin(request);
    const camt = `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08"><BkToCstmrStmt>
<GrpHdr><MsgId>PAY-${run}</MsgId><CreDtTm>${today}T08:00:00</CreDtTm></GrpHdr>
<Stmt><Id>PAY-${run}</Id><CreDtTm>${today}T08:00:00</CreDtTm><Acct><Id><IBAN>DE44500105175407324931</IBAN></Id></Acct>
<Ntry><Amt Ccy="EUR">490.00</Amt><CdtDbtInd>DBIT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
<BookgDt><Dt>${today}</Dt></BookgDt><AcctSvcrRef>PAY-${run}-1</AcctSvcrRef><BkTxCd/>
<NtryDtls><TxDtls><RltdPties><Cdtr><Pty><Nm>Baumschule Lorenz</Nm></Pty></Cdtr></RltdPties>
<RmtInf><Ustrd>RE ${number} abzgl. Skonto</Ustrd></RmtInf></TxDtls></NtryDtls></Ntry>
</Stmt></BkToCstmrStmt></Document>`;
    const imported = await request.post(`${API_BASE_URL}/bank/import`, {
      headers: { Authorization: `Bearer ${token}` },
      multipart: { file: { name: 'auszug.xml', mimeType: 'application/xml', buffer: Buffer.from(camt) } },
    });
    expect(await imported.json()).toMatchObject({ payablesPaid: 1 });

    await page.getByTestId('payable-tab-paid').click();
    await expect(row.getByTestId('payable-paid')).toHaveText(
      `bezahlt am ${german(today)}: 490,00 € (laut Kontoauszug)`,
    );

    // aufräumen
    page.on('dialog', (dialog) => dialog.accept());
    await row.getByTestId('payable-more').click();
    await row.getByTestId('payable-delete').click();
    await expect(row).toHaveCount(0);
  });

  test('ohne Beleg erfassen, von Hand bezahlen; Liquiditätsvorschau', async ({ page }) => {
    const run = String(Date.now()).slice(-7);
    await loginViaUi(page);
    await page.getByTestId('nav-finance').click();
    await expect(page.getByTestId('forecast-week')).toHaveCount(13);

    await page.getByTestId('finance-tab-payables').click();
    await page.getByTestId('payable-new').click();
    await page.getByTestId('payable-supplier').fill(`Containerdienst ${run}`);
    await page.getByTestId('payable-amount').fill('238,00');
    await page.getByTestId('payable-due').fill(berlinDay(5));
    await page.getByTestId('payable-save').click();
    const row = page.getByTestId('payable').filter({ hasText: `Containerdienst ${run}` });
    await expect(row.getByTestId('payable-plan')).toHaveText(`zahlen bis ${german(berlinDay(5))}`);

    // taucht in der Vorschau der ersten Woche auf
    await page.getByTestId('finance-tab-overview').click();
    const week = page.getByTestId('forecast-week').first();
    await week.getByRole('button').click();
    await expect(page.getByTestId('forecast-items')).toContainText(
      `Eingangsrechnung: Containerdienst ${run} −238,00 €`,
    );

    await page.getByTestId('finance-tab-payables').click();
    await row.getByTestId('payable-pay-manual').click();
    await page.getByTestId('payable-pay-manual-save').click();
    await expect(row).toHaveCount(0);
    await page.getByTestId('payable-tab-paid').click();
    await expect(row.getByTestId('payable-paid')).toContainText('238,00 € (von Hand)');
    await row.getByTestId('payable-reopen').click();
    await expect(row).toHaveCount(0);
    await page.getByTestId('payable-tab-open').click();
    page.on('dialog', (dialog) => dialog.accept());
    await row.getByTestId('payable-more').click();
    await row.getByTestId('payable-delete').click();
    await expect(row).toHaveCount(0);
  });
});
