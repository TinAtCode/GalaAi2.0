import { join } from 'path';
import PDFDocument from 'pdfkit';

// Ein Beleg (Angebot oder Rechnung) als PDF – bewusst schlicht: Absender,
// Empfänger, Kopfdaten, Positionen, Summen. Alle Beträge kommen bereits
// gerundet aus der Datenbank; hier wird nur formatiert, nicht gerechnet.
export interface PdfParty {
  name: string;
  street?: string | null;
  postalCode?: string | null;
  city?: string | null;
}

export interface BusinessDocumentPdf {
  title: string; // z.B. "Rechnung R-2026-0001"
  draft: boolean; // Entwurf -> deutlicher Hinweis, keine gültige Rechnung
  seller: PdfParty & { taxNumber?: string | null; vatId?: string | null };
  buyer: PdfParty;
  meta: [string, string][]; // Kopfdaten, z.B. [["Rechnungsdatum", "22.09.2026"]]
  lines: {
    position: number;
    description: string;
    quantity: string;
    unit: string;
    unitPrice: string;
    lineTotal: string;
  }[];
  totals: { net: string; vatRate: string; vat: string; gross: string };
  notes: string[];
  // E-Rechnung (CII/XRechnung) zum Einbetten -> ZUGFeRD-PDF (Factur-X)
  eInvoiceXml?: Buffer;
}

// Eingebettete Schriften (Liberation Sans, maßgleich mit Helvetica; SIL OFL):
// PDF/A verlangt, dass alle Schriften im Dokument stecken.
const FONT_DIR = join(__dirname, '..', '..', 'assets', 'fonts');
const REGULAR = 'Regular';
const BOLD = 'Bold';

// Im XMP stehen Titel und Autor unmaskiert (pdfkit) – Zeichen mit
// XML-Bedeutung dort vermeiden, damit Info und XMP gleich bleiben.
const xmpSafe = (text: string) => text.replace(/&/g, 'und').replace(/[<>"]/g, '');

// ZUGFeRD 2.x / Factur-X: Beschreibung der eingebetteten Rechnung im XMP,
// samt der für PDF/A nötigen Schema-Erklärung des fx-Namensraums.
const FX = 'urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#';
const fxProperty = (name: string, description: string) => `
          <rdf:li rdf:parseType="Resource">
            <pdfaProperty:name>${name}</pdfaProperty:name>
            <pdfaProperty:valueType>Text</pdfaProperty:valueType>
            <pdfaProperty:category>external</pdfaProperty:category>
            <pdfaProperty:description>${description}</pdfaProperty:description>
          </rdf:li>`;
const ZUGFERD_XMP = `
    <rdf:Description rdf:about="" xmlns:fx="${FX}">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>XRECHNUNG</fx:ConformanceLevel>
    </rdf:Description>
    <rdf:Description rdf:about=""
        xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
        xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
        xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>${FX}</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>${fxProperty('DocumentFileName', 'Name of the embedded XML invoice file')}${fxProperty('DocumentType', 'INVOICE')}${fxProperty('Version', 'Version of the Factur-X XML schema')}${fxProperty('ConformanceLevel', 'Conformance level of the embedded XML invoice')}
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>`;

const euro = (value: string | number) =>
  Number(value).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
const amount = (value: string | number) =>
  Number(value).toLocaleString('de-DE', { maximumFractionDigits: 2 });
// Mengen mit bis zu 3 Nachkommastellen (z.B. 0,125 m³), ohne überflüssige Nullen
const quantityText = (value: string | number) =>
  Number(value).toLocaleString('de-DE', { maximumFractionDigits: 3 });
const addressLines = (p: PdfParty) =>
  [p.name, p.street, [p.postalCode, p.city].filter(Boolean).join(' ')].filter((l): l is string => !!l);

// Gemeinsames Grundgerüst aller Belege: PDF/A-3b mit eingebetteten
// Schriften, Absender und Empfänger, Kopfdaten, Titel; am Ende die Fußzeile
// mit den Steuerangaben und Seitenzahlen.
function openDocument(title: string, seller: BusinessDocumentPdf['seller']) {
  // bufferPages: für die Fußzeile mit "Seite x von y" am Ende.
  // PDF/A-3b: archivtauglich (GoBD) und Voraussetzung für ZUGFeRD.
  const pdf = new PDFDocument({
    size: 'A4',
    margin: 50,
    bufferPages: true,
    pdfVersion: '1.7',
    subset: 'PDF/A-3b',
    lang: 'de-DE',
    info: { Title: xmpSafe(title), Author: xmpSafe(seller.name) },
  });
  pdf.registerFont(REGULAR, join(FONT_DIR, 'LiberationSans-Regular.ttf'));
  pdf.registerFont(BOLD, join(FONT_DIR, 'LiberationSans-Bold.ttf'));
  const done = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    pdf.on('data', (chunk: Buffer) => chunks.push(chunk));
    pdf.on('end', () => resolve(Buffer.concat(chunks)));
    pdf.on('error', reject);
  });
  const left = pdf.page.margins.left;
  const width = pdf.page.width - pdf.page.margins.left - pdf.page.margins.right;
  return { pdf, done, left, width };
}

