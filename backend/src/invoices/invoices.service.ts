import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { lockFor } from '../common/advisory-lock';
import { writeAudit } from '../common/audit';
import { formatDocumentNumber, nextSequenceValue, yearInZone } from '../common/numbering';
import { CreateInvoiceFromOrderDto, IssueInvoiceDto } from './dto/invoice.dto';

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

const formatDate = (date: Date, timeZone: string) => date.toLocaleDateString('de-DE', { timeZone });

@Injectable()
export class InvoicesService {
  constructor(private prisma: PrismaService) {}

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
        include: { quote: { include: { lineItems: true } }, invoices: true },
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

      const vatRate = order.quote.vatRate;
      return tx.invoice.create({
        data: {
          companyId,
          projectId: order.projectId,
          orderId: order.id,
          kind: dto.kind,
          vatRate,
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
      },
      buyer: {
        name: customer.name,
        street: address.street,
        postalCode: address.postalCode,
        city: address.city,
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
}
