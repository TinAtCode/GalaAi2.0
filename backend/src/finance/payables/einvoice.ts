import { XMLParser } from 'fast-xml-parser';

// Angaben aus einer eingehenden E-Rechnung (XRechnung/ZUGFeRD als CII oder
// UBL). Seit 2025 müssen Unternehmen E-Rechnungen empfangen können; ihre
// Werte sind exakt und brauchen keine Texterkennung.
export interface PayableDraft {
  supplierName: string | null;
  supplierIban: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null; // JJJJ-MM-TT
  dueDate: string | null;
  amount: string | null; // zu zahlen, brutto, "1190.00"
  netAmount: string | null;
  vatAmount: string | null;
  discountPercent: string | null; // "2.00"
  discountUntil: string | null;
}

export const EMPTY_DRAFT: PayableDraft = {
  supplierName: null,
  supplierIban: null,
  invoiceNumber: null,
  invoiceDate: null,
  dueDate: null,
  amount: null,
  netAmount: null,
  vatAmount: null,
  discountPercent: null,
  discountUntil: null,
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  // keine Entity-Auflösung (Schutz gegen Entity-Expansion); DOCTYPE wird vorher abgelehnt
  processEntities: false,
  parseTagValue: false,
});

type Node = Record<string, unknown> | string | undefined;

// Wert eines Elements: Text direkt oder unter "#text" (Element mit Attributen)
function text(node: unknown): string | null {
  if (node === undefined || node === null) return null;
  if (Array.isArray(node)) return text(node[0]);
  if (typeof node === 'object') return text((node as Record<string, unknown>)['#text']);
  const value = String(node).trim();
  return value ? decodeEntities(value) : null;
}

// die fünf XML-Standard-Entities (processEntities ist aus)
const decodeEntities = (value: string) =>
  value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&');

