import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';

const SETTINGS_SELECT = {
  id: true,
  name: true,
  street: true,
  postalCode: true,
  city: true,
  taxNumber: true,
  vatId: true,
  email: true,
  phone: true,
  contactName: true,
  iban: true,
  bic: true,
  paymentTermDays: true,
  smallBusiness: true,
  hourlyLaborRate: true,
  overheadPercent: true,
  defaultSurchargePercent: true,
  regularDailyHours: true,
  overtimeSurchargePercent: true,
  timeZone: true,
  defaultVatRate: true,
  datevConsultantNumber: true,
  datevClientNumber: true,
  datevChartOfAccounts: true,
  datevRevenueAccounts: true,
  dunningDeadlineDays: true,
  dunningFee1: true,
  dunningFee2: true,
  dunningFee3: true,
  dunningInterest: true,
  baseInterestRate: true,
  dunningLumpSum: true,
  quantityDecimals: true,
  quantityRounding: true,
} satisfies Prisma.CompanySelect;

@Injectable()
export class CompanyService {
  constructor(private prisma: PrismaService) {}

  async getSettings(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: SETTINGS_SELECT,
    });
    if (!company) {
      throw new NotFoundException('Firma nicht gefunden.');
    }
    return company;
  }

  updateSettings(companyId: string, dto: UpdateCompanySettingsDto) {
    return this.prisma.company.update({
      where: { id: companyId },
      data: {
        ...dto,
        // Erlöskonten ersetzen die bisherigen Abweichungen vollständig
        datevRevenueAccounts: dto.datevRevenueAccounts
          ? (JSON.parse(JSON.stringify(dto.datevRevenueAccounts)) as Prisma.InputJsonValue)
          : undefined,
      },
      select: SETTINGS_SELECT,
    });
  }
}