function drawHeader(
  pdf: PDFKit.PDFDocument,
  left: number,
  width: number,
  doc: { title: string; seller: PdfParty; buyer: PdfParty; meta: [string, string][] },
) {
  // Absenderzeile und Empfänger
  pdf.font(REGULAR).fontSize(8).fillColor('#555555').text(addressLines(doc.seller).join(' · '), left, 50);
  pdf.fontSize(11).fillColor('#000000').text(addressLines(doc.buyer).join('\n'), left, 80);

  // Kopfdaten rechts
  let metaY = 80;
  for (const [label, value] of doc.meta) {
    pdf.fontSize(9).text(`${label}:`, left + width - 220, metaY, { width: 100 });
    pdf.text(value, left + width - 115, metaY, { width: 115, align: 'right' });
    metaY += 14;
  }

  pdf.font(BOLD).fontSize(16).text(doc.title, left, 190);
}

// Fußzeile mit Steuerangaben (§ 14 UStG) auf jeder Seite
function drawFooter(
  pdf: PDFKit.PDFDocument,
  left: number,
  width: number,
  seller: BusinessDocumentPdf['seller'],
) {
  const footer = [
    seller.name,
    seller.taxNumber ? `Steuernummer ${seller.taxNumber}` : null,
    seller.vatId ? `USt-IdNr. ${seller.vatId}` : null,
  ]
    .filter(Boolean)
    .join(' · ');
  const range = pdf.bufferedPageRange();
  for (let i = range.start; i < range.start + range.count; i++) {
    pdf.switchToPage(i);
    // Unterhalb des Seitenrands schreiben, ohne eine neue Seite auszulösen
    pdf.page.margins.bottom = 0;
    pdf.fontSize(8).fillColor('#555555');
    pdf.text(`${footer}   ·   Seite ${i + 1} von ${range.count}`, left, pdf.page.height - 40, {
      width,
      align: 'center',
      lineBreak: false,
    });
  }
}

