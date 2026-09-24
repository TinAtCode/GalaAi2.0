import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, RecurringPayment } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { isValidDay, localDayString } from '../common/time-zone';
import { PaymentsService } from '../invoices/payments.service';
import { normalizeIban, normalizeName } from './categorize';
import { addMonths, detectRecurring, dueDatesBetween, Interval } from './recurring';
import { UpsertRecurringDto } from './finance.dto';
import { PayablesService } from './payables/payables.service';

const ZERO = new Prisma.Decimal(0);
const day = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (value: string, days: number) => {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
};

type Debit = {
  bookingDate: Date;
  amount: Prisma.Decimal;
  counterpartyName: string | null;
  counterpartyIban: string | null;
  categoryId: string | null;
};

// Gehört eine Abbuchung zu einer wiederkehrenden Zahlung? Gleiche IBAN oder
// gleicher Name (ohne Empfänger: die Bezeichnung) und Betrag höchstens 10 % (mindestens 5 €) daneben
function matches(payment: RecurringPayment, debit: Debit) {
  const iban = normalizeIban(payment.counterpartyIban);
  const name = normalizeName(payment.counterpartyName || payment.name);
  const sameParty =
    (iban && iban === normalizeIban(debit.counterpartyIban)) ||
    (name && name === normalizeName(debit.counterpartyName));
  if (!sameParty) return false;
  const tolerance = Prisma.Decimal.max(payment.amount.times(0.1), 5);
  return debit.amount.minus(payment.amount).abs().lessThanOrEqualTo(tolerance);
}

// Fixkosten und Jahresüberblick
@Injectable()
export class RecurringService {
  constructor(
    private prisma: PrismaService,
    private payments: PaymentsService,
    private payables: PayablesService,
  ) {}

  private view(p: RecurringPayment) {
    return {
      id: p.id,
      name: p.name,
      counterpartyName: p.counterpartyName,
      counterpartyIban: p.counterpartyIban,
      amount: p.amount,
      interval: p.interval,
      nextDue: day(p.nextDue),
      endDate: p.endDate ? day(p.endDate) : null,
      categoryId: p.categoryId,
      active: p.active,
    };
  }

  async list(companyId: string) {
    const list = await this.prisma.recurringPayment.findMany({
      where: { companyId },
      orderBy: [{ active: 'desc' }, { nextDue: 'asc' }],
    });
    return list.map((p) => this.view(p));
  }

