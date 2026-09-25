import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { allocateDebtorNumber } from './debtor-number';
import { CreateCustomerDto, UpdateCustomerDto } from './dto/create-customer.dto';
import { contains, pageArgs, SearchQueryDto } from '../common/pagination';
import { localDayString } from '../common/time-zone';

// MUSTER FÜR ALLE WEITEREN MODULE:
// Jede Methode nimmt companyId als Parameter entgegen (kommt vom Controller
// aus dem JWT, nie vom Client-Body) und filtert JEDE Query danach. Das ist
// die eigentliche Umsetzung der Mandantentrennung aus dem Architekturdokument
// – nicht als globaler Middleware-"Trick", sondern explizit und damit
// nachvollziehbar in jeder Query sichtbar.
@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService) {}

  async findAll(companyId: string, page: SearchQueryDto = {}) {
    const term = contains(page.q);
    const where: Prisma.CustomerWhereInput = {
      companyId,
      ...(term && {
        OR: [{ name: term }, { email: term }, { city: term }, { phone: term }],
      }),
    };
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

  // Verlauf des Kunden: Angebote und Rechnungen über alle Objekte und
  // Projekte, Umsatz je Jahr. Beträge nur mit den passenden Rechten –
  // Angebotssummen mit Verkaufspreis-Recht, Rechnungen mit Rechnungsrecht.
  async history(companyId: string, id: string, access: { salePrices: boolean; invoices: boolean }) {
    const customer = await this.prisma.customer.findFirst({ where: { id, companyId }, select: { id: true } });
    if (!customer) throw new NotFoundException('Kunde nicht gefunden.');
    const ofCustomer = { companyId, project: { property: { customerId: id } } };
    const project = { select: { id: true, number: true, title: true } } as const;
    const [company, quotes, invoices] = await Promise.all([
      this.prisma.company.findUniqueOrThrow({ where: { id: companyId }, select: { timeZone: true } }),
      this.prisma.quote.findMany({
        where: ofCustomer,
        orderBy: { createdAt: 'desc' },
        take: 200,
        select: { id: true, number: true, status: true, totalNet: true, createdAt: true, project },
      }),
      access.invoices
        ? this.prisma.invoice.findMany({
            where: { ...ofCustomer, status: { not: 'draft' } },
            orderBy: { issueDate: 'desc' },
            take: 200,
            select: {
              id: true,
              number: true,
              kind: true,
              status: true,
              totalNet: true,
              issueDate: true,
              project,
            },
          })
        : Promise.resolve(null),
    ]);
    const tz = company.timeZone;
    // Umsatz je Jahr wie in der Nachkalkulation: ausgestellt, ohne Stornos –
    // aus allen Rechnungen, nicht nur den 200 angezeigten
    const revenueRows = access.invoices
      ? await this.prisma.invoice.findMany({
          where: { ...ofCustomer, status: 'issued', kind: { not: 'cancellation' }, issueDate: { not: null } },
          select: { issueDate: true, totalNet: true },
        })
      : [];
    const byYear = new Map<string, number>();
    for (const invoice of revenueRows) {
      if (!invoice.issueDate) continue;
      const year = localDayString(invoice.issueDate, tz).slice(0, 4);
      byYear.set(year, (byYear.get(year) ?? 0) + Number(invoice.totalNet));
    }
    return {
      quotes: quotes.map((q) => ({
        id: q.id,
        number: q.number,
        status: q.status,
        date: localDayString(q.createdAt, tz),
        totalNet: access.salePrices ? q.totalNet : null,
        project: q.project,
      })),
      invoices:
        invoices?.map((i) => ({
          id: i.id,
          number: i.number,
          kind: i.kind,
          status: i.status,
          date: i.issueDate ? localDayString(i.issueDate, tz) : null,
          totalNet: i.totalNet,
          project: i.project,
        })) ?? null,
      revenueByYear: invoices
        ? [...byYear.entries()]
            .sort(([a], [b]) => b.localeCompare(a))
            .map(([year, net]) => ({ year: Number(year), net: Math.round(net * 100) / 100 }))
        : null,
    };
  }
}
