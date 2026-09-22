import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatDocumentNumber, nextSequenceValue, yearInZone } from '../common/numbering';
import { renderBusinessDocumentPdf } from '../pdf/business-document.pdf';
import { buyerFromProject, formatDate, pdfLines, sellerFromCompany } from '../pdf/pdf-data';
import { PrismaService } from '../prisma/prisma.service';
import { CalculationsService } from '../calculations/calculations.service';
import { CreateQuoteDto, QuoteStatus } from './dto/quote.dto';

@Injectable()
export class QuotesService {
  constructor(
    private prisma: PrismaService,
    private calculationsService: CalculationsService,
  ) {}

  private async assertProjectBelongsToCompany(companyId: string, projectId: string) {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, companyId },
    });
    if (!project) {
      throw new NotFoundException('Projekt nicht gefunden.');
    }
    return project;
  }

  private async assertQuoteBelongsToCompany(companyId: string, quoteId: string) {
    const quote = await this.prisma.quote.findFirst({
      where: { id: quoteId, companyId },
      include: { lineItems: true },
    });
    if (!quote) {
      throw new NotFoundException('Angebot nicht gefunden.');
    }
    return quote;
  }

  findAllForProject(companyId: string, projectId: string) {
    return this.assertProjectBelongsToCompany(companyId, projectId).then(() =>
      this.prisma.quote.findMany({
        where: { projectId, companyId },
        include: { lineItems: true },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  findOne(companyId: string, id: string) {
    return this.assertQuoteBelongsToCompany(companyId, id);
  }

  // Erzeugt für jede Position eine aktuelle Kalkulation und SPEICHERT das
  // Ergebnis als Snapshot. Ab hier ist der Preis "eingefroren" – ändert sich
  // später der Artikelpreis oder der Stundensatz der Firma, bleibt dieses
  // Angebot unverändert (siehe Punkt 21 im Ursprungsdokument).
  async create(companyId: string, dto: CreateQuoteDto) {
    await this.assertProjectBelongsToCompany(companyId, dto.projectId);

    // Positionen sind voneinander unabhängig – parallel statt sequenziell
    // verarbeiten (bei vielen Positionen spart das spürbar Latenz, da jede
    // Position sonst auf den DB-Roundtrip der vorherigen wartet).
    const lineItemsData = await Promise.all(
      dto.lineItems.map(async (item) => {
        const service = await this.prisma.service.findFirst({
          where: { id: item.serviceId, companyId },
        });
        if (!service) {
          throw new NotFoundException(`Dienstleistung ${item.serviceId} nicht gefunden.`);
        }

        const calc = await this.calculationsService.calculateForService(companyId, {
          serviceId: item.serviceId,
          quantity: item.quantity,
          hourlyLaborRateOverride: item.hourlyLaborRateOverride,
          overheadPercentOverride: item.overheadPercentOverride,
          surchargePercentOverride: item.surchargePercentOverride,
        });

        return {
          serviceId: item.serviceId,
          description: service.name,
          unit: service.unit,
          quantity: item.quantity,
          costPerUnit: calc.costPerUnit,
          unitPrice: calc.salePricePerUnit,
          marginPerUnit: calc.marginPerUnit,
          lineTotal: calc.salePriceTotal,
          plannedLaborMinutesPerUnit: calc.laborMinutesPerUnit,
          plannedMaterialCostPerUnit: calc.materialCostPerUnitPrecise,
        };
      }),
    );

    // Summe exakt als Dezimalwert bilden (Positionsbeträge sind bereits auf
    // Cent gerundet, die Summe ist es damit ebenfalls). Die Umsatzsteuer wird
    // einmal auf die Nettosumme gerechnet und kaufmännisch gerundet.
    const totalNet = lineItemsData.reduce((sum, li) => sum.plus(li.lineTotal), new Prisma.Decimal(0));
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const vatRate = new Prisma.Decimal(dto.vatRate ?? company.defaultVatRate);
    const totalVat = totalNet.times(vatRate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    // Nummer und Angebot in einer Transaktion: scheitert das Anlegen, ist
    // auch die Nummer nicht verbraucht.
    return this.prisma.$transaction(async (tx) => {
      const year = yearInZone(new Date(), company.timeZone);
      const value = await nextSequenceValue(tx, companyId, 'quote', year);
      return tx.quote.create({
        data: {
          companyId,
          projectId: dto.projectId,
          number: formatDocumentNumber('A', year, value),
          totalNet,
          vatRate,
          totalVat,
          totalGross: totalNet.plus(totalVat),
          lineItems: { create: lineItemsData },
        },
        include: { lineItems: true },
      });
    });
  }

  // Der Statuswechsel ist EIN bedingtes Update ("nur wenn der Status noch
  // einer von <from> ist"). Getrenntes Lesen und Schreiben würde zwei
  // gleichzeitige Klicks (z.B. "angenommen" und "abgelehnt") beide
  // durchlassen – der zweite überschriebe den ersten.
  private async transitionStatus(companyId: string, id: string, from: QuoteStatus[], to: QuoteStatus) {
    const { count } = await this.prisma.quote.updateMany({
      where: { id, companyId, status: { in: from } },
      data: { status: to },
    });
    const quote = await this.assertQuoteBelongsToCompany(companyId, id);
    if (count === 0) {
      throw new BadRequestException(
        `Statuswechsel nicht erlaubt: Angebot ist "${quote.status}", erwartet einer von [${from.join(', ')}].`,
      );
    }
    return quote;
  }

  // draft -> approved (interne Freigabe, permission: quote.approve)
  approve(companyId: string, id: string) {
    return this.transitionStatus(companyId, id, ['draft'], 'approved');
  }

  // approved -> sent (an den Kunden verschickt, permission: quote.create reicht)
  send(companyId: string, id: string) {
    return this.transitionStatus(companyId, id, ['approved'], 'sent');
  }

  // sent -> accepted | rejected | expired (Kundenentscheidung erfassen)
  setOutcome(companyId: string, id: string, status: 'accepted' | 'rejected' | 'expired') {
    return this.transitionStatus(companyId, id, ['sent'], status);
  }

  async renderPdf(companyId: string, id: string) {
    const quote = await this.assertQuoteBelongsToCompany(companyId, id);
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const project = await this.prisma.project.findUniqueOrThrow({
      where: { id: quote.projectId },
      include: { property: { include: { customer: true } } },
    });
    const tz = company.timeZone;
    const meta: [string, string][] = [];
    if (quote.number) meta.push(['Angebotsnummer', quote.number]);
    meta.push(['Datum', formatDate(quote.createdAt, tz)]);
    if (quote.validUntil) meta.push(['Gültig bis', formatDate(quote.validUntil, tz)]);
    meta.push(['Projekt', project.title]);

    const buffer = await renderBusinessDocumentPdf({
      title: `Angebot ${quote.number ?? ''}`.trim(),
      draft: false,
      seller: sellerFromCompany(company),
      buyer: buyerFromProject(project),
      meta,
      lines: pdfLines(quote.lineItems),
      totals: {
        net: quote.totalNet.toString(),
        vatRate: quote.vatRate.toString(),
        vat: quote.totalVat.toString(),
        gross: quote.totalGross.toString(),
      },
      notes: [],
    });
    return { buffer, fileName: `${quote.number ?? 'Angebot'}.pdf` };
  }
}
