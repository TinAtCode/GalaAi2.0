import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { lockFor } from '../common/advisory-lock';
import { writeAudit } from '../common/audit';
import { VAT_TREATMENT_NOTES } from '../common/vat-treatment';
import { formatDocumentNumber, nextSequenceValue, yearInZone } from '../common/numbering';
import { CreateInvoiceFromOrderDto, IssueInvoiceDto, SendInvoiceDto } from './dto/invoice.dto';
import { BusinessDocumentPdf, PdfParty, renderBusinessDocumentPdf } from '../pdf/business-document.pdf';
import { XRechnungInput, buildXRechnung } from './xrechnung';
import { buyerFromProject, formatDate, pdfLines, sellerFromCompany } from '../pdf/pdf-data';

const D = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);
const cents = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

interface LineInput {
  description: string;
  unit: string;
  quantity: Prisma.Decimal.Value;
  unitPrice: Prisma.Decimal.Value;
  lineTotal: Prisma.Decimal.Value;
}

function totals(lines: LineInput[], vatRate: Prisma.Decimal) {
  const totalNet = lines.reduce((sum, l) => sum.plus(l.lineTotal), D(0));
  const totalVat = cents(totalNet.times(vatRate).div(100));
  return { totalNet, totalVat, totalGross: totalNet.plus(totalVat) };
}

