import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { allocateDebtorNumber } from './debtor-number';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/create-customer.dto';
import { pageArgs, PageQueryDto } from '../common/pagination';

// MUSTER FÜR ALLE WEITEREN MODULE:
// Jede Methode nimmt companyId als Parameter entgegen (kommt vom Controller
// aus dem JWT, nie vom Client-Body) und filtert JEDE Query danach. Das ist
// die eigentliche Umsetzung der Mandantentrennung aus dem Architekturdokument
// – nicht als globaler Middleware-"Trick", sondern explizit und damit
// nachvollziehbar in jeder Query sichtbar.
@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: string, page: PageQueryDto = {}) {
    const where = { companyId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({ where, orderBy: { createdAt: 'desc' }, ...pageArgs(page) }),
      this.prisma.customer.count({ where }),
    ]);
    return { items, total };
  }

  async findOne(companyId: string, id: string) {
    const customer = await this.prisma.customer.findFirst({
      where: { id, companyId },
      // Objekte samt Projekten für die Kunden-Detailseite in einer Abfrage
      include: {
        properties: {
          orderBy: { label: 'asc' },
          include: {
            projects: { select: { id: true, title: true, status: true }, orderBy: { createdAt: 'desc' } },
          },
        },
      },
    });
    if (!customer) {
      throw new NotFoundException('Kunde nicht gefunden.');
    }
    return customer;
  }

  async create(companyId: string, dto: CreateCustomerDto) {
    return this.uniqueDebtorNumber(() =>
      this.prisma.$transaction(async (tx) =>
        tx.customer.create({
          data: {
            ...dto,
            companyId,
            debtorNumber: dto.debtorNumber ?? (await allocateDebtorNumber(tx, companyId)),
          },
        }),
      ),
    );
  }

  async update(companyId: string, id: string, dto: UpdateCustomerDto) {
    await this.findOne(companyId, id);
    return this.uniqueDebtorNumber(() => this.prisma.customer.update({ where: { id }, data: dto }));
  }

  // Eine Debitorennummer gibt es je Firma nur einmal.
  private async uniqueDebtorNumber<T>(write: () => Promise<T>): Promise<T> {
    try {
      return await write();
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw new ConflictException('Diese Debitorennummer ist schon einem anderen Kunden zugeordnet.');
      }
      throw err;
    }
  }
}
