import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CalculationResult } from '../common/price-visibility';
import { CalculateServiceDto } from './dto/calculate-service.dto';

interface ComponentInput {
  quantityPer: number;
  laborMinutes: number | null;
  articlePurchasePrice: number | null;
  machineMinutes?: number | null;
  machineHourlyRate?: number | null;
}

// Exakte Dezimalrechnung (decimal.js über Prisma.Decimal) statt
// JavaScript-Kommazahlen: 0.1 + 0.2 ergibt hier wirklich 0.3.
const D = (n: number | string | Prisma.Decimal) => new Prisma.Decimal(n);
// Kaufmännisch runden (ROUND_HALF_UP) auf Cent und als Zahl ausgeben.
const toCents = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP).toNumber();

// Reine, deterministische Berechnungsfunktion – bewusst getrennt von der
// DB-Anbindung, damit sie ohne Mock-Aufwand direkt unit-getestet werden kann
// (siehe Punkt 14: "KI interpretiert, deterministische Software berechnet" –
// dieselbe Trennung gilt auch innerhalb der Backend-Architektur: Berechnung
// und Datenzugriff sind getrennt).
//
// Rundungsregel: Zwischenwerte (Material, Arbeitszeit, Gemeinkosten) werden
// NICHT gerundet, sonst summieren sich Rundungsfehler über die Rechenschritte
// und über die Menge auf. Gerundet wird nur, was ausgegeben wird. Der
// Verkaufspreis je Einheit wird auf Cent gerundet und daraus der
// Positionsbetrag gebildet – so bleibt ein Angebot für den Kunden
// nachrechenbar (Einzelpreis × Menge = Positionsbetrag).
export function calculateServiceCost(
  components: ComponentInput[],
  quantity: number,
  hourlyLaborRate: number,
  overheadPercent: number,
  surchargePercent: number,
): CalculationResult {
  const qty = D(quantity);
  const materialPerUnit = components.reduce(
    (sum, c) => sum.plus(D(c.quantityPer).times(c.articlePurchasePrice ?? 0)),
    D(0),
  );
  const laborMinutesPerUnit = components.reduce((sum, c) => sum + (c.laborMinutes ?? 0), 0);
  const laborPerUnit = D(laborMinutesPerUnit).div(60).times(hourlyLaborRate);
  // Maschinen (Bagger, Rüttler, ...) mit ihrem eigenen Stundensatz.
  const machinePerUnit = components.reduce(
    (sum, c) =>
      sum.plus(
        D(c.machineMinutes ?? 0)
          .div(60)
          .times(c.machineHourlyRate ?? 0),
      ),
    D(0),
  );
  const directPerUnit = materialPerUnit.plus(laborPerUnit).plus(machinePerUnit);
  const overheadPerUnit = directPerUnit.times(overheadPercent).div(100);
  const costPerUnit = directPerUnit.plus(overheadPerUnit);

  const salePricePerUnit = D(toCents(costPerUnit.times(D(surchargePercent).div(100).plus(1))));
  const salePriceTotal = salePricePerUnit.times(qty);
  const costTotal = D(toCents(costPerUnit.times(qty)));

  return {
    laborMinutesPerUnit,
    materialCostPerUnit: toCents(materialPerUnit),
    materialCostPerUnitPrecise: materialPerUnit.toDecimalPlaces(6, Prisma.Decimal.ROUND_HALF_UP).toNumber(),
    laborCostPerUnit: toCents(laborPerUnit),
    machineCostPerUnit: toCents(machinePerUnit),
    overheadPerUnit: toCents(overheadPerUnit),
    costPerUnit: toCents(costPerUnit),
    salePricePerUnit: toCents(salePricePerUnit),
    marginPerUnit: toCents(salePricePerUnit.minus(costPerUnit)),
    quantity,
    materialCostTotal: toCents(materialPerUnit.times(qty)),
    laborCostTotal: toCents(laborPerUnit.times(qty)),
    machineCostTotal: toCents(machinePerUnit.times(qty)),
    overheadTotal: toCents(overheadPerUnit.times(qty)),
    costTotal: toCents(costTotal),
    salePriceTotal: toCents(salePriceTotal),
    marginTotal: toCents(salePriceTotal.minus(costTotal)),
  };
}

@Injectable()
export class CalculationsService {
  constructor(private prisma: PrismaService) {}

  async calculateForService(companyId: string, dto: CalculateServiceDto): Promise<CalculationResult> {
    const service = await this.prisma.service.findFirst({
      where: { id: dto.serviceId, companyId },
      include: { components: { include: { article: true, machine: true } } },
    });
    if (!service) {
      throw new NotFoundException('Dienstleistung nicht gefunden.');
    }

    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });

    const components: ComponentInput[] = service.components.map((c) => ({
      quantityPer: Number(c.quantityPer),
      laborMinutes: c.laborMinutes,
      articlePurchasePrice: c.article ? Number(c.article.purchasePrice) : null,
      machineMinutes: c.machineMinutes,
      machineHourlyRate: c.machine ? Number(c.machine.hourlyRate) : null,
    }));

    const hourlyLaborRate = dto.hourlyLaborRateOverride ?? Number(company.hourlyLaborRate);
    const overheadPercent = dto.overheadPercentOverride ?? Number(company.overheadPercent);
    const surchargePercent = dto.surchargePercentOverride ?? Number(company.defaultSurchargePercent);

    return calculateServiceCost(components, dto.quantity, hourlyLaborRate, overheadPercent, surchargePercent);
  }
}
