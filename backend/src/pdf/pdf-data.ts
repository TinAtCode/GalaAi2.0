import { Prisma } from '@prisma/client';
import { BusinessDocumentPdf, PdfParty } from './business-document.pdf';

type Company = Prisma.CompanyGetPayload<object>;
type ProjectWithCustomer = Prisma.ProjectGetPayload<{
  include: { property: { include: { customer: true } } };
}>;

export const formatDate = (date: Date, timeZone: string) => date.toLocaleDateString('de-DE', { timeZone });

export function sellerFromCompany(company: Company): BusinessDocumentPdf['seller'] {
  return {
    name: company.name,
    street: company.street,
    postalCode: company.postalCode,
    city: company.city,
    taxNumber: company.taxNumber,
    vatId: company.vatId,
  };
}

// Rechnungsanschrift des Kunden, sonst die Anschrift des Objekts.
export function buyerFromProject(project: ProjectWithCustomer): PdfParty {
  const { customer } = project.property;
  const address = customer.street && customer.city ? customer : project.property;
  return { name: customer.name, street: address.street, postalCode: address.postalCode, city: address.city };
}

export function pdfLines(
  lineItems: {
    description: string;
    unit: string;
    quantity: Prisma.Decimal;
    unitPrice: Prisma.Decimal;
    lineTotal: Prisma.Decimal;
  }[],
): BusinessDocumentPdf['lines'] {
  return lineItems.map((li, index) => ({
    position: index + 1,
    description: li.description,
    unit: li.unit,
    quantity: li.quantity.toString(),
    unitPrice: li.unitPrice.toString(),
    lineTotal: li.lineTotal.toString(),
  }));
}
