import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { formatDocumentNumber, nextSequenceValue, yearInZone } from '../common/numbering';
import { renderBusinessDocumentPdf } from '../pdf/business-document.pdf';
import { buyerFromProject, formatDate, pdfLines, sellerFromCompany } from '../pdf/pdf-data';
import { writeAudit } from '../common/audit';
import { resolveVatTreatment, VAT_TREATMENT_NOTES } from '../common/vat-treatment';
import { PrismaService } from '../prisma/prisma.service';
import { CalculationsService } from '../calculations/calculations.service';
import { CreateQuoteDto, QuoteStatus, UpdateQuoteDto } from './dto/quote.dto';
import { UnitsService } from '../units/units.service';
import { normalizeUnit } from '../common/units';

// Freie Position: Preis und Kosten wie eingegeben, Summe aus der gerundeten
// Menge auf Cent gerundet. Ohne Rezeptur gibt es keine Soll-Werte für die
// Nachkalkulation.
function freeLineItem(
  item: {
    description?: string;
    unit?: string;
    unitPrice?: number;
    costPerUnit?: number;
  },
  quantity: Prisma.Decimal,
) {
  const unitPrice = new Prisma.Decimal(item.unitPrice!);
  const costPerUnit = new Prisma.Decimal(item.costPerUnit ?? 0);
  return {
    serviceId: null,
    description: item.description!.trim(),
    unit: normalizeUnit(item.unit!),
    quantity,
    costPerUnit,
    unitPrice,
    marginPerUnit: unitPrice.minus(costPerUnit),
    lineTotal: unitPrice.times(quantity).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    plannedLaborMinutesPerUnit: null,
    plannedMaterialCostPerUnit: null,
  };
}

