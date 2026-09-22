import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateEmployeeDto } from './dto/create-employee.dto';

@Injectable()
export class EmployeesService {
  constructor(private prisma: PrismaService) {}

  findAll(companyId: string) {
    return this.prisma.employee.findMany({ where: { companyId }, orderBy: { lastName: 'asc' } });
  }

  async findOne(companyId: string, id: string) {
    const employee = await this.prisma.employee.findFirst({ where: { id, companyId } });
    if (!employee) {
      throw new NotFoundException('Mitarbeiter nicht gefunden.');
    }
    return employee;
  }

  // Findet den Employee-Datensatz, der zu einem eingeloggten User gehört
  // (für die Selbstbedienungs-Zeiterfassung "starte meine eigene Zeit").
  findByUserId(companyId: string, userId: string) {
    return this.prisma.employee.findFirst({ where: { companyId, userId } });
  }

  async create(companyId: string, dto: CreateEmployeeDto) {
    if (dto.userId) {
      // Mandantenprüfung: der verknüpfte User muss zur selben Firma gehören.
      const user = await this.prisma.user.findFirst({ where: { id: dto.userId, companyId } });
      if (!user) {
        throw new NotFoundException('Verknüpfter Benutzer nicht gefunden.');
      }
    }
    return this.prisma.employee.create({ data: { ...dto, companyId } });
  }
}
