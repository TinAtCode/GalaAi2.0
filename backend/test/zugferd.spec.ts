import { createHash } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import { buildXRechnung } from '../src/invoices/xrechnung';
import { BusinessDocumentPdf, renderBusinessDocumentPdf } from '../src/pdf/business-document.pdf';

const base: BusinessDocumentPdf = {
  title: 'Rechnung R-2026-0001',
  draft: false,
  seller: { name: 'Grün & Söhne <GmbH>', street: 'Gartenweg 1', postalCode: '10115', city: 'Berlin' },
  buyer: { name: 'Familie Müller', street: 'Weg 2', postalCode: '50667', city: 'Köln' },
  meta: [['Rechnungsdatum', '23.09.2026']],
  lines: [
    {
      position: 1,
      description: 'Rasen anlegen – inkl. Saatgut',
      quantity: '120',
      unit: 'm2',
      unitPrice: '12.5',
      lineTotal: '1500',
    },
  ],
  totals: { net: '1500', vatRate: '19', vat: '285', gross: '1785' },
  notes: [],
};
const D = (n: string) => new Prisma.Decimal(n);
const xml = Buffer.from(
  buildXRechnung({
    kind: 'final',
    number: 'R-2026-0001',
    issueDate: new Date('2026-09-23T10:00:00Z'),
    servicePeriodStart: null,
    servicePeriodEnd: new Date('2026-09-20T10:00:00Z'),
    timeZone: 'Europe/Berlin',
    buyerReference: 'Rasen',
    seller: {
      name: 'Grün & Söhne GmbH',
      street: 'Gartenweg 1',
      postalCode: '10115',
      city: 'Berlin',
      email: 'info@gruen.example',
      contactName: 'Anna Grün',
      phone: '+49 30 123456',
      taxNumber: '12/345/67890',
      vatId: 'DE123456789',
      iban: 'DE89370400440532013000',
      bic: null,
      paymentTermDays: 14,
    },
    buyer: {
      name: 'Familie Müller',
      street: 'Weg 2',
      postalCode: '50667',
      city: 'Köln',
      email: 'mueller@example.com',
    },
    vatTreatment: 'standard',
    vatRate: D('19.00'),
    totalNet: D('1500.00'),
    totalVat: D('285.00'),
    totalGross: D('1785.00'),
    lines: [
      {
        description: 'Rasen anlegen – inkl. Saatgut',
        unit: 'm2',
        quantity: D('120'),
        unitPrice: D('12.50'),
        lineTotal: D('1500.00'),
      },
    ],
    notes: [],
  }),
  'utf8',
);

// Mit PDFA_OUT=<Verzeichnis> speichern, für scripts/validate-pdfa.sh
const save = (name: string, pdf: Buffer) => {
  if (!process.env.PDFA_OUT) return;
  mkdirSync(process.env.PDFA_OUT, { recursive: true });
  writeFileSync(join(process.env.PDFA_OUT, `${name}.pdf`), pdf);
};

describe('PDF/A-3 und ZUGFeRD', () => {
  it('jedes PDF ist PDF/A-3b mit eingebetteten Schriften', async () => {
    const pdf = await renderBusinessDocumentPdf(base);
    save('unit-ohne-xml', pdf);
    const raw = pdf.toString('latin1');
    expect(raw).toMatch(/^%PDF-1\.7/);
    expect(raw).toContain('<pdfaid:part>3</pdfaid:part>');
    expect(raw).toContain('<pdfaid:conformance>B</pdfaid:conformance>');
    expect(raw).toContain('/FontFile2');
    expect(raw).not.toMatch(/\/BaseFont \/Helvetica/);
    expect(raw).toContain('/OutputIntents');
    expect(raw).not.toContain('factur-x.xml');
    // Zeichen mit XML-Bedeutung dürfen das XMP nicht zerbrechen
    expect(pdf.toString('utf8')).toContain('<rdf:li>Grün und Söhne GmbH</rdf:li>');
  });

  it('mit E-Rechnung: factur-x.xml als Alternative eingebettet, XMP nach ZUGFeRD', async () => {
    const pdf = await renderBusinessDocumentPdf({ ...base, eInvoiceXml: xml });
    save('unit-zugferd', pdf);
    const raw = pdf.toString('latin1');
    expect(raw).toContain('/AFRelationship /Alternative');
    expect(raw).toContain('/Subtype /text#2Fxml');
    expect(raw).toMatch(/\/AF \[\d+ 0 R\]/);
    expect(raw).toContain('<fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>');
    expect(raw).toContain('<fx:ConformanceLevel>XRECHNUNG</fx:ConformanceLevel>');
    expect(raw).toContain('<pdfaSchema:prefix>fx</pdfaSchema:prefix>');
    // pdfkit legt die MD5-Prüfsumme der eingebetteten Datei ab
    expect(raw).toContain(`/CheckSum (${createHash('md5').update(xml).digest('hex')})`);
  });
});
