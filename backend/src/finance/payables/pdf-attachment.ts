import { PDFParse } from 'pdf-parse';
import { isEInvoiceXml } from './einvoice';

type Attachment = { filename: string; content: Uint8Array };

// Eingebettete E-Rechnung aus einer ZUGFeRD-/Factur-X-PDF (Anhang
// factur-x.xml, zugferd-invoice.xml oder xrechnung.xml); null: keine.
export async function embeddedInvoiceXml(pdf: Buffer): Promise<string | null> {
  // Kopie: pdf.js übernimmt den Speicher des übergebenen Arrays
  const parser = new PDFParse({ data: new Uint8Array(pdf) });
  try {
    // pdf-parse öffnet das pdf.js-Dokument in load() (in den Typen privat);
    // dessen getAttachments() liefert die eingebetteten Dateien
    const loader = parser as unknown as {
      load(): Promise<{ getAttachments(): Promise<Record<string, Attachment> | null> }>;
    };
    const attachments = await (await loader.load()).getAttachments();
    if (!attachments) return null;
    const files = Object.values(attachments).sort(
      (a, b) =>
        Number(/factur-x|zugferd|xrechnung/i.test(b.filename)) -
        Number(/factur-x|zugferd|xrechnung/i.test(a.filename)),
    );
    for (const file of files) {
      if (!/\.xml$/i.test(file.filename)) continue;
      const xml = Buffer.from(file.content).toString('utf8');
      if (isEInvoiceXml(xml)) return xml;
    }
    return null;
  } catch {
    return null;
  } finally {
    await parser.destroy();
  }
}
