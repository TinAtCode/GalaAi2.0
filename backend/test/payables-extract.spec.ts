import { Prisma } from '@prisma/client';
import { buildXRechnung, XRechnungInput } from '../src/invoices/xrechnung';
import { renderBusinessDocumentPdf } from '../src/pdf/business-document.pdf';
import { parseEInvoice } from '../src/finance/payables/einvoice';
import { extractFromText, parseAmountText, validIban } from '../src/finance/payables/extract-text';
import { embeddedInvoiceXml } from '../src/finance/payables/pdf-attachment';

const D = (n: string) => new Prisma.Decimal(n);

// Eine Rechnung, wie sie ein anderer GaLaBau-Betrieb mit dieser Software stellt
const input: XRechnungInput = {
  kind: 'final',
  number: 'R-2026-0042',
  issueDate: new Date('2026-09-10T10:00:00Z'),
  servicePeriodStart: null,
  servicePeriodEnd: new Date('2026-09-05T10:00:00Z'),
  timeZone: 'Europe/Berlin',
  buyerReference: 'Pflaster',
  seller: {
    name: 'Stein & Kies <Nord> GmbH',
    street: 'Hafenweg 3',
    postalCode: '20095',
    city: 'Hamburg',
    email: 'info@stein.example',
    contactName: 'Jan Stein',
    phone: '+49 40 123456',
    taxNumber: '12/345/67890',
    vatId: 'DE123456789',
    iban: 'DE89370400440532013000',
    bic: null,
    paymentTermDays: 14,
  },
  buyer: {
    name: 'Grün GmbH',
    street: 'Weg 1',
    postalCode: '10115',
    city: 'Berlin',
    email: 'buha@gruen.example',
  },
  vatTreatment: 'standard',
  vatRate: D('19.00'),
  totalNet: D('1000.00'),
  totalVat: D('190.00'),
  totalGross: D('1190.00'),
  notes: [],
  lines: [
    {
      description: 'Pflastersteine',
      unit: 'm²',
      quantity: D('40'),
      unitPrice: D('25'),
      lineTotal: D('1000.00'),
    },
  ],
};

describe('E-Rechnung einlesen', () => {
  it('XRechnung (CII): Lieferant, Nummer, Daten, Beträge, IBAN', () => {
    expect(parseEInvoice(buildXRechnung(input))).toEqual({
      supplierName: 'Stein & Kies <Nord> GmbH',
      supplierIban: 'DE89370400440532013000',
      invoiceNumber: 'R-2026-0042',
      invoiceDate: '2026-09-10',
      dueDate: '2026-09-24',
      amount: '1190.00',
      netAmount: '1000.00',
      vatAmount: '190.00',
      discountPercent: null,
      discountUntil: null,
    });
  });

  it('ZUGFeRD: eingebettete XML aus der PDF', async () => {
    const xml = buildXRechnung(input);
    const pdf = await renderBusinessDocumentPdf({
      title: 'Rechnung R-2026-0042',
      draft: false,
      seller: { name: 'Stein & Kies GmbH', street: 'Hafenweg 3', postalCode: '20095', city: 'Hamburg' },
      buyer: { name: 'Grün GmbH', street: 'Weg 1', postalCode: '10115', city: 'Berlin' },
      meta: [['Rechnungsdatum', '10.09.2026']],
      lines: [
        {
          position: 1,
          description: 'Pflastersteine',
          quantity: '40',
          unit: 'm²',
          unitPrice: '25',
          lineTotal: '1000',
        },
      ],
      totals: { net: '1000', vatRate: '19', vat: '190', gross: '1190' },
      notes: [],
      eInvoiceXml: Buffer.from(xml),
    });
    const embedded = await embeddedInvoiceXml(pdf);
    expect(embedded).not.toBeNull();
    expect(parseEInvoice(embedded!)?.invoiceNumber).toBe('R-2026-0042');
    // PDF ohne Anhang
    const plain = await renderBusinessDocumentPdf({
      title: 'Angebot',
      draft: true,
      seller: { name: 'A', street: 'B', postalCode: '1', city: 'C' },
      buyer: { name: 'D', street: 'E', postalCode: '2', city: 'F' },
      meta: [],
      lines: [],
      totals: { net: '0', vatRate: '19', vat: '0', gross: '0' },
      notes: [],
    });
    expect(await embeddedInvoiceXml(plain)).toBeNull();
    expect(await embeddedInvoiceXml(Buffer.from('keine pdf'))).toBeNull();
  });

  it('UBL mit Skonto nach XRechnung-Konvention', () => {
    const ubl = `<?xml version="1.0" encoding="UTF-8"?>
<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"
  xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2"
  xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
  <cbc:ID>2026-7781</cbc:ID>
  <cbc:IssueDate>2026-09-01</cbc:IssueDate>
  <cbc:DueDate>2026-10-01</cbc:DueDate>
  <cac:AccountingSupplierParty><cac:Party>
    <cac:PartyName><cbc:Name>Baumschule Lorenz</cbc:Name></cac:PartyName>
    <cac:PartyLegalEntity><cbc:RegistrationName>Baumschule Lorenz GmbH &amp; Co. KG</cbc:RegistrationName></cac:PartyLegalEntity>
  </cac:Party></cac:AccountingSupplierParty>
  <cac:PaymentMeans><cbc:PaymentMeansCode>58</cbc:PaymentMeansCode>
    <cac:PayeeFinancialAccount><cbc:ID>DE02 1203 0000 0000 2020 51</cbc:ID></cac:PayeeFinancialAccount></cac:PaymentMeans>
  <cac:PaymentTerms><cbc:Note>#SKONTO#TAGE=10#PROZENT=3.00#
</cbc:Note></cac:PaymentTerms>
  <cac:TaxTotal><cbc:TaxAmount currencyID="EUR">95.00</cbc:TaxAmount></cac:TaxTotal>
  <cac:LegalMonetaryTotal>
    <cbc:TaxExclusiveAmount currencyID="EUR">500.00</cbc:TaxExclusiveAmount>
    <cbc:TaxInclusiveAmount currencyID="EUR">595.00</cbc:TaxInclusiveAmount>
    <cbc:PayableAmount currencyID="EUR">595.00</cbc:PayableAmount>
  </cac:LegalMonetaryTotal>
</Invoice>`;
    expect(parseEInvoice(ubl)).toEqual({
      supplierName: 'Baumschule Lorenz GmbH & Co. KG',
      supplierIban: 'DE02120300000000202051',
      invoiceNumber: '2026-7781',
      invoiceDate: '2026-09-01',
      dueDate: '2026-10-01',
      amount: '595.00',
      netAmount: '500.00',
      vatAmount: '95.00',
      discountPercent: '3.00',
      discountUntil: '2026-09-11',
    });
  });

  it('keine E-Rechnung bzw. DOCTYPE', () => {
    expect(parseEInvoice('<Document><BkToCstmrStmt/></Document>')).toBeNull();
    expect(() => parseEInvoice('<!DOCTYPE x [<!ENTITY a "b">]><Invoice/>')).toThrow();
  });
});

