import { mkdirSync, writeFileSync } from 'fs';
import { join } from 'path';
import { Prisma } from '@prisma/client';
import { buildXRechnung, unitCode, XRECHNUNG_GUIDELINE, XRechnungInput } from '../src/invoices/xrechnung';

const D = (n: string) => new Prisma.Decimal(n);
const neg = (d: Prisma.Decimal) => d.negated();

// Schlussrechnung mit verrechnetem Abschlag (negative Position).
const finalInvoice: XRechnungInput = {
  kind: 'final',
  number: 'R-2026-0002',
  // 22:30 UTC ist in Berlin bereits der nächste Tag
  issueDate: new Date('2026-09-22T22:30:00Z'),
  servicePeriodStart: new Date('2026-09-01T08:00:00Z'),
  servicePeriodEnd: new Date('2026-09-20T08:00:00Z'),
  timeZone: 'Europe/Berlin',
  buyerReference: '04011000-1234512345-06',
  seller: {
    name: 'Grün & Co GmbH',
    street: 'Gartenweg 1',
    postalCode: '10115',
    city: 'Berlin',
    email: 'info@gruen.example',
    contactName: 'Anna Grün',
    phone: '+49 30 123456',
    taxNumber: '12/345/67890',
    vatId: 'DE123456789',
    iban: 'DE89370400440532013000',
    bic: 'COBADEFFXXX',
    paymentTermDays: 14,
  },
  buyer: {
    name: 'Stadt <Musterstadt>',
    street: 'Rathausplatz 1',
    postalCode: '12345',
    city: 'Musterstadt',
    email: 'rechnung@musterstadt.example',
  },
  vatRate: D('19.00'),
  totalNet: D('1000.00'),
  totalVat: D('190.00'),
  totalGross: D('1190.00'),
  lines: [
    {
      description: 'Rasen mähen',
      unit: 'm2',
      quantity: D('500'),
      unitPrice: D('2.40'),
      lineTotal: D('1200.00'),
    },
    {
      description: 'Hecke schneiden',
      unit: 'h',
      quantity: D('10'),
      unitPrice: D('30.00'),
      lineTotal: D('300.00'),
    },
    {
      description: 'abzüglich Abschlagsrechnung R-2026-0001',
      unit: 'pauschal',
      quantity: D('1'),
      unitPrice: D('-500.00'),
      lineTotal: D('-500.00'),
    },
  ],
  notes: [],
};

const partialInvoice: XRechnungInput = {
  ...finalInvoice,
  kind: 'partial',
  number: 'R-2026-0001',
  servicePeriodStart: null,
  totalNet: D('500.00'),
  totalVat: D('95.00'),
  totalGross: D('595.00'),
  lines: [
    {
      description: 'Abschlag 50 %',
      unit: 'pauschal',
      quantity: D('1'),
      unitPrice: D('500'),
      lineTotal: D('500'),
    },
  ],
};

// Storno der Schlussrechnung: in der Datenbank mit negativen Beträgen.
const cancellation: XRechnungInput = {
  ...finalInvoice,
  kind: 'cancellation',
  number: 'R-2026-0003',
  precedingInvoice: { number: 'R-2026-0002', issueDate: finalInvoice.issueDate },
  notes: ['Stornorechnung zu Rechnung R-2026-0002.'],
  totalNet: neg(finalInvoice.totalNet),
  totalVat: neg(finalInvoice.totalVat),
  totalGross: neg(finalInvoice.totalGross),
  lines: finalInvoice.lines.map((l) => ({ ...l, unitPrice: neg(l.unitPrice), lineTotal: neg(l.lineTotal) })),
};

// Kleiner Betrieb nur mit Steuernummer, ohne USt-IdNr.
const taxNumberOnly: XRechnungInput = {
  ...partialInvoice,
  seller: { ...partialInvoice.seller, vatId: null },
};

const samples = { final: finalInvoice, partial: partialInvoice, cancellation, taxNumberOnly };