function path(node: unknown, ...keys: string[]): Node {
  let current = node;
  for (const key of keys) {
    if (Array.isArray(current)) current = current[0];
    if (!current || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return Array.isArray(current) ? (current[0] as Node) : (current as Node);
}

const all = (node: unknown): unknown[] => (node === undefined ? [] : Array.isArray(node) ? node : [node]);

// CII-Datum im Format 102: JJJJMMTT
const cii102 = (value: string | null) =>
  value && /^\d{8}$/.test(value) ? `${value.slice(0, 4)}-${value.slice(4, 6)}-${value.slice(6, 8)}` : null;
const isoDay = (value: string | null) =>
  value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null;
const money = (value: string | null) =>
  value && /^-?\d+(\.\d+)?$/.test(value) ? Number(value).toFixed(2) : null;

function addDays(day: string, days: number) {
  const date = new Date(`${day}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

// Skonto nach XRechnung-Konvention: "#SKONTO#TAGE=14#PROZENT=2.00#"
function skonto(terms: (string | null)[], invoiceDate: string | null) {
  for (const term of terms) {
    const match = term?.match(/#SKONTO#TAGE=(\d+)#PROZENT=(\d+(?:\.\d+)?)#/i);
    if (match) {
      return {
        discountPercent: Number(match[2]).toFixed(2),
        discountUntil: invoiceDate ? addDays(invoiceDate, Number(match[1])) : null,
      };
    }
  }
  return { discountPercent: null, discountUntil: null };
}

const normalizeIban = (iban: string | null) => (iban ? iban.replace(/\s+/g, '').toUpperCase() : null);

// Gutschrift (UBL CreditNote, CII-Typ 381): kein zu zahlender Betrag
export class CreditNoteError extends Error {
  constructor() {
    super('Gutschrift statt Rechnung');
  }
}
const CREDIT_NOTE_TYPES = new Set(['381', '261', '262', '296', '308', '396', '420', '458', '532']);

export function isEInvoiceXml(xml: string) {
  return /<(\w+:)?(CrossIndustryInvoice|Invoice|CreditNote)[\s>]/.test(xml.slice(0, 4000));
}

// null: keine E-Rechnung (weder CII noch UBL)
export function parseEInvoice(xml: string): PayableDraft | null {
  if (/<!DOCTYPE/i.test(xml)) throw new Error('XML mit DOCTYPE wird nicht verarbeitet.');
  const doc = parser.parse(xml) as Record<string, unknown>;
  if (doc.CreditNote) throw new CreditNoteError();
  if (doc.CrossIndustryInvoice) {
    if (CREDIT_NOTE_TYPES.has(text(path(doc.CrossIndustryInvoice, 'ExchangedDocument', 'TypeCode')) ?? ''))
      throw new CreditNoteError();
    return parseCii(doc.CrossIndustryInvoice);
  }
  if (doc.Invoice) {
    if (CREDIT_NOTE_TYPES.has(text(path(doc.Invoice, 'InvoiceTypeCode')) ?? '')) throw new CreditNoteError();
    return parseUbl(doc.Invoice);
  }
  return null;
}

function parseCii(root: unknown): PayableDraft {
  const transaction = path(root, 'SupplyChainTradeTransaction');
  const agreement = path(transaction, 'ApplicableHeaderTradeAgreement');
  const settlement = path(transaction, 'ApplicableHeaderTradeSettlement');
  const summation = path(settlement, 'SpecifiedTradeSettlementHeaderMonetarySummation');
  const invoiceDate = cii102(text(path(root, 'ExchangedDocument', 'IssueDateTime', 'DateTimeString')));
  const terms = all((settlement as Record<string, unknown> | undefined)?.SpecifiedTradePaymentTerms);
  const means = all(
    (settlement as Record<string, unknown> | undefined)?.SpecifiedTradeSettlementPaymentMeans,
  );
  const iban = means.map((m) => text(path(m, 'PayeePartyCreditorFinancialAccount', 'IBANID'))).find(Boolean);
  return {
    supplierName: text(path(agreement, 'SellerTradeParty', 'Name')),
    supplierIban: normalizeIban(iban ?? null),
    invoiceNumber: text(path(root, 'ExchangedDocument', 'ID')),
    invoiceDate,
    dueDate:
      terms.map((t) => cii102(text(path(t, 'DueDateDateTime', 'DateTimeString')))).find(Boolean) ?? null,
    amount:
      money(text(path(summation, 'DuePayableAmount'))) ?? money(text(path(summation, 'GrandTotalAmount'))),
    netAmount: money(text(path(summation, 'TaxBasisTotalAmount'))),
    vatAmount: money(text(path(summation, 'TaxTotalAmount'))),
    ...skonto(
      terms.map((t) => text(path(t, 'Description'))),
      invoiceDate,
    ),
  };
}

function parseUbl(root: unknown): PayableDraft {
  const party = path(root, 'AccountingSupplierParty', 'Party');
  const totals = path(root, 'LegalMonetaryTotal');
  const invoiceDate = isoDay(text(path(root, 'IssueDate')));
  const means = all((root as Record<string, unknown>).PaymentMeans);
  const iban = means.map((m) => text(path(m, 'PayeeFinancialAccount', 'ID'))).find(Boolean);
  const terms = all((root as Record<string, unknown>).PaymentTerms).map((t) => text(path(t, 'Note')));
  return {
    supplierName:
      text(path(party, 'PartyLegalEntity', 'RegistrationName')) ?? text(path(party, 'PartyName', 'Name')),
    supplierIban: normalizeIban(iban ?? null),
    invoiceNumber: text(path(root, 'ID')),
    invoiceDate,
    dueDate: isoDay(text(path(root, 'DueDate'))),
    amount: money(text(path(totals, 'PayableAmount'))) ?? money(text(path(totals, 'TaxInclusiveAmount'))),
    netAmount: money(text(path(totals, 'TaxExclusiveAmount'))),
    vatAmount: money(text(path(root, 'TaxTotal', 'TaxAmount'))),
    ...skonto(terms, invoiceDate),
  };
}