describe('Rechnungstext auswerten', () => {
  const text = `Baustoffe Müller KG
Industriestraße 5 · 50667 Köln
Grün GmbH, Weg 1, 10115 Berlin
RECHNUNG
Rechnungsnummer: RE-26/1187
Rechnungsdatum: 03.09.2026
Pos. Artikel Menge Preis
1 Split 2/5 12 t 38,50 462,00
2 Kies 16/32 8 t 29,00 232,00
Zwischensumme netto 694,00 €
zzgl. 19 % MwSt. 131,86 €
Rechnungsbetrag 825,86 €
Zahlbar innerhalb 30 Tagen. Bei Zahlung bis 13.09.2026 2 % Skonto.
IBAN: DE44 5001 0517 5407 3249 31 · BIC INGDDEFFXXX
Unsere IBAN für Rückfragen: DE89 3704 0044 0532 0130 00`;

  it('Betrag, Nummer, Daten, Skonto, IBAN, Lieferant', () => {
    const result = extractFromText(text, { ownIbans: ['DE89370400440532013000'], ownName: 'Grün GmbH' });
    expect(result).toMatchObject({
      supplierName: 'Baustoffe Müller KG',
      supplierIban: 'DE44500105175407324931',
      invoiceNumber: 'RE-26/1187',
      invoiceDate: '2026-09-03',
      dueDate: '2026-10-03',
      amount: '825.86',
      discountPercent: '2.00',
      discountUntil: '2026-09-13',
    });
    // eigene IBAN und eigener Name nicht als Lieferant
    expect(result.candidates.iban).toEqual(['DE44500105175407324931']);
    expect(result.candidates.supplierName.join('|')).not.toMatch(/Grün/);
  });

  it('bekannte Lieferanten zuerst; mehrere Kandidaten', () => {
    const result = extractFromText(
      `Lieferschein-Nr. 77\nBaywa AG\nMüller Transporte GmbH\nGesamtbetrag 1.204,10\nSumme 1.100,00`,
      {
        knownSuppliers: ['Müller Transporte GmbH', 'Hornbach'],
      },
    );
    expect(result.supplierName).toBe('Müller Transporte GmbH');
    expect(result.candidates.supplierName).toContain('Baywa AG');
    expect(result.candidates.amount).toEqual(['1204.10', '1100.00']);
  });

  it('ohne Schlüsselwort: größter Betrag; Fälligkeit mit Datum', () => {
    const result = extractFromText('Hornbach\nDatum 01.08.26\n19,99\n149,00\nfällig am 15.08.2026');
    expect(result.amount).toBe('149.00');
    expect(result.invoiceDate).toBe('2026-08-01');
    expect(result.dueDate).toBe('2026-08-15');
  });

  it('Skonto und Zahlungsziel in einer Zeile', () => {
    const result = extractFromText(
      'Rechnungsdatum: 01.09.2026\nZahlbar innerhalb 14 Tagen. 2 % Skonto innerhalb 7 Tagen.\nRechnungsbetrag 100,00',
    );
    expect(result).toMatchObject({
      dueDate: '2026-09-15',
      discountPercent: '2.00',
      discountUntil: '2026-09-08',
    });
  });

  it('Hilfsfunktionen', () => {
    expect(parseAmountText('1.234,56')).toBe('1234.56');
    expect(parseAmountText('1,234.56')).toBe('1234.56');
    expect(parseAmountText('12')).toBeNull();
    expect(validIban('DE89370400440532013000')).toBe(true);
    expect(validIban('DE89370400440532013001')).toBe(false);
  });
});