// Mit XRECHNUNG_OUT=<Verzeichnis> werden die Beispiele gespeichert, um sie
// mit dem KoSIT-Validator zu prüfen (siehe TESTANLEITUNG.md).
if (process.env.XRECHNUNG_OUT) {
  mkdirSync(process.env.XRECHNUNG_OUT, { recursive: true });
  for (const [name, input] of Object.entries(samples)) {
    writeFileSync(join(process.env.XRECHNUNG_OUT, `${name}.xml`), buildXRechnung(input));
  }
}

const between = (xml: string, tag: string) =>
  [...xml.matchAll(new RegExp(`<${tag}[^>]*>([^<]*)</${tag}>`, 'g'))].map((m) => m[1]);

describe('XRechnung (CII)', () => {
  it('kennzeichnet XRechnung 3.0 und die Rechnungsart', () => {
    const xml = buildXRechnung(finalInvoice);
    expect(between(xml, 'ram:ID')).toContain(XRECHNUNG_GUIDELINE);
    expect(between(xml, 'ram:TypeCode')[0]).toBe('380');
    expect(between(buildXRechnung(partialInvoice), 'ram:TypeCode')[0]).toBe('326');
    expect(between(buildXRechnung(cancellation), 'ram:TypeCode')[0]).toBe('381');
  });

  it('schreibt Datumsangaben in der Zeitzone der Firma', () => {
    const xml = buildXRechnung(finalInvoice);
    expect(between(xml, 'udt:DateTimeString')[0]).toBe('20260923');
  });

  it('stellt Abzüge als negative Menge zum positiven Preis dar', () => {
    const xml = buildXRechnung(finalInvoice);
    expect(between(xml, 'ram:ChargeAmount')).toEqual(['2.40', '30.00', '500.00']);
    expect(between(xml, 'ram:BilledQuantity')).toEqual(['500.00', '10.00', '-1.00']);
    expect(xml).toContain('unitCode="MTK"');
    expect(xml).toContain('unitCode="HUR"');
    expect(xml).toContain('unitCode="LS"');
  });

  it('überträgt eine Stornorechnung als Gutschrift mit positiven Summen und Bezug', () => {
    const xml = buildXRechnung(cancellation);
    expect(between(xml, 'ram:GrandTotalAmount')).toEqual(['1190.00']);
    expect(between(xml, 'ram:DuePayableAmount')).toEqual(['1190.00']);
    expect(between(xml, 'ram:BilledQuantity')).toEqual(['500.00', '10.00', '-1.00']);
    expect(between(xml, 'ram:IssuerAssignedID')).toEqual(['R-2026-0002']);
  });

  it('berechnet Fälligkeit und Summen', () => {
    const xml = buildXRechnung(finalInvoice);
    // 23.09. + 14 Tage
    expect(between(xml, 'udt:DateTimeString')).toContain('20261007');
    expect(between(xml, 'ram:LineTotalAmount').slice(-1)).toEqual(['1000.00']);
    expect(between(xml, 'ram:TaxTotalAmount')).toEqual(['190.00']);
  });

  it('maskiert Sonderzeichen', () => {
    const xml = buildXRechnung(finalInvoice);
    expect(xml).toContain('Grün &amp; Co GmbH');
    expect(xml).toContain('Stadt &lt;Musterstadt&gt;');
  });

  it('identifiziert den Verkäufer ohne USt-IdNr. über die Steuernummer (BR-CO-26)', () => {
    const xml = buildXRechnung(taxNumberOnly);
    expect(xml).toMatch(/<ram:SellerTradeParty>\s*<ram:ID>12\/345\/67890<\/ram:ID>/);
    expect(xml).not.toContain('schemeID="VA"');
    expect(buildXRechnung(finalInvoice)).not.toMatch(/<ram:SellerTradeParty>\s*<ram:ID>/);
  });

  it('bildet unbekannte Einheiten auf C62 ab', () => {
    expect(unitCode(' Stk ')).toBe('H87');
    expect(unitCode('Sack')).toBe('C62');
  });
});
