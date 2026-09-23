import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, UnitSetting } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  findUnit,
  normalizeUnit,
  PartialRule,
  resolveRounding,
  roundQuantity,
  RoundingMode,
  STANDARD_UNITS,
  unitRule,
} from '../common/units';
import { UpsertUnitDto } from './units.dto';

type MasterRounding = {
  quantityDecimals: number | null;
  quantityRounding: RoundingMode | null;
  quantityStep: Prisma.Decimal | null;
};

export const masterRule = (m?: MasterRounding | null): PartialRule | null =>
  m ? { decimals: m.quantityDecimals, mode: m.quantityRounding, step: m.quantityStep } : null;

const settingRule = (s?: UnitSetting): PartialRule | null =>
  s ? { decimals: s.decimals, mode: s.rounding, step: s.step } : null;

// Einheiten und Rundung: Katalog mit den Anpassungen der Firma, eigene
// Einheiten, Auflösung der Rundungsregel für eine Position.
@Injectable()
export class UnitsService {
  constructor(private prisma: PrismaService) {}

  async list(companyId: string) {
    const [company, settings] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { quantityDecimals: true, quantityRounding: true },
      }),
      this.prisma.unitSetting.findMany({ where: { companyId }, orderBy: { code: 'asc' } }),
    ]);
    const byCode = new Map(settings.map((s) => [s.code, s]));
    const standard = STANDARD_UNITS.map((u) => {
      const s = byCode.get(u.code);
      return {
        code: u.code,
        label: u.label,
        dimension: u.dimension,
        factor: u.factor,
        custom: false,
        // Vorgabe des Katalogs und die Anpassung der Firma getrennt, damit
        // die Oberfläche "Standard" und "angepasst" unterscheiden kann
        defaultDecimals: u.decimals ?? null,
        defaultRounding: u.mode ?? null,
        decimals: s?.decimals ?? null,
        rounding: s?.rounding ?? null,
        step: s?.step ?? null,
      };
    });
    const custom = settings
      .filter((s) => !findUnit(s.code))
      .map((s) => ({
        code: s.code,
        label: s.label ?? s.code,
        dimension: null,
        factor: null,
        custom: true,
        defaultDecimals: null,
        defaultRounding: null,
        decimals: s.decimals,
        rounding: s.rounding,
        step: s.step,
      }));
    return { company, units: [...standard, ...custom] };
  }

  async upsert(companyId: string, rawCode: string, dto: UpsertUnitDto) {
    const code = normalizeUnit(rawCode);
    if (!code || code.length > 20) throw new BadRequestException('Ungültige Einheit.');
    const data = {
      ...(dto.label !== undefined ? { label: findUnit(code) ? null : dto.label.trim() } : {}),
      ...(dto.decimals !== undefined ? { decimals: dto.decimals } : {}),
      ...(dto.rounding !== undefined ? { rounding: dto.rounding } : {}),
      ...(dto.step !== undefined ? { step: dto.step } : {}),
    };
    return this.prisma.unitSetting.upsert({
      where: { companyId_code: { companyId, code } },
      create: { companyId, code, ...data },
      update: data,
    });
  }

  async remove(companyId: string, rawCode: string) {
    const { count } = await this.prisma.unitSetting.deleteMany({
      where: { companyId, code: normalizeUnit(rawCode) },
    });
    if (count === 0) throw new NotFoundException('Keine Anpassung für diese Einheit.');
    return { deleted: true };
  }

  // Regeln der Firma einmal laden; liefert eine Funktion, die für eine
  // Position die Rundung bestimmt und die Menge rundet
  async rounder(companyId: string) {
    const [company, settings] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({
        where: { id: companyId },
        select: { quantityDecimals: true, quantityRounding: true },
      }),
      this.prisma.unitSetting.findMany({ where: { companyId } }),
    ]);
    const byCode = new Map(settings.map((s) => [s.code, s]));
    return (input: {
      quantity: Prisma.Decimal.Value;
      unit: string;
      master?: MasterRounding | null;
      position?: PartialRule | null;
    }) => {
      const code = normalizeUnit(input.unit);
      const rule = resolveRounding({
        position: input.position,
        master: masterRule(input.master),
        unit: unitRule(code, settingRule(byCode.get(code))),
        company: { decimals: company.quantityDecimals, mode: company.quantityRounding },
      });
      return { quantity: roundQuantity(input.quantity, rule), rule };
    };
  }
}