  // Vorschläge aus den Abbuchungen der letzten 13 Monate, ohne die, die
  // schon als wiederkehrende Zahlung angelegt sind
  async suggestions(companyId: string) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const since = addMonths(localDayString(new Date(), company.timeZone), -13);
    const [debits, existing] = await Promise.all([
      this.prisma.bankTransaction.findMany({
        where: {
          companyId,
          direction: 'debit',
          reversal: false,
          bookingDate: { gte: new Date(`${since}T00:00:00Z`) },
        },
        select: {
          bookingDate: true,
          amount: true,
          counterpartyName: true,
          counterpartyIban: true,
          categoryId: true,
        },
      }),
      this.prisma.recurringPayment.findMany({ where: { companyId } }),
    ]);
    const known = new Set(
      existing
        .flatMap((p) => [normalizeIban(p.counterpartyIban), normalizeName(p.counterpartyName || p.name)])
        .filter(Boolean),
    );
    return detectRecurring(debits.map((d) => ({ ...d, bookingDate: day(d.bookingDate) })))
      .filter((s) => !known.has(s.key))
      .map((s) => ({ ...s, amount: s.amount }));
  }

  private async check(companyId: string, dto: UpsertRecurringDto) {
    if (dto.nextDue !== undefined && !isValidDay(dto.nextDue))
      throw new BadRequestException('Ungültige Fälligkeit.');
    if (dto.endDate && !isValidDay(dto.endDate)) throw new BadRequestException('Ungültiges Enddatum.');
    if (dto.categoryId) {
      const category = await this.prisma.expenseCategory.findFirst({
        where: { id: dto.categoryId, companyId },
      });
      if (!category) throw new NotFoundException('Kategorie nicht gefunden.');
    }
  }

  private data(dto: UpsertRecurringDto) {
    return {
      ...(dto.name !== undefined ? { name: dto.name.trim() } : {}),
      ...(dto.counterpartyName !== undefined
        ? { counterpartyName: dto.counterpartyName?.trim() || null }
        : {}),
      ...(dto.counterpartyIban !== undefined
        ? { counterpartyIban: dto.counterpartyIban ? normalizeIban(dto.counterpartyIban) : null }
        : {}),
      ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
      ...(dto.interval !== undefined ? { interval: dto.interval } : {}),
      ...(dto.nextDue !== undefined ? { nextDue: new Date(`${dto.nextDue}T00:00:00Z`) } : {}),
      ...(dto.endDate !== undefined
        ? { endDate: dto.endDate ? new Date(`${dto.endDate}T00:00:00Z`) : null }
        : {}),
      ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId } : {}),
      ...(dto.active !== undefined ? { active: dto.active } : {}),
    };
  }

  async create(companyId: string, dto: UpsertRecurringDto) {
    if (!dto.name || dto.amount === undefined || !dto.interval || !dto.nextDue) {
      throw new BadRequestException('Name, Betrag, Rhythmus und nächste Fälligkeit sind Pflicht.');
    }
    await this.check(companyId, dto);
    const created = await this.prisma.recurringPayment.create({
      data: {
        companyId,
        name: dto.name.trim(),
        amount: dto.amount,
        interval: dto.interval,
        nextDue: new Date(`${dto.nextDue}T00:00:00Z`),
        ...this.data(dto),
      },
    });
    return this.view(created);
  }

  async update(companyId: string, id: string, dto: UpsertRecurringDto) {
    await this.check(companyId, dto);
    const { count } = await this.prisma.recurringPayment.updateMany({
      where: { id, companyId },
      data: this.data(dto),
    });
    if (count === 0) throw new NotFoundException('Wiederkehrende Zahlung nicht gefunden.');
    return this.view(await this.prisma.recurringPayment.findUniqueOrThrow({ where: { id } }));
  }

  async remove(companyId: string, id: string) {
    const { count } = await this.prisma.recurringPayment.deleteMany({ where: { id, companyId } });
    if (count === 0) throw new NotFoundException('Wiederkehrende Zahlung nicht gefunden.');
    return { deleted: true };
  }

  // Jahresüberblick: je Monat Einnahmen und Ausgaben je Kategorie laut
  // Kontoauszug; dazu geplant (Fixkosten, die im Monat fällig sind und noch
  // nicht abgebucht wurden) und erwartete Zahlungseingänge (offene Rechnungen
  // nach Fälligkeit). Vergangene Monate zeigen nur, was tatsächlich geschah.
  async year(companyId: string, year: number) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const today = localDayString(new Date(), company.timeZone);
    const from = `${year}-01-01`;
    const to = `${year}-12-31`;
    const [categories, transactions, recurring, openItems, payablePlan] = await Promise.all([
      this.prisma.expenseCategory.findMany({
        where: { companyId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      }),
      this.prisma.bankTransaction.findMany({
        where: {
          companyId,
          bookingDate: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
        },
        select: {
          bookingDate: true,
          amount: true,
          direction: true,
          counterpartyName: true,
          counterpartyIban: true,
          categoryId: true,
        },
      }),
      this.prisma.recurringPayment.findMany({ where: { companyId, active: true } }),
      this.payments.openItems(companyId),
      this.payables.openPlan(companyId, today),
    ]);

    const months = Array.from({ length: 12 }, (_, i) => `${year}-${String(i + 1).padStart(2, '0')}`);
    const result = months.map((month) => {
      const inMonth = transactions.filter((t) => day(t.bookingDate).startsWith(month));
      const debits = inMonth.filter((t) => t.direction === 'debit');
      const expenses: Record<string, Prisma.Decimal> = {};
      for (const d of debits) {
        const key = d.categoryId ?? 'none';
        expenses[key] = (expenses[key] ?? ZERO).plus(d.amount);
      }
      const monthEnd = addMonths(`${month}-01`, 1);
      const lastDay = new Date(
        Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)), 0),
      ).getUTCDate();
      const monthTo = `${month}-${String(lastDay).padStart(2, '0')}`;
      // geplant: Fälligkeiten ab heute, die noch nicht abgebucht sind
      const planned: {
        kind: 'recurring' | 'payable';
        id: string;
        name: string;
        amount: Prisma.Decimal;
        due: string;
        categoryId: string | null;
      }[] = recurring.flatMap((p) =>
        dueDatesBetween(
          {
            nextDue: day(p.nextDue),
            interval: p.interval as Interval,
            endDate: p.endDate ? day(p.endDate) : null,
          },
          `${month}-01`,
          monthTo,
        )
          .filter((due) => due >= today && !debits.some((d) => matches(p, d)))
          .map((due) => ({
            kind: 'recurring' as 'recurring' | 'payable',
            id: p.id,
            name: p.name,
            amount: p.amount,
            due,
            categoryId: p.categoryId,
          })),
      );
      // offene Eingangsrechnungen zum geplanten Zahltag (mit Skonto, solange möglich)
      for (const bill of payablePlan.filter((b) => b.date.startsWith(month))) {
        planned.push({
          kind: 'payable' as const,
          id: bill.id,
          name: bill.name,
          amount: new Prisma.Decimal(bill.amount),
          due: bill.date,
          categoryId: bill.categoryId,
        });
      }
      const expected = openItems
        .filter((i) => i.dueDate.startsWith(month) && i.dueDate >= today)
        .reduce((sum, i) => sum.plus(i.open), ZERO);
      const overdueNow = month === today.slice(0, 7) ? openItems.filter((i) => i.dueDate < today) : [];
      return {
        month,
        income: inMonth.filter((t) => t.direction === 'credit').reduce((sum, t) => sum.plus(t.amount), ZERO),
        expenses: Object.fromEntries(Object.entries(expenses).map(([k, v]) => [k, v])),
        spent: debits.reduce((sum, d) => sum.plus(d.amount), ZERO),
        planned,
        plannedTotal: planned.reduce((sum, p) => sum.plus(p.amount), ZERO),
        // erwartete Zahlungseingänge; überfällige zählen zum laufenden Monat
        expectedIncome: expected.plus(overdueNow.reduce((sum, i) => sum.plus(i.open), ZERO)),
        future: monthEnd > today,
      };
    });
    const fixedPerMonth = recurring.reduce(
      (sum, p) =>
        sum.plus(p.amount.dividedBy({ monthly: 1, quarterly: 3, halfyearly: 6, yearly: 12 }[p.interval])),
      ZERO,
    );
    return {
      year,
      today,
      categories: categories.map((c) => ({ id: c.id, name: c.name })),
      months: result,
      fixedCostsPerMonth: fixedPerMonth.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP),
    };
  }

  // Liquiditätsvorschau je Woche ab heute: Kontostand laut letztem
  // Kontoauszug, dazu erwartete Zahlungseingänge (offene Rechnungen nach
  // Fälligkeit, Überfälliges in der ersten Woche) und geplante Ausgaben
  // (Eingangsrechnungen zum Zahltag, Fixkosten, die noch nicht abgebucht sind)
  async forecast(companyId: string, weeks = 13) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const today = localDayString(new Date(), company.timeZone);
    const end = addDays(today, weeks * 7 - 1);
    const [balances, openItems, bills, recurring, recentDebits] = await Promise.all([
      this.prisma.bankBalance.findMany({
        where: { companyId },
        orderBy: [{ accountIban: 'asc' }, { date: 'desc' }],
        distinct: ['accountIban'],
      }),
      this.payments.openItems(companyId),
      this.payables.openPlan(companyId, today),
      this.prisma.recurringPayment.findMany({ where: { companyId, active: true } }),
      this.prisma.bankTransaction.findMany({
        where: {
          companyId,
          direction: 'debit',
          reversal: false,
          bookingDate: { gte: new Date(`${addDays(today, -40)}T00:00:00Z`) },
        },
        select: {
          bookingDate: true,
          amount: true,
          counterpartyName: true,
          counterpartyIban: true,
          categoryId: true,
        },
      }),
    ]);
    const startBalance = balances.reduce((sum, b) => sum.plus(b.amount), ZERO);
    type Item = {
      kind: 'receivable' | 'payable' | 'recurring';
      name: string;
      date: string;
      amount: Prisma.Decimal;
    };
    const items: Item[] = [
      ...openItems.map((i) => ({
        kind: 'receivable' as const,
        name: `${i.number} · ${i.customer.name}`,
        date: i.dueDate < today ? today : i.dueDate,
        amount: new Prisma.Decimal(i.open),
      })),
      ...bills.map((b) => ({
        kind: 'payable' as const,
        name: b.name,
        date: b.date,
        amount: new Prisma.Decimal(b.amount),
      })),
      ...recurring.flatMap((p) =>
        dueDatesBetween(
          {
            nextDue: day(p.nextDue),
            interval: p.interval as Interval,
            endDate: p.endDate ? day(p.endDate) : null,
          },
          today,
          end,
        )
          // schon abgebucht (bis zehn Tage vor oder nach der Fälligkeit)?
          .filter(
            (due) =>
              !recentDebits.some(
                (d) =>
                  day(d.bookingDate) >= addDays(due, -10) &&
                  day(d.bookingDate) <= addDays(due, 10) &&
                  matches(p, d),
              ),
          )
          .map((due) => ({ kind: 'recurring' as const, name: p.name, date: due, amount: p.amount })),
      ),
    ];
    let balance = startBalance;
    const rows = Array.from({ length: weeks }, (_, w) => {
      const from = addDays(today, w * 7);
      const to = addDays(from, 6);
      const inWeek = items
        .filter((i) => i.date >= from && i.date <= to)
        .sort((a, b) => a.date.localeCompare(b.date));
      const income = inWeek
        .filter((i) => i.kind === 'receivable')
        .reduce((sum, i) => sum.plus(i.amount), ZERO);
      const expenses = inWeek
        .filter((i) => i.kind !== 'receivable')
        .reduce((sum, i) => sum.plus(i.amount), ZERO);
      balance = balance.plus(income).minus(expenses);
      return { from, to, income, expenses, balance, items: inWeek };
    });
    const lowest = rows.reduce((min, r) => (r.balance.lessThan(min.balance) ? r : min), rows[0]);
    const discount = bills.filter((b) => b.withDiscount);
    const openBills = await this.prisma.incomingInvoice.findMany({
      where: { companyId, status: 'open', id: { in: discount.map((b) => b.id) } },
      select: { id: true, amount: true },
    });
    return {
      today,
      startBalance,
      balanceDate: balances.length
        ? day(balances.map((b) => b.date).sort((a, b) => a.getTime() - b.getTime())[0])
        : null,
      weeks: rows,
      lowest: { from: lowest.from, balance: lowest.balance },
      payables: {
        count: bills.length,
        total: bills.reduce((sum, b) => sum.plus(b.amount), ZERO),
        overdue: bills.filter((b) => b.overdue).reduce((sum, b) => sum.plus(b.amount), ZERO),
        // Ersparnis, wenn alle laufenden Skontofristen genutzt werden
        discountCount: discount.length,
        discountSaving: discount.reduce(
          (sum, b) => sum.plus(openBills.find((o) => o.id === b.id)?.amount.minus(b.amount) ?? ZERO),
          ZERO,
        ),
        nextDiscount: discount.map((b) => b.date).sort()[0] ?? null,
      },
    };
  }
}
