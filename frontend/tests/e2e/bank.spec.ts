import { test, expect } from '@playwright/test';
import { API_BASE_URL, apiLogin, createDraftQuote, loginViaUi } from './fixtures';

// Minimaler Kontoauszug camt.053.001.08 mit zwei Gutschriften
function camt(run: string, entries: { amount: string; name: string; text: string }[]) {
  const ntry = entries
    .map(
      (e, i) => `
      <Ntry>
        <Amt Ccy="EUR">${e.amount}</Amt><CdtDbtInd>CRDT</CdtDbtInd><Sts><Cd>BOOK</Cd></Sts>
        <BookgDt><Dt>2026-09-22</Dt></BookgDt><AcctSvcrRef>E2E-${run}-${i}</AcctSvcrRef>
        <BkTxCd/>
        <NtryDtls><TxDtls>
          <RltdPties><Dbtr><Pty><Nm>${e.name}</Nm></Pty></Dbtr></RltdPties>
          <RmtInf><Ustrd>${e.text}</Ustrd></RmtInf>
        </TxDtls></NtryDtls>
      </Ntry>`,
    )
    .join('');
  return `<?xml version="1.0" encoding="UTF-8"?>
<Document xmlns="urn:iso:std:iso:20022:tech:xsd:camt.053.001.08">
  <BkToCstmrStmt>
    <GrpHdr><MsgId>E2E-${run}</MsgId><CreDtTm>2026-09-23T08:00:00</CreDtTm></GrpHdr>
    <Stmt>
      <Id>E2E-${run}</Id><CreDtTm>2026-09-23T08:00:00</CreDtTm>
      <Acct><Id><IBAN>DE89370400440532013000</IBAN></Id></Acct>${ntry}
    </Stmt>
  </BkToCstmrStmt>
</Document>`;
}

// Kontoauszug einlesen, Zahlung der Rechnung zuordnen und buchen.
test.describe('Bankabgleich', () => {
  test('CAMT.053 einlesen, Vorschlag buchen, Umsatz ignorieren', async ({ page, request }) => {
    const token = await apiLogin(request);
    const headers = { Authorization: `Bearer ${token}` };
    await request.patch(`${API_BASE_URL}/company/settings`, {
      headers,
      data: { street: 'Hauptstraße 5', postalCode: '12345', city: 'Musterstadt', taxNumber: '123/456/78901' },
    });
    const quoteId = await createDraftQuote(request, token);
    await request.post(`${API_BASE_URL}/quotes/${quoteId}/approve`, { headers });
    await request.post(`${API_BASE_URL}/quotes/${quoteId}/send`, { headers });
    await request.post(`${API_BASE_URL}/quotes/${quoteId}/outcome`, {
      headers,
      data: { status: 'accepted' },
    });
    const order = await (await request.post(`${API_BASE_URL}/orders`, { headers, data: { quoteId } })).json();
    const draft = await (
      await request.post(`${API_BASE_URL}/invoices/from-order`, {
        headers,
        data: { orderId: order.id, kind: 'final' },
      })
    ).json();
    const issued = await (
      await request.post(`${API_BASE_URL}/invoices/${draft.id}/issue`, { headers, data: {} })
    ).json();
    const run = String(Date.now());
    const xml = camt(run, [
      { amount: Number(issued.totalGross).toFixed(2), name: 'Familie Linde', text: `RE ${issued.number}` },
      { amount: '12.34', name: `Unbekannt ${run}`, text: `Spende ${run}` },
    ]);

    await loginViaUi(page);
    await page.getByTestId('nav-bank').click();
    await page
      .getByTestId('bank-import')
      .setInputFiles({ name: 'auszug.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
    await expect(page.getByTestId('bank-notice')).toHaveText('2 Zahlungseingänge eingelesen.');

    const paid = page.getByTestId('bank-transaction').filter({ hasText: `RE ${issued.number}` });
    await expect(paid.getByTestId('bank-suggestion')).toContainText(`Vorschlag: ${issued.number}`);
    await expect(paid.getByTestId('bank-invoice')).toHaveValue(issued.id);
    await paid.getByTestId('bank-book').click();
    const gross = Number(issued.totalGross).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
    await expect(page.getByTestId('bank-notice')).toHaveText(`${gross} auf ${issued.number} gebucht.`);
    await expect(paid).toHaveCount(0);

    // unbekannter Umsatz: ignorieren, im Reiter "Ignoriert" wieder öffnen
    const unknown = page.getByTestId('bank-transaction').filter({ hasText: `Spende ${run}` });
    await unknown.getByTestId('bank-ignore').click();
    await expect(unknown).toHaveCount(0);
    await page.getByTestId('bank-tab-ignored').click();
    await unknown.getByTestId('bank-reopen').click();
    await expect(unknown).toHaveCount(0);
    await page.getByTestId('bank-tab-booked').click();
    await expect(paid).toContainText('gebucht');
    await expect(paid.getByTestId('bank-payments')).toHaveText(`Gebucht: ${gross} auf ${issued.number}`);

    // derselbe Auszug noch einmal: nichts doppelt
    await page
      .getByTestId('bank-import')
      .setInputFiles({ name: 'auszug.xml', mimeType: 'application/xml', buffer: Buffer.from(xml) });
    await expect(page.getByTestId('bank-notice')).toHaveText(
      '0 Zahlungseingänge eingelesen, 2 schon vorhanden.',
    );

    // Rechnung bezahlt: nicht mehr in den offenen Posten
    await page.getByTestId('nav-open-items').click();
    await expect(page.locator(`[data-testid="open-item"][data-invoice-id="${issued.id}"]`)).toHaveCount(0);
  });
});
