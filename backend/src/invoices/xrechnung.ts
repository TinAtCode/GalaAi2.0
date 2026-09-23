import { Prisma } from '@prisma/client';

// E-Rechnung im Format XRechnung 3.0 (Syntax UN/CEFACT CII D16B).
// Die Reihenfolge der Elemente ist durch das XML-Schema vorgegeben und
// darf nicht verändert werden.

export const XRECHNUNG_GUIDELINE = 'urn:cen.eu:en16931:2017#compliant#urn:xeinkauf.de:kosit:xrechnung_3.0';
const BUSINESS_PROCESS = 'urn:fdc:peppol.eu:2017:poacc:billing:01:1.0';

export interface XRechnungParty {
  name: string;
  street: string;
  postalCode: string;
  city: string;
  email: string;
}

export interface XRechnungInput {
  kind: 'partial' | 'final' | 'cancellation';
  number: string;
  issueDate: Date;
  servicePeriodStart: Date | null;
  servicePeriodEnd: Date;
  timeZone: string;
  buyerReference: string;
  // Aufgehobene Rechnung (nur Storno)
  precedingInvoice?: { number: string; issueDate: Date };
  seller: XRechnungParty & {
    contactName: string;
    phone: string;
    taxNumber: string | null;
    vatId: string | null;
    iban: string;
    bic: string | null;
    paymentTermDays: number;
  };
  buyer: XRechnungParty;
  vatRate: Prisma.Decimal;
  totalNet: Prisma.Decimal;
  totalVat: Prisma.Decimal;
  totalGross: Prisma.Decimal;
  lines: {
    description: string;
    unit: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
  }[];
  notes: string[];
}

// Einheiten der Leistungsverzeichnisse -> UN/ECE Recommendation 20.
const UNIT_CODES: Record<string, string> = {
  m2: 'MTK',
  'm²': 'MTK',
  qm: 'MTK',
  m: 'MTR',
  lfm: 'MTR',
  m3: 'MTQ',
  'm³': 'MTQ',
  cbm: 'MTQ',
  stk: 'H87',
  stück: 'H87',
  kg: 'KGM',
  t: 'TNE',
  h: 'HUR',
  std: 'HUR',
  l: 'LTR',
  pauschal: 'LS',
  psch: 'LS',
};

export function unitCode(unit: string): string {
  return UNIT_CODES[unit.trim().toLowerCase()] ?? 'C62'; // C62 = "Einheit"
}

const escapeXml = (value: string) =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

// Datum im Format 102 (JJJJMMTT) in der Zeitzone der Firma.
function dateInZone(date: Date, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const get = (type: string) => parts.find((p) => p.type === type)!.value;
  return `${get('year')}${get('month')}${get('day')}`;
}

const amount = (d: Prisma.Decimal) => d.toFixed(2);

class Xml {
  private out: string[] = ['<?xml version="1.0" encoding="UTF-8"?>'];
  private depth = 0;

  open(tag: string, attrs = '') {
    this.out.push(`${'  '.repeat(this.depth)}<${tag}${attrs}>`);
    this.depth++;
    return this;
  }

  close(tag: string) {
    this.depth--;
    this.out.push(`${'  '.repeat(this.depth)}</${tag}>`);
    return this;
  }

  leaf(tag: string, value: string, attrs = '') {
    this.out.push(`${'  '.repeat(this.depth)}<${tag}${attrs}>${escapeXml(value)}</${tag}>`);
    return this;
  }

  date(tag: string, date: Date, timeZone: string, ns = 'udt') {
    return this.open(tag)
      .leaf(`${ns}:DateTimeString`, dateInZone(date, timeZone), ' format="102"')
      .close(tag);
  }

  toString() {
    return this.out.join('\n') + '\n';
  }
}

function party(
  x: Xml,
  tag: string,
  p: XRechnungParty & { id?: string | null },
  extra?: (x: Xml) => void,
  contact?: (x: Xml) => void,
) {
  x.open(tag);
  if (p.id) x.leaf('ram:ID', p.id);
  x.leaf('ram:Name', p.name);
  contact?.(x);
  x.open('ram:PostalTradeAddress')
    .leaf('ram:PostcodeCode', p.postalCode)
    .leaf('ram:LineOne', p.street)
    .leaf('ram:CityName', p.city)
    .leaf('ram:CountryID', 'DE')
    .close('ram:PostalTradeAddress');
  x.open('ram:URIUniversalCommunication')
    .leaf('ram:URIID', p.email, ' schemeID="EM"')
    .close('ram:URIUniversalCommunication');
  extra?.(x);
  x.close(tag);
}