@Injectable()
export class QuotesService {
  constructor(
    private prisma: PrismaService,
    private calculationsService: CalculationsService,
    private unitsService: UnitsService,
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
      include: { lineItems: { orderBy: { position: 'asc' } } },
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
        include: { lineItems: { orderBy: { position: 'asc' } } },
        orderBy: { createdAt: 'desc' },
      }),
    );
  }

  findOne(companyId: string, id: string) {
    return this.assertQuoteBelongsToCompany(companyId, id);
  }

  // Positionen berechnen: Katalog-Leistungen aus der aktuellen Kalkulation,
  // freie Positionen wie eingegeben. Ergebnis ist der Snapshot, der am
  // Angebot gespeichert wird.
  private async buildLineItems(companyId: string, items: CreateQuoteDto['lineItems']) {
    // Positionen sind voneinander unabhängig – parallel statt sequenziell
    // verarbeiten (bei vielen Positionen spart das spürbar Latenz, da jede
    // Position sonst auf den DB-Roundtrip der vorherigen wartet).
    const round = await this.unitsService.rounder(companyId);
    const lineItemsData = await Promise.all(
      items.map(async (item) => {
        // Rundung, die nur für diese Position gilt (gespeichert zum Nachvollziehen)
        const override = {
          roundingDecimals: item.roundingDecimals ?? null,
          roundingMode: item.roundingMode ?? null,
          roundingStep: item.roundingStep ?? null,
        };
        const position = {
          decimals: override.roundingDecimals,
          mode: override.roundingMode,
          step: override.roundingStep,
        };
        if (!item.serviceId) {
          const { quantity, rule } = round({ quantity: item.quantity, unit: item.unit ?? '', position });
          return {
            ...freeLineItem(item, quantity),
            quantityExact: new Prisma.Decimal(item.quantity),
            ...override,
            roundingSource: rule.source,
          };
        }
        if (
          item.description !== undefined ||
          item.unitPrice !== undefined ||
          item.costPerUnit !== undefined
        ) {
          throw new BadRequestException(
            'Eine Position mit Leistung aus dem Katalog hat keinen eigenen Text oder Preis – dafür eine freie Position anlegen.',
          );
        }
        const service = await this.prisma.service.findFirst({
          where: { id: item.serviceId, companyId },
        });
        if (!service) {
          throw new NotFoundException(`Dienstleistung ${item.serviceId} nicht gefunden.`);
        }

        const { quantity, rule } = round({
          quantity: item.quantity,
          unit: service.unit,
          master: service,
          position,
        });
        // Preis aus der gerundeten Menge – die steht auf dem Angebot
        const calc = await this.calculationsService.calculateForService(companyId, {
          serviceId: item.serviceId,
          quantity: quantity.toNumber(),
          hourlyLaborRateOverride: item.hourlyLaborRateOverride,
          overheadPercentOverride: item.overheadPercentOverride,
          surchargePercentOverride: item.surchargePercentOverride,
        });

        return {
          serviceId: item.serviceId,
          description: service.name,
          unit: normalizeUnit(service.unit),
          quantity,
          quantityExact: new Prisma.Decimal(item.quantity),
          ...override,
          roundingSource: rule.source,
          costPerUnit: calc.costPerUnit,
          unitPrice: calc.salePricePerUnit,
          marginPerUnit: calc.marginPerUnit,
          lineTotal: calc.salePriceTotal,
          plannedLaborMinutesPerUnit: calc.laborMinutesPerUnit,
          plannedMaterialCostPerUnit: calc.materialCostPerUnitPrecise,
        };
      }),
    );

    return lineItemsData.map((line, index) => ({ ...line, position: index + 1 }));
  }

  // Summen und Umsatzsteuer eines Angebots
  private async totals(
    companyId: string,
    lineItems: { lineTotal: Prisma.Decimal | number }[],
    vat: Pick<CreateQuoteDto, 'vatRate' | 'vatTreatment'>,
  ) {
    // Summe exakt als Dezimalwert bilden (Positionsbeträge sind bereits auf
    // Cent gerundet, die Summe ist es damit ebenfalls). Die Umsatzsteuer wird
    // einmal auf die Nettosumme gerechnet und kaufmännisch gerundet.
    const totalNet = lineItems.reduce((sum, li) => sum.plus(li.lineTotal), new Prisma.Decimal(0));
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const vatTreatment = resolveVatTreatment(company.smallBusiness, vat.vatTreatment);
    const vatRate = new Prisma.Decimal(
      vatTreatment === 'standard' ? (vat.vatRate ?? company.defaultVatRate) : 0,
    );
    const totalVat = totalNet.times(vatRate).div(100).toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);

    return {
      company,
      totals: { totalNet, vatRate, vatTreatment, totalVat, totalGross: totalNet.plus(totalVat) },
    };
  }

  // Erzeugt für jede Position eine aktuelle Kalkulation und SPEICHERT das
  // Ergebnis als Snapshot. Ab hier ist der Preis "eingefroren" – ändert sich
  // später der Artikelpreis oder der Stundensatz der Firma, bleibt dieses
  // Angebot unverändert (siehe Punkt 21 im Ursprungsdokument).
  async create(companyId: string, dto: CreateQuoteDto) {
    await this.assertProjectBelongsToCompany(companyId, dto.projectId);
    const lineItems = await this.buildLineItems(companyId, dto.lineItems);
    const { company, totals } = await this.totals(companyId, lineItems, dto);

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
          introText: dto.introText?.trim() || null,
          ...totals,
          lineItems: { create: lineItems },
        },
        include: { lineItems: { orderBy: { position: 'asc' } } },
      });
    });
  }

  // Entwurf überarbeiten: Positionen und Umsatzsteuer werden ersetzt,
  // Katalog-Leistungen mit der aktuellen Rezeptur neu berechnet. Ab der
  // Freigabe ist das Angebot eingefroren. Das bedingte Update sperrt die
  // Zeile – eine gleichzeitige Freigabe wartet und sieht danach die neuen
  // Positionen.
  async update(companyId: string, id: string, dto: UpdateQuoteDto) {
    await this.assertQuoteBelongsToCompany(companyId, id);
    const lineItems = await this.buildLineItems(companyId, dto.lineItems);
    const { totals } = await this.totals(companyId, lineItems, dto);
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.quote.updateMany({
        where: { id, companyId, status: 'draft' },
        data: { ...totals, introText: dto.introText?.trim() || null },
      });
      if (count === 0) {
        throw new BadRequestException('Nur Angebote im Entwurf können bearbeitet werden.');
      }
      await tx.quoteLineItem.deleteMany({ where: { quoteId: id } });
      await tx.quoteLineItem.createMany({ data: lineItems.map((line) => ({ ...line, quoteId: id })) });
      return tx.quote.findUniqueOrThrow({
        where: { id },
        include: { lineItems: { orderBy: { position: 'asc' } } },
      });
    });
  }

  // Der Statuswechsel ist ein bedingtes Update ("nur wenn der Status noch
  // der gelesene ist"). Ohne die Bedingung würden zwei gleichzeitige Klicks
  // (z.B. "angenommen" und "abgelehnt") beide durchgehen – der zweite
  // überschriebe den ersten. Wer wann gewechselt hat, steht im Audit-Log.
  private transitionStatus(
    companyId: string,
    userId: string,
    id: string,
    from: QuoteStatus[],
    to: QuoteStatus,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const quote = await tx.quote.findFirst({
        where: { id, companyId },
        include: { lineItems: { orderBy: { position: 'asc' } } },
      });
      if (!quote) {
        throw new NotFoundException('Angebot nicht gefunden.');
      }
      if (!from.includes(quote.status)) {
        throw new BadRequestException(
          `Statuswechsel nicht erlaubt: Angebot ist "${quote.status}", erwartet einer von [${from.join(', ')}].`,
        );
      }
      const { count } = await tx.quote.updateMany({
        where: { id, companyId, status: { in: [quote.status] } },
        data: { status: to },
      });
      if (count === 0) {
        throw new BadRequestException('Das Angebot wurde gerade geändert – bitte neu laden.');
      }
      await writeAudit(tx, {
        companyId,
        userId,
        action: 'quote_status',
        entity: 'Quote',
        entityId: id,
        oldData: { status: quote.status },
        newData: { status: to },
      });
      return { ...quote, status: to };
    });
  }

  // draft -> approved (interne Freigabe, permission: quote.approve)
  approve(companyId: string, userId: string, id: string) {
    return this.transitionStatus(companyId, userId, id, ['draft'], 'approved');
  }

  // approved -> sent (an den Kunden verschickt, permission: quote.create reicht)
  send(companyId: string, userId: string, id: string) {
    return this.transitionStatus(companyId, userId, id, ['approved'], 'sent');
  }

  // sent -> accepted | rejected | expired (Kundenentscheidung erfassen)
  setOutcome(companyId: string, userId: string, id: string, status: 'accepted' | 'rejected' | 'expired') {
    return this.transitionStatus(companyId, userId, id, ['sent'], status);
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
      notes: [VAT_TREATMENT_NOTES[quote.vatTreatment]].filter((n): n is string => !!n),
      intro: quote.introText,
    });
    return { buffer, fileName: `${quote.number ?? 'Angebot'}.pdf` };
  }
}
