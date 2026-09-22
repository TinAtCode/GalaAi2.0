import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
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
    // Cent gerundet, die Summe ist es damit ebenfalls).
    const totalNet = lineItemsData.reduce((sum, li) => sum.plus(li.lineTotal), new Prisma.Decimal(0));

    return this.prisma.quote.create({
      data: {
        companyId,
        projectId: dto.projectId,
        totalNet,
        lineItems: { create: lineItemsData },
      },
      include: { lineItems: true },
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
}