export function renderBusinessDocumentPdf(doc: BusinessDocumentPdf): Promise<Buffer> {
  const { pdf, done, left, width } = openDocument(doc.title, doc.seller);
  if (doc.eInvoiceXml) {
    // relationship (AFRelationship) kennt pdfkit, @types/pdfkit noch nicht
    const attachment: PDFKit.Mixins.PDFAttachmentOptions & { relationship: string } = {
      name: 'factur-x.xml',
      type: 'text/xml',
      relationship: 'Alternative',
      description: 'E-Rechnung (ZUGFeRD/Factur-X, Profil XRECHNUNG)',
    };
    pdf.file(doc.eInvoiceXml, attachment);
    pdf.appendXML(ZUGFERD_XMP);
  }

  drawHeader(pdf, left, width, doc);
  if (doc.draft) {
    pdf.font(BOLD).fontSize(10).fillColor('#b00020').text('ENTWURF – keine gültige Rechnung', left, 212);
    pdf.fillColor('#000000');
  }

  // Positionen
  const cols = [
    { key: 'position', label: 'Pos.', w: 35, align: 'left' as const },
    {
      key: 'description',
      label: 'Beschreibung',
      w: width - 35 - 60 - 45 - 80 - 85,
      align: 'left' as const,
    },
    { key: 'quantity', label: 'Menge', w: 60, align: 'right' as const },
    { key: 'unit', label: 'Einheit', w: 45, align: 'left' as const },
    { key: 'unitPrice', label: 'Einzelpreis', w: 80, align: 'right' as const },
    { key: 'lineTotal', label: 'Gesamt', w: 85, align: 'right' as const },
  ];
  let y = 240;
  const row = (values: string[], bold = false) => {
    pdf.font(bold ? BOLD : REGULAR).fontSize(9);
    let x = left;
    const heights = values.map((v, i) => pdf.heightOfString(v, { width: cols[i].w - 4 }));
    const h = Math.max(...heights) + 6;
    if (y + h > pdf.page.height - 120) {
      pdf.addPage();
      y = 50;
    }
    values.forEach((v, i) => {
      pdf.text(v, x + 2, y + 3, { width: cols[i].w - 4, align: cols[i].align });
      x += cols[i].w;
    });
    y += h;
    pdf
      .moveTo(left, y)
      .lineTo(left + width, y)
      .strokeColor('#dddddd')
      .stroke();
  };
  row(
    cols.map((c) => c.label),
    true,
  );
  for (const line of doc.lines) {
    row([
      String(line.position),
      line.description,
      quantityText(line.quantity),
      line.unit,
      euro(line.unitPrice),
      euro(line.lineTotal),
    ]);
  }

  // Summen
  y += 10;
  const sum = (label: string, value: string, bold = false) => {
    pdf.font(bold ? BOLD : REGULAR).fontSize(10);
    pdf.text(label, left + width - 250, y, { width: 160 });
    pdf.text(value, left + width - 90, y, { width: 90, align: 'right' });
    y += 16;
  };
  sum('Summe netto', euro(doc.totals.net));
  sum(`Umsatzsteuer ${amount(doc.totals.vatRate)} %`, euro(doc.totals.vat));
  sum('Gesamtbetrag', euro(doc.totals.gross), true);

  y += 10;
  pdf.font(REGULAR).fontSize(9);
  for (const note of doc.notes) {
    pdf.text(note, left, y, { width });
    y = pdf.y + 4;
  }

  drawFooter(pdf, left, width, doc.seller);
  pdf.end();
  return done;
}

// Brief mit Bezug auf Rechnungen – z.B. Zahlungserinnerung und Mahnung:
// Anrede und Absätze, eine Tabelle der offenen Beträge, Schlussabsätze.
export interface LetterPdf {
  title: string; // z.B. "1. Mahnung"
  seller: BusinessDocumentPdf['seller'];
  buyer: PdfParty;
  meta: [string, string][];
  paragraphs: string[];
  table: { header: string[]; rows: string[][]; widths: number[] };
  closing: string[];
}

export function renderLetterPdf(doc: LetterPdf): Promise<Buffer> {
  const { pdf, done, left, width } = openDocument(doc.title, doc.seller);
  drawHeader(pdf, left, width, doc);

  let y = 225;
  pdf.font(REGULAR).fontSize(10).fillColor('#000000');
  for (const paragraph of doc.paragraphs) {
    pdf.text(paragraph, left, y, { width });
    y = pdf.y + 10;
  }

  // Tabelle: Spaltenbreiten als Anteile der Seitenbreite, Zahlen rechtsbündig
  const total = doc.table.widths.reduce((a, b) => a + b, 0);
  const widths = doc.table.widths.map((w) => (w / total) * width);
  const tableRow = (values: string[], bold: boolean) => {
    pdf.font(bold ? BOLD : REGULAR).fontSize(9);
    let x = left;
    const h = Math.max(...values.map((v, i) => pdf.heightOfString(v, { width: widths[i] - 4 }))) + 6;
    values.forEach((v, i) => {
      pdf.text(v, x + 2, y + 3, { width: widths[i] - 4, align: i === 0 ? 'left' : 'right' });
      x += widths[i];
    });
    y += h;
    pdf
      .moveTo(left, y)
      .lineTo(left + width, y)
      .strokeColor('#dddddd')
      .stroke();
  };
  tableRow(doc.table.header, true);
  for (const r of doc.table.rows) tableRow(r, false);

  y += 14;
  pdf.font(REGULAR).fontSize(10);
  for (const paragraph of doc.closing) {
    pdf.text(paragraph, left, y, { width });
    y = pdf.y + 10;
  }

  drawFooter(pdf, left, width, doc.seller);
  pdf.end();
  return done;
}