export function buildXRechnung(input: XRechnungInput): string {
  const tz = input.timeZone;
  // Eine Stornorechnung wird als Gutschrift (381) mit umgekehrten Vorzeichen
  // übertragen: Beträge der Kopfsummen sind dann positiv.
  const sign = input.kind === 'cancellation' ? -1 : 1;
  const typeCode = { partial: '326', final: '380', cancellation: '381' }[input.kind];
  const signed = (d: Prisma.Decimal) => d.times(sign);
  const rate = input.vatRate.toFixed(2);

  const x = new Xml();
  x.open(
    'rsm:CrossIndustryInvoice',
    ' xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"' +
      ' xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"' +
      ' xmlns:qdt="urn:un:unece:uncefact:data:standard:QualifiedDataType:100"' +
      ' xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100"',
  );

  x.open('rsm:ExchangedDocumentContext')
    .open('ram:BusinessProcessSpecifiedDocumentContextParameter')
    .leaf('ram:ID', BUSINESS_PROCESS)
    .close('ram:BusinessProcessSpecifiedDocumentContextParameter')
    .open('ram:GuidelineSpecifiedDocumentContextParameter')
    .leaf('ram:ID', XRECHNUNG_GUIDELINE)
    .close('ram:GuidelineSpecifiedDocumentContextParameter')
    .close('rsm:ExchangedDocumentContext');

  x.open('rsm:ExchangedDocument')
    .leaf('ram:ID', input.number)
    .leaf('ram:TypeCode', typeCode)
    .date('ram:IssueDateTime', input.issueDate, tz);
  for (const note of input.notes) {
    x.open('ram:IncludedNote').leaf('ram:Content', note).close('ram:IncludedNote');
  }
  x.close('rsm:ExchangedDocument');

  x.open('rsm:SupplyChainTradeTransaction');

  input.lines.forEach((line, index) => {
    // Nettopreise dürfen nicht negativ sein (BR-27): Abzüge wie verrechnete
    // Abschläge werden als negative Menge zum positiven Preis dargestellt.
    const total = signed(line.lineTotal);
    const negative = total.isNegative();
    const quantity = negative ? line.quantity.abs().negated() : line.quantity.abs();
    x.open('ram:IncludedSupplyChainTradeLineItem')
      .open('ram:AssociatedDocumentLineDocument')
      .leaf('ram:LineID', String(index + 1))
      .close('ram:AssociatedDocumentLineDocument')
      .open('ram:SpecifiedTradeProduct')
      .leaf('ram:Name', line.description)
      .close('ram:SpecifiedTradeProduct')
      .open('ram:SpecifiedLineTradeAgreement')
      .open('ram:NetPriceProductTradePrice')
      .leaf('ram:ChargeAmount', amount(line.unitPrice.abs()))
      .close('ram:NetPriceProductTradePrice')
      .close('ram:SpecifiedLineTradeAgreement')
      .open('ram:SpecifiedLineTradeDelivery')
      .leaf('ram:BilledQuantity', quantity.toFixed(2), ` unitCode="${unitCode(line.unit)}"`)
      .close('ram:SpecifiedLineTradeDelivery')
      .open('ram:SpecifiedLineTradeSettlement')
      .open('ram:ApplicableTradeTax')
      .leaf('ram:TypeCode', 'VAT')
      .leaf('ram:CategoryCode', 'S')
      .leaf('ram:RateApplicablePercent', rate)
      .close('ram:ApplicableTradeTax')
      .open('ram:SpecifiedTradeSettlementLineMonetarySummation')
      .leaf('ram:LineTotalAmount', amount(total))
      .close('ram:SpecifiedTradeSettlementLineMonetarySummation')
      .close('ram:SpecifiedLineTradeSettlement')
      .close('ram:IncludedSupplyChainTradeLineItem');
  });

  const { seller, buyer } = input;
  x.open('ram:ApplicableHeaderTradeAgreement').leaf('ram:BuyerReference', input.buyerReference);
  party(
    x,
    'ram:SellerTradeParty',
    // Ohne USt-IdNr. identifiziert die Steuernummer den Verkäufer (BR-CO-26).
    { ...seller, id: seller.vatId ? null : seller.taxNumber },
    (x) => {
      if (seller.vatId) {
        x.open('ram:SpecifiedTaxRegistration')
          .leaf('ram:ID', seller.vatId, ' schemeID="VA"')
          .close('ram:SpecifiedTaxRegistration');
      }
      if (seller.taxNumber) {
        x.open('ram:SpecifiedTaxRegistration')
          .leaf('ram:ID', seller.taxNumber, ' schemeID="FC"')
          .close('ram:SpecifiedTaxRegistration');
      }
    },
    (x) =>
      x
        .open('ram:DefinedTradeContact')
        .leaf('ram:PersonName', seller.contactName)
        .open('ram:TelephoneUniversalCommunication')
        .leaf('ram:CompleteNumber', seller.phone)
        .close('ram:TelephoneUniversalCommunication')
        .open('ram:EmailURIUniversalCommunication')
        .leaf('ram:URIID', seller.email)
        .close('ram:EmailURIUniversalCommunication')
        .close('ram:DefinedTradeContact'),
  );
  party(x, 'ram:BuyerTradeParty', buyer);
  x.close('ram:ApplicableHeaderTradeAgreement');

  x.open('ram:ApplicableHeaderTradeDelivery');
  if (!input.servicePeriodStart) {
    x.open('ram:ActualDeliverySupplyChainEvent')
      .date('ram:OccurrenceDateTime', input.servicePeriodEnd, tz)
      .close('ram:ActualDeliverySupplyChainEvent');
  }
  x.close('ram:ApplicableHeaderTradeDelivery');

  x.open('ram:ApplicableHeaderTradeSettlement')
    .leaf('ram:InvoiceCurrencyCode', 'EUR')
    .open('ram:SpecifiedTradeSettlementPaymentMeans')
    .leaf('ram:TypeCode', '58') // SEPA-Überweisung
    .open('ram:PayeePartyCreditorFinancialAccount')
    .leaf('ram:IBANID', seller.iban)
    .leaf('ram:AccountName', seller.name)
    .close('ram:PayeePartyCreditorFinancialAccount');
  if (seller.bic) {
    x.open('ram:PayeeSpecifiedCreditorFinancialInstitution')
      .leaf('ram:BICID', seller.bic)
      .close('ram:PayeeSpecifiedCreditorFinancialInstitution');
  }
  x.close('ram:SpecifiedTradeSettlementPaymentMeans');

  x.open('ram:ApplicableTradeTax')
    .leaf('ram:CalculatedAmount', amount(signed(input.totalVat)))
    .leaf('ram:TypeCode', 'VAT')
    .leaf('ram:BasisAmount', amount(signed(input.totalNet)))
    .leaf('ram:CategoryCode', 'S')
    .leaf('ram:RateApplicablePercent', rate)
    .close('ram:ApplicableTradeTax');

  if (input.servicePeriodStart) {
    x.open('ram:BillingSpecifiedPeriod')
      .date('ram:StartDateTime', input.servicePeriodStart, tz)
      .date('ram:EndDateTime', input.servicePeriodEnd, tz)
      .close('ram:BillingSpecifiedPeriod');
  }

  if (input.kind === 'cancellation') {
    x.open('ram:SpecifiedTradePaymentTerms')
      .leaf('ram:Description', 'Der Betrag wird verrechnet oder erstattet.')
      .close('ram:SpecifiedTradePaymentTerms');
  } else {
    const due = new Date(input.issueDate.getTime() + seller.paymentTermDays * 24 * 60 * 60 * 1000);
    x.open('ram:SpecifiedTradePaymentTerms')
      .leaf(
        'ram:Description',
        seller.paymentTermDays === 0
          ? 'Zahlbar sofort ohne Abzug.'
          : `Zahlbar innerhalb von ${seller.paymentTermDays} Tagen ohne Abzug.`,
      )
      .date('ram:DueDateDateTime', due, tz)
      .close('ram:SpecifiedTradePaymentTerms');
  }

  x.open('ram:SpecifiedTradeSettlementHeaderMonetarySummation')
    .leaf('ram:LineTotalAmount', amount(signed(input.totalNet)))
    .leaf('ram:TaxBasisTotalAmount', amount(signed(input.totalNet)))
    .leaf('ram:TaxTotalAmount', amount(signed(input.totalVat)), ' currencyID="EUR"')
    .leaf('ram:GrandTotalAmount', amount(signed(input.totalGross)))
    .leaf('ram:DuePayableAmount', amount(signed(input.totalGross)))
    .close('ram:SpecifiedTradeSettlementHeaderMonetarySummation');

  if (input.precedingInvoice) {
    x.open('ram:InvoiceReferencedDocument')
      .leaf('ram:IssuerAssignedID', input.precedingInvoice.number)
      .date('ram:FormattedIssueDateTime', input.precedingInvoice.issueDate, tz, 'qdt')
      .close('ram:InvoiceReferencedDocument');
  }

  x.close('ram:ApplicableHeaderTradeSettlement');
  x.close('rsm:SupplyChainTradeTransaction');
  x.close('rsm:CrossIndustryInvoice');
  return x.toString();
}
