import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CalculationResult } from '../common/price-visibility';
import { CalculateServiceDto } from './dto/calculate-service.dto';

interface ComponentInput {
  quantityPer: number;
  laborMinutes: number | null;
  articlePurchasePrice: number | null;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

// Reine, deterministische Berechnungsfunktion – bewusst getrennt von der
// DB-Anbindung, damit sie ohne Mock-Aufwand direkt unit-getestet werden kann
// (siehe Punkt 14: "KI interpretiert, deterministische Software berechnet" –
// dieselbe Trennung gilt auch innerhalb der Backend-Architektur: Berechnung
// und Datenzugriff sind getrennt).
export function calculateServiceCost(
  components: ComponentInput[],
  quantity: number,
  hourlyLaborRate: number,
  overheadPercent: number,
  surchargePercent: number,
): CalculationResult {
  const materialCostPerUnit = round2(
    components.reduce((sum, c) => sum + c.quantityPer * (c.articlePurchasePrice ?? 0), 0),
  );

  const laborMinutesPerUnit = components.reduce((sum, c) => sum + (c.laborMinutes ?? 0), 0);
  const laborCostPerUnit = round2((laborMinutesPerUnit / 60) * hourlyLaborRate);

  const subtotalPerUnit = materialCostPerUnit + laborCostPerUnit;
  const overheadPerUnit = round2(subtotalPerUnit * (overheadPercent / 100));
  const costPerUnit = round2(subtotalPerUnit + overheadPerUnit);
  const salePricePerUnit = round2(costPerUnit * (1 + surchargePercent / 100));
  const marginPerUnit = round2(salePricePerUnit - costPerUnit);

  return {
    materialCostPerUnit,
    laborCostPerUnit,
    overheadPerUnit,
    costPerUnit,
    salePricePerUnit,
    marginPerUnit,
    quantity,
    materialCostTotal: round2(materialCostPerUnit * quantity),
    laborCostTotal: round2(laborCostPerUnit * quantity),
    overheadTotal: round2(overheadPerUnit * quantity),
    costTotal: round2(costPerUnit * quantity),
    salePriceTotal: round2(salePricePerUnit * quantity),
    marginTotal: round2(marginPerUnit * quantity),
  };
}

@Injectable()
export class CalculationsService {
  constructor(private prisma: PrismaService) {}

  async calculateForService(companyId: string, dto: CalculateServiceDto): Promise<CalculationResult> {
    const service = await this.prisma.service.findFirst({
      where: { id: dto.serviceId, companyId },
      include: { components: { include: { article: true } } },
    });
    if (!service) {
      throw new NotFoundException('Dienstleistung nicht gefunden.');
    }

    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });

    const components: ComponentInput[] = (service as any).components.map((c: any) => ({
      quantityPer: Number(c.quantityPer),
      laborMinutes: c.laborMinutes,
      articlePurchasePrice: c.article ? Number(c.article.purchasePrice) : null,
    }));

    const hourlyLaborRate = dto.hourlyLaborRateOverride ?? Number(company.hourlyLaborRate);
    const overheadPercent = dto.overheadPercentOverride ?? Number(company.overheadPercent);
    const surchargePercent = dto.surchargePercentOverride ?? Number(company.defaultSurchargePercent);

    return calculateServiceCost(components, dto.quantity, hourlyLaborRate, overheadPercent, surchargePercent);
  }
}
