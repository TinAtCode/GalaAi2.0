import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateCompanySettingsDto } from './dto/update-company-settings.dto';

@Injectable()
export class CompanyService {
  constructor(private prisma: PrismaService) {}

  async getSettings(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: {
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
        hourlyLaborRate: true,
        overheadPercent: true,
        defaultSurchargePercent: true,
        regularDailyHours: true,
        overtimeSurchargePercent: true,
        timeZone: true,
        defaultVatRate: true,
      },
    });
    if (!company) {
      throw new NotFoundException('Firma nicht gefunden.');
    }
    return company;
  }

  updateSettings(companyId: string, dto: UpdateCompanySettingsDto) {
    return this.prisma.company.update({
      where: { id: companyId },
      data: dto,
      select: {
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
        hourlyLaborRate: true,
        overheadPercent: true,
        defaultSurchargePercent: true,
        regularDailyHours: true,
        overtimeSurchargePercent: true,
        timeZone: true,
        defaultVatRate: true,
      },
    });
  }
}