@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  findAllForProject(companyId: string, projectId: string) {
    return this.prisma.invoice.findMany({
      where: { companyId, projectId },
      include: { lineItems: { orderBy: { position: 'asc' } } },
      orderBy: { createdAt: 'asc' },
    });
  }

  async findOne(companyId: string, id: string) {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id, companyId },
      include: { lineItems: { orderBy: { position: 'asc' } } },
    });
    if (!invoice) {
      throw new NotFoundException('Rechnung nicht gefunden.');
    }
    return invoice;
  }

  // Entwurf aus einem Auftrag. Die Sperre je Auftrag verhindert, dass zwei
  // gleichzeitige Anfragen zusammen mehr als 100 % abrechnen oder zwei
  // Schlussrechnungen entstehen.
  async createFromOrder(companyId: string, dto: CreateInvoiceFromOrderDto) {
    const exists = await this.prisma.order.findFirst({ where: { id: dto.orderId, companyId } });
    if (!exists) {
      throw new NotFoundException('Auftrag nicht gefunden.');
    }
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });

    return this.prisma.$transaction(async (tx) => {
      await lockFor(tx, 'invoice-order', dto.orderId);
      const order = await tx.order.findUniqueOrThrow({
        where: { id: dto.orderId },
        include: { quote: { include: { lineItems: { orderBy: { position: 'asc' } } } }, invoices: true },
      });
      if (order.status === 'cancelled') {
        throw new BadRequestException('Ein stornierter Auftrag kann nicht abgerechnet werden.');
      }
      const active = order.invoices.filter((i) => i.kind !== 'cancellation' && i.status !== 'cancelled');
      if (active.some((i) => i.kind === 'final')) {
        throw new BadRequestException('Für diesen Auftrag gibt es bereits eine Schlussrechnung.');
      }

      let lines: LineInput[];
      if (dto.kind === 'partial') {
        const amount = cents(order.totalNet.times(dto.percent!).div(100));
        const alreadyBilled = active
          .filter((i) => i.kind === 'partial')
          .reduce((sum, i) => sum.plus(i.totalNet), D(0));
        if (alreadyBilled.plus(amount).greaterThan(order.totalNet)) {
          throw new BadRequestException(
            `Abschläge dürfen die Auftragssumme nicht übersteigen (bereits abgerechnet: ${alreadyBilled.toFixed(2)} € von ${order.totalNet.toFixed(2)} € netto).`,
          );
        }
        const quoteRef = order.quote.number ? ` gemäß Angebot ${order.quote.number}` : '';
        lines = [
          {
            description: `Abschlagsrechnung (${dto.percent} % der Auftragssumme)${quoteRef}`,
            unit: 'pauschal',
            quantity: 1,
            unitPrice: amount,
            lineTotal: amount,
          },
        ];
      } else {
        if (active.some((i) => i.kind === 'partial' && i.status === 'draft')) {
          throw new BadRequestException(
            'Es gibt noch einen Entwurf einer Abschlagsrechnung – zuerst ausstellen oder löschen.',
          );
        }
        lines = order.quote.lineItems.map((li) => ({
          description: li.description,
          unit: li.unit,
          quantity: li.quantity,
          unitPrice: li.unitPrice,
          lineTotal: li.lineTotal,
        }));
        // Ausgestellte Abschläge werden abgezogen; ihre Umsatzsteuer wurde
        // bereits mit der Abschlagsrechnung berechnet.
        for (const partial of active.filter((i) => i.kind === 'partial')) {
          lines.push({
            description: `abzüglich Abschlagsrechnung ${partial.number} vom ${formatDate(partial.issueDate!, company.timeZone)}`,
            unit: 'pauschal',
            quantity: 1,
            unitPrice: partial.totalNet.negated(),
            lineTotal: partial.totalNet.negated(),
          });
        }
      }

      const { vatRate, vatTreatment } = order.quote;
      return tx.invoice.create({
        data: {
          companyId,
          projectId: order.projectId,
          orderId: order.id,
          kind: dto.kind,
          vatRate,
          vatTreatment,
          ...totals(lines, vatRate),
          servicePeriodStart: dto.servicePeriodStart ? new Date(dto.servicePeriodStart) : null,
          servicePeriodEnd: dto.servicePeriodEnd ? new Date(dto.servicePeriodEnd) : null,
          lineItems: { create: lines.map((l, index) => ({ ...l, position: index + 1 })) },
        },
        include: { lineItems: { orderBy: { position: 'asc' } } },
      });
    });
  }

  async removeDraft(companyId: string, id: string) {
    const { count } = await this.prisma.invoice.deleteMany({ where: { id, companyId, status: 'draft' } });
    if (count === 0) {
      await this.findOne(companyId, id); // 404, falls nicht vorhanden
      throw new BadRequestException(
        'Nur Entwürfe können gelöscht werden – ausgestellte Rechnungen werden storniert.',
      );
    }
    return { removed: true };
  }

  // Pflichtangaben nach § 14 UStG prüfen und festschreiben.
  private async sellerAndBuyer(tx: Prisma.TransactionClient, companyId: string, projectId: string) {
    const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
    const missing = [
      !company.street && 'Straße',
      !company.postalCode && 'PLZ',
      !company.city && 'Ort',
      !company.taxNumber && !company.vatId && 'Steuernummer oder USt-IdNr.',
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new BadRequestException(
        `Für eine Rechnung fehlen Angaben zur eigenen Firma: ${missing.join(', ')} (Einstellungen -> Firmendaten).`,
      );
    }

    const project = await tx.project.findUniqueOrThrow({
      where: { id: projectId },
      include: { property: { include: { customer: true } } },
    });
    const { customer } = project.property;
    const address = [customer, project.property].find((a) => a.street && a.postalCode && a.city);
    if (!address) {
      throw new BadRequestException(
        'Für eine Rechnung fehlt die Anschrift des Kunden (weder beim Kunden noch beim Objekt vollständig).',
      );
    }

    return {
      timeZone: company.timeZone,
      seller: {
        name: company.name,
        street: company.street,
        postalCode: company.postalCode,
        city: company.city,
        taxNumber: company.taxNumber,
        vatId: company.vatId,
        email: company.email,
        phone: company.phone,
        contactName: company.contactName,
        iban: company.iban,
        bic: company.bic,
        paymentTermDays: company.paymentTermDays,
      },
      buyer: {
        name: customer.name,
        street: address.street,
        postalCode: address.postalCode,
        city: address.city,
        email: customer.email,
        buyerReference: customer.buyerReference,
        vatId: customer.vatId,
      },
    };
  }

  // Ausstellen: Nummer vergeben und festschreiben. Nummer und Statuswechsel
  // laufen in einer Transaktion – scheitert etwas, bleibt keine Lücke.
  async issue(companyId: string, userId: string, id: string, dto: IssueInvoiceDto) {
    const draft = await this.findOne(companyId, id);
    return this.prisma.$transaction(async (tx) => {
      await lockFor(tx, 'invoice-order', draft.orderId);
      const { seller, buyer, timeZone } = await this.sellerAndBuyer(tx, companyId, draft.projectId);
      const issueDate = dto.issueDate ? new Date(dto.issueDate) : new Date();
      const year = yearInZone(issueDate, timeZone);

      const current = await tx.invoice.findUniqueOrThrow({ where: { id } });
      if (current.status !== 'draft') {
        throw new BadRequestException('Diese Rechnung ist bereits ausgestellt.');
      }
      const number = formatDocumentNumber('R', year, await nextSequenceValue(tx, companyId, 'invoice', year));
      await tx.invoice.update({
        where: { id },
        data: {
          status: 'issued',
          number,
          issueDate,
          servicePeriodEnd: current.servicePeriodEnd ?? issueDate,
          sellerSnapshot: seller,
          buyerSnapshot: buyer,
        },
      });
      await writeAudit(tx, {
        companyId,
        userId,
        action: 'invoice_issue',
        entity: 'Invoice',
        entityId: id,
        newData: { number },
      });
      return tx.invoice.findUniqueOrThrow({
        where: { id },
        include: { lineItems: { orderBy: { position: 'asc' } } },
      });
    });
  }

  // Storno: eine ausgestellte Rechnung wird nie geändert, sondern durch eine
  // Stornorechnung mit negativen Beträgen und eigener Nummer aufgehoben.
  async cancel(companyId: string, userId: string, id: string, reason: string) {
    const original = await this.findOne(companyId, id);
    return this.prisma.$transaction(async (tx) => {
      await lockFor(tx, 'invoice-order', original.orderId);
      const current = await tx.invoice.findUniqueOrThrow({ where: { id } });
      if (current.status !== 'issued' || current.kind === 'cancellation') {
        throw new BadRequestException('Nur ausgestellte Rechnungen können storniert werden.');
      }
      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      const issueDate = new Date();
      const year = yearInZone(issueDate, company.timeZone);

      // Erst als Entwurf mit Positionen anlegen, dann ausstellen – ausgestellte
      // Rechnungen nehmen keine neuen Positionen mehr an (Datenbank-Trigger).
      const cancellation = await tx.invoice.create({
        data: {
          companyId,
          projectId: original.projectId,
          orderId: original.orderId,
          kind: 'cancellation',
          cancelsInvoiceId: original.id,
          vatRate: original.vatRate,
          vatTreatment: original.vatTreatment,
          totalNet: original.totalNet.negated(),
          totalVat: original.totalVat.negated(),
          totalGross: original.totalGross.negated(),
          servicePeriodStart: original.servicePeriodStart,
          servicePeriodEnd: original.servicePeriodEnd,
          lineItems: {
            create: original.lineItems.map((li) => ({
              position: li.position,
              description: li.description,
              unit: li.unit,
              quantity: li.quantity,
              unitPrice: li.unitPrice.negated(),
              lineTotal: li.lineTotal.negated(),
            })),
          },
        },
      });
      const number = formatDocumentNumber('R', year, await nextSequenceValue(tx, companyId, 'invoice', year));
      await tx.invoice.update({
        where: { id: cancellation.id },
        data: {
          status: 'issued',
          number,
          issueDate,
          sellerSnapshot: original.sellerSnapshot ?? Prisma.JsonNull,
          buyerSnapshot: original.buyerSnapshot ?? Prisma.JsonNull,
        },
      });
      await tx.invoice.update({ where: { id }, data: { status: 'cancelled' } });
      await writeAudit(tx, {
        companyId,
        userId,
        action: 'invoice_cancel',
        entity: 'Invoice',
        entityId: id,
        newData: { cancellationNumber: number, reason },
      });
      return tx.invoice.findUniqueOrThrow({
        where: { id: cancellation.id },
        include: { lineItems: { orderBy: { position: 'asc' } } },
      });
    });
  }

  // PDF der Rechnung. Ausgestellte Rechnungen nutzen die festgeschriebenen
  // Angaben (Snapshot), Entwürfe die aktuellen und tragen einen deutlichen
  // Entwurfs-Hinweis.
  async renderPdf(companyId: string, id: string) {
    const invoice = await this.findOne(companyId, id);
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: invoice.projectId },
      include: { property: { include: { customer: true } } },
    });
    const draft = invoice.status === 'draft';
    const tz = company.timeZone;
    const kindLabel = { partial: 'Abschlagsrechnung', final: 'Rechnung', cancellation: 'Stornorechnung' }[
      invoice.kind
    ];

    const meta: [string, string][] = [];
    if (invoice.number) meta.push(['Rechnungsnummer', invoice.number]);
    if (invoice.issueDate) meta.push(['Rechnungsdatum', formatDate(invoice.issueDate, tz)]);
    const periodEnd = invoice.servicePeriodEnd ?? invoice.issueDate;
    if (periodEnd) {
      meta.push(
        invoice.servicePeriodStart
          ? [
              'Leistungszeitraum',
              `${formatDate(invoice.servicePeriodStart, tz)} – ${formatDate(periodEnd, tz)}`,
            ]
          : ['Leistungsdatum', formatDate(periodEnd, tz)],
      );
    }
    meta.push(['Projekt', project.title]);

    const notes: string[] = [];
    if (invoice.kind === 'cancellation' && invoice.cancelsInvoiceId) {
      const original = await this.prisma.invoice.findUniqueOrThrow({
        where: { id: invoice.cancelsInvoiceId },
      });
      notes.push(`Diese Stornorechnung hebt die Rechnung ${original.number} vollständig auf.`);
    }
    if (invoice.status === 'cancelled') notes.push('Diese Rechnung wurde storniert.');
    const vatNote = VAT_TREATMENT_NOTES[invoice.vatTreatment];
    if (vatNote) notes.unshift(vatNote);

    // Ausgestellte Rechnungen als ZUGFeRD-PDF: die E-Rechnung steckt im PDF.
    // Fehlen dafür Angaben (z.B. IBAN), bleibt es beim lesbaren PDF – die
    // Meldung dazu gibt es beim Abruf der E-Rechnung.
    let eInvoiceXml: Buffer | undefined;
    if (!draft) {
      try {
        eInvoiceXml = (await this.renderXRechnung(companyId, id)).buffer;
      } catch (err) {
        if (!(err instanceof BadRequestException)) throw err;
      }
    }

    const buffer = await renderBusinessDocumentPdf({
      title: draft ? `${kindLabel} (Entwurf)` : `${kindLabel} ${invoice.number}`,
      draft,
      seller: (invoice.sellerSnapshot as BusinessDocumentPdf['seller'] | null) ?? sellerFromCompany(company),
      buyer: (invoice.buyerSnapshot as PdfParty | null) ?? buyerFromProject(project),
      meta,
      lines: pdfLines(invoice.lineItems),
      totals: {
        net: invoice.totalNet.toString(),
        vatRate: invoice.vatRate.toString(),
        vat: invoice.totalVat.toString(),
        gross: invoice.totalGross.toString(),
      },
      notes,
      eInvoiceXml,
    });
    return { buffer, fileName: `${invoice.number ?? 'Rechnung-Entwurf'}.pdf` };
  }

  // E-Rechnung (XRechnung 3.0, CII) einer ausgestellten Rechnung. Grundlage
  // sind die beim Ausstellen festgeschriebenen Angaben; Felder, die ältere
  // Snapshots noch nicht enthalten, kommen aus den aktuellen Stammdaten.
  async renderXRechnung(companyId: string, id: string) {
    const invoice = await this.findOne(companyId, id);
    if (invoice.status === 'draft' || !invoice.number || !invoice.issueDate) {
      throw new BadRequestException('Eine E-Rechnung gibt es erst für ausgestellte Rechnungen.');
    }
    if (invoice.vatTreatment === 'standard' && invoice.vatRate.isZero()) {
      throw new BadRequestException(
        'Eine Rechnung mit 0 % Umsatzsteuer braucht einen Grund (§ 19 oder § 13b UStG) – als E-Rechnung so nicht möglich.',
      );
    }
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: invoice.projectId },
      include: { property: { include: { customer: true } } },
    });
    const customer = project.property.customer;
    type Snapshot = Record<string, string | number | null | undefined>;
    const sellerSnap = (invoice.sellerSnapshot ?? {}) as Snapshot;
    const buyerSnap = (invoice.buyerSnapshot ?? {}) as Snapshot;
    const pick = <T>(snap: Snapshot, key: string, fallback: T) => (snap[key] ?? fallback) as T;

    const seller = {
      name: pick(sellerSnap, 'name', company.name),
      street: pick(sellerSnap, 'street', company.street ?? ''),
      postalCode: pick(sellerSnap, 'postalCode', company.postalCode ?? ''),
      city: pick(sellerSnap, 'city', company.city ?? ''),
      taxNumber: pick<string | null>(sellerSnap, 'taxNumber', company.taxNumber),
      vatId: pick<string | null>(sellerSnap, 'vatId', company.vatId),
      email: pick(sellerSnap, 'email', company.email ?? ''),
      phone: pick(sellerSnap, 'phone', company.phone ?? ''),
      contactName: pick(sellerSnap, 'contactName', company.contactName ?? '') || company.name,
      iban: pick(sellerSnap, 'iban', company.iban ?? ''),
      bic: pick<string | null>(sellerSnap, 'bic', company.bic),
      paymentTermDays: pick(sellerSnap, 'paymentTermDays', company.paymentTermDays),
    };
    const buyer = {
      name: pick(buyerSnap, 'name', customer.name),
      street: pick(buyerSnap, 'street', ''),
      postalCode: pick(buyerSnap, 'postalCode', ''),
      city: pick(buyerSnap, 'city', ''),
      email: pick(buyerSnap, 'email', customer.email ?? ''),
      vatId: pick<string | null>(buyerSnap, 'vatId', customer.vatId),
    };
    const buyerReference = pick(buyerSnap, 'buyerReference', customer.buyerReference ?? '') || project.title;

    const missing = [
      !seller.email && 'E-Mail der Firma',
      !seller.phone && 'Telefon der Firma',
      !seller.iban && 'IBAN der Firma',
      !buyer.email && 'E-Mail des Kunden',
      invoice.vatTreatment === 'reverse_charge' && !buyer.vatId && 'USt-IdNr. des Kunden (§ 13b UStG)',
    ].filter(Boolean);
    if (missing.length > 0) {
      throw new BadRequestException(`Für die E-Rechnung fehlen: ${missing.join(', ')}.`);
    }

    let precedingInvoice: XRechnungInput['precedingInvoice'];
    const notes: string[] = [];
    if (invoice.kind === 'cancellation' && invoice.cancelsInvoiceId) {
      const original = await this.prisma.invoice.findUniqueOrThrow({
        where: { id: invoice.cancelsInvoiceId },
      });
      precedingInvoice = { number: original.number!, issueDate: original.issueDate! };
      notes.push(`Stornorechnung zu Rechnung ${original.number}.`);
    }

    const xml = buildXRechnung({
      kind: invoice.kind,
      number: invoice.number,
      issueDate: invoice.issueDate,
      servicePeriodStart: invoice.servicePeriodStart,
      servicePeriodEnd: invoice.servicePeriodEnd ?? invoice.issueDate,
      timeZone: company.timeZone,
      buyerReference,
      precedingInvoice,
      seller,
      buyer,
      vatTreatment: invoice.vatTreatment,
      vatRate: invoice.vatRate,
      totalNet: invoice.totalNet,
      totalVat: invoice.totalVat,
      totalGross: invoice.totalGross,
      lines: invoice.lineItems,
      notes,
    });
    return { buffer: Buffer.from(xml, 'utf8'), fileName: `${invoice.number}.xml` };
  }

  // Versand per E-Mail: PDF und (Standard) die E-Rechnung als XML im Anhang.
  // Das XML ist die rechtlich maßgebliche E-Rechnung, das PDF die lesbare
  // Fassung. Der Versand wird protokolliert (die Rechnung selbst bleibt
  // unverändert – ausgestellte Rechnungen sind unveränderlich).
  async sendByEmail(companyId: string, userId: string, id: string, dto: SendInvoiceDto) {
    const invoice = await this.findOne(companyId, id);
    if (invoice.status === 'draft' || !invoice.number) {
      throw new BadRequestException('Nur ausgestellte Rechnungen können versendet werden.');
    }
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: invoice.projectId },
      include: { property: { include: { customer: true } } },
    });
    const to = dto.to ?? project.property.customer.email;
    if (!to) {
      throw new BadRequestException(
        'Keine Empfängeradresse: beim Kunden ist keine E-Mail-Adresse hinterlegt.',
      );
    }
    this.mail.assertConfigured();

    const pdf = await this.renderPdf(companyId, id);
    const attachments = [{ filename: pdf.fileName, content: pdf.buffer, contentType: 'application/pdf' }];
    if (dto.withXRechnung ?? true) {
      const xml = await this.renderXRechnung(companyId, id);
      attachments.push({ filename: xml.fileName, content: xml.buffer, contentType: 'application/xml' });
    }

    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const kindLabel = { partial: 'Abschlagsrechnung', final: 'Rechnung', cancellation: 'Stornorechnung' }[
      invoice.kind
    ];
    const text =
      dto.message ??
      [
        'Guten Tag,',
        '',
        `anbei erhalten Sie unsere ${kindLabel} ${invoice.number} zum Projekt „${project.title}“.`,
        attachments.length > 1
          ? 'Die E-Rechnung (XRechnung) liegt als XML-Datei bei, dazu das PDF zum Lesen (ZUGFeRD, mit eingebetteter E-Rechnung).'
          : 'Die Rechnung liegt als PDF bei.',
        '',
        'Mit freundlichen Grüßen',
        company.name,
      ].join('\n');

    await this.mail.send({
      to,
      replyTo: company.email ?? undefined,
      subject: `${kindLabel} ${invoice.number} – ${company.name}`,
      text,
      attachments,
    });
    await writeAudit(this.prisma, {
      companyId,
      userId,
      action: 'invoice_send',
      entity: 'Invoice',
      entityId: id,
      newData: { to, attachments: attachments.map((a) => a.filename) },
    });
    return { sent: true, to, attachments: attachments.map((a) => a.filename) };
  }
}
