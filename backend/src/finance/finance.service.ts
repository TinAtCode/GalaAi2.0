import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { pageArgs } from '../common/pagination';
import {
  addCalendarDays,
  dayRangeInZone,
  isValidDay,
  localDayString,
  parseDayParam,
} from '../common/time-zone';
import { PaymentsService } from '../invoices/payments.service';
import { ListTransactionsDto } from './finance.dto';

const MONTHS = 12;
const ZERO = new Prisma.Decimal(0);

// Erster Tag des Monats, der `back` Monate vor dem Monat von `day` liegt
function monthStart(day: string, back: number) {
  const [year, month] = day.split('-').map(Number);
  const index = year * 12 + (month - 1) - back;
  return `${Math.floor(index / 12)}-${String((index % 12) + 1).padStart(2, '0')}-01`;
}

// Finanzbereich für Geschäftsführung und Buchhaltung: Kontostände,
// Kontobewegungen, offene Forderungen und die letzten zwölf Monate. Eine
// Übersicht für Entscheidungen – die Buchführung bleibt bei DATEV.
@Injectable()
export class FinanceService {
  constructor(
    private prisma: PrismaService,
    private payments: PaymentsService,
  ) {}

  async overview(companyId: string) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const today = localDayString(new Date(), company.timeZone);

    // Kontostand: jeweils der letzte gebuchte Schlusssaldo je Konto
    const balances = await this.prisma.bankBalance.findMany({
      where: { companyId },
      orderBy: [{ accountIban: 'asc' }, { date: 'desc' }],
      distinct: ['accountIban'],
    });
    const accounts = balances.map((b) => ({
      iban: b.accountIban,
      balance: b.amount,
      date: b.date.toISOString().slice(0, 10),
    }));

    // Offene Forderungen aus den offenen Posten
    const items = await this.payments.openItems(companyId);
    const in30 = addCalendarDays(today, 30);
    const sum = (list: typeof items) => list.reduce((total, i) => total.plus(i.open), ZERO);
    const receivables = {
      count: items.length,
      open: sum(items),
      overdue: sum(items.filter((i) => i.daysOverdue > 0)),
      dueNext30Days: sum(items.filter((i) => i.daysOverdue <= 0 && i.dueDate <= in30)),
    };

    // Letzte zwölf Monate: Rechnungsbetrag (brutto; Stornorechnungen sind
    // negativ und heben die stornierte Rechnung auf) sowie
    // Zahlungseingänge und Ausgaben laut Kontoauszug
    const start = monthStart(today, MONTHS - 1);
    // Monat des Rechnungsdatums in der Zeitzone der Firma (wie überall sonst)
    const issued = await this.prisma.invoice.findMany({
      where: {
        companyId,
        status: { in: ['issued', 'cancelled'] },
        issueDate: { gte: dayRangeInZone(parseDayParam(start), company.timeZone).start },
      },
      select: { issueDate: true, totalGross: true },
    });
    const invoicedIn = (month: string) =>
      issued
        .filter((i) => localDayString(i.issueDate!, company.timeZone).startsWith(month))
        .reduce((total, i) => total.plus(i.totalGross), ZERO);
    const bank = await this.prisma.$queryRaw<
      { month: string; direction: 'credit' | 'debit'; total: Prisma.Decimal }[]
    >`
      SELECT to_char("bookingDate", 'YYYY-MM') AS month, direction::text AS direction, SUM(amount) AS total
      FROM "BankTransaction"
      WHERE "companyId" = ${companyId} AND "bookingDate" >= ${start}::date
      GROUP BY 1, 2`;
    const months = Array.from({ length: MONTHS }, (_, i) =>
      monthStart(today, MONTHS - 1 - i).slice(0, 7),
    ).map((month) => ({
      month,
      invoiced: invoicedIn(month),
      received: new Prisma.Decimal(
        bank.find((r) => r.month === month && r.direction === 'credit')?.total ?? 0,
      ),
      spent: new Prisma.Decimal(bank.find((r) => r.month === month && r.direction === 'debit')?.total ?? 0),
    }));

    const latest = await this.prisma.bankTransaction.findFirst({
      where: { companyId },
      orderBy: { bookingDate: 'desc' },
      select: { bookingDate: true },
    });
    return {
      today,
      accounts,
      totalBalance: accounts.reduce((total, a) => total.plus(a.balance), ZERO),
      // bis wann Kontobewegungen eingelesen sind
      transactionsUntil: latest?.bookingDate.toISOString().slice(0, 10) ?? null,
      receivables,
      months,
    };
  }

  async transactions(companyId: string, query: ListTransactionsDto) {
    if ((query.from && !isValidDay(query.from)) || (query.to && !isValidDay(query.to))) {
      throw new BadRequestException('Ungültiges Datum.');
    }
    const q = query.q?.trim();
    const where: Prisma.BankTransactionWhereInput = {
      companyId,
      ...(query.direction ? { direction: query.direction } : {}),
      ...(query.from || query.to
        ? {
            bookingDate: {
              ...(query.from ? { gte: new Date(`${query.from}T00:00:00Z`) } : {}),
              ...(query.to ? { lte: new Date(`${query.to}T00:00:00Z`) } : {}),
            },
          }
        : {}),
      ...(q
        ? {
            OR: [
              { counterpartyName: { contains: q, mode: 'insensitive' } },
              { remittance: { contains: q, mode: 'insensitive' } },
              { counterpartyIban: { contains: q.replace(/\s+/g, ''), mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.bankTransaction.findMany({
        where,
        orderBy: [{ bookingDate: 'desc' }, { createdAt: 'desc' }],
        ...pageArgs(query),
      }),
      this.prisma.bankTransaction.count({ where }),
    ]);
    return {
      items: items.map((t) => ({
        id: t.id,
        bookingDate: t.bookingDate.toISOString().slice(0, 10),
        direction: t.direction,
        reversal: t.reversal,
        amount: t.amount,
        accountIban: t.accountIban,
        counterpartyName: t.counterpartyName,
        counterpartyIban: t.counterpartyIban,
        remittance: t.remittance,
      })),
      total,
    };
  }
}
