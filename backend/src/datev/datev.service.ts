import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { writeAudit } from '../common/audit';
import { addCalendarDays, dayRangeInZone, localDayString, parseDayParam } from '../common/time-zone';
import { ensureDebtorNumber } from '../customers/debtor-number';
import { buildBuchungsstapel, buildDebitoren, ExtfBooking } from './extf-writer';
import { moneyAccounts, revenueAccountFor, revenueAccounts, chargeAccounts } from './revenue-accounts';

const KIND_LABELS = {
  partial: 'Abschlagsrechnung',
  final: 'Rechnung',
  cancellation: 'Stornorechnung',
  periodic: 'Rechnung',
} as const;
const DAY = /^\d{4}-\d{2}-\d{2}$/;

// Kalendertag in der Zeitzone der Firma als TTMM bzw. TTMMJJJJ
const ddmm = (instant: Date, tz: string) => {
  const [, month, day] = localDayString(instant, tz).split('-');
  return `${day}${month}`;
};
const ddmmyyyy = (instant: Date, tz: string) => {
  const [year, month, day] = localDayString(instant, tz).split('-');
  return `${day}${month}${year}`;
};

// Viele Kunden ohne Nummer (erster Export aus älteren Daten) brauchen länger
// als die 5 s Standard einer Prisma-Transaktion
const LONG_TRANSACTION = { timeout: 60_000, maxWait: 10_000 };

// Buchungsstapel der Ausgangsrechnungen für den Steuerberater (DATEV-Format
// EXTF). Jede ausgestellte Rechnung wird eine Buchung Debitor an Erlöskonto
// über den Bruttobetrag; Stornorechnungen im Haben. Abschlagsrechnungen
// gehen wie Rechnungen auf das Erlöskonto, die Schlussrechnung verrechnet
// sie bereits – die Summe der Erlöse stimmt so.
@Injectable()
export class DatevService {
  constructor(private prisma: PrismaService) {}

  // Mit includePayments zusätzlich die Zahlungseingänge (Geldkonto an Debitor,
  // Belegfeld 1 = Rechnungsnummer für den OP-Ausgleich). Standard: nein –
  // viele Kanzleien übernehmen die Bankumsätze direkt aus dem Bankkonto,
  // dann wären die Zahlungen doppelt gebucht.
  async exportBookings(companyId: string, userId: string, from: string, to: string, includePayments = false) {
    if (!DAY.test(from) || !DAY.test(to)) {
      throw new BadRequestException('Zeitraum als Datum angeben, z.B. from=2026-09-01&to=2026-09-30.');
    }
    if (from > to) throw new BadRequestException('Das Startdatum liegt nach dem Enddatum.');
    if (from.slice(0, 4) !== to.slice(0, 4)) {
      throw new BadRequestException('Ein Buchungsstapel darf nur ein Wirtschaftsjahr umfassen.');
    }
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    if (!company.datevConsultantNumber || !company.datevClientNumber) {
      throw new BadRequestException(
        'Für den DATEV-Export fehlen Berater- und Mandantennummer (Einstellungen → DATEV).',
      );
    }
    const tz = company.timeZone;
    const start = dayRangeInZone(parseDayParam(from), tz).start;
    const end = dayRangeInZone(parseDayParam(to), tz).end;

    const invoices = await this.prisma.invoice.findMany({
      where: { companyId, status: { in: ['issued', 'cancelled'] }, issueDate: { gte: start, lt: end } },
      include: { project: { include: { property: { include: { customer: true } } } } },
      orderBy: [{ issueDate: 'asc' }, { number: 'asc' }],
    });
    // Zahlungen: paidOn ist ein reines Datum, daher direkt nach Tagen filtern
    const payments = includePayments
      ? await this.prisma.invoicePayment.findMany({
          where: {
            companyId,
            paidOn: { gte: new Date(`${from}T00:00:00Z`), lte: new Date(`${to}T00:00:00Z`) },
          },
          include: {
            invoice: { include: { project: { include: { property: { include: { customer: true } } } } } },
          },
          orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }],
        })
      : [];
    if (invoices.length === 0 && payments.length === 0) {
      throw new BadRequestException(
        includePayments
          ? 'Im Zeitraum gibt es keine ausgestellten Rechnungen und keine Zahlungseingänge.'
          : 'Im Zeitraum gibt es keine ausgestellten Rechnungen.',
      );
    }
    const accounts = revenueAccounts(company.datevChartOfAccounts, company.datevRevenueAccounts);
    const money = moneyAccounts(company.datevChartOfAccounts, company.datevRevenueAccounts);
    const charges = chargeAccounts(company.datevChartOfAccounts, company.datevRevenueAccounts);
    const customers = [
      ...invoices.map((i) => i.project.property.customer),
      ...payments.map((p) => p.invoice.project.property.customer),
    ];

    return this.prisma.$transaction(async (tx) => {
      // Kunden ohne Debitorennummer (z.B. aus älteren Datenbeständen) bekommen jetzt eine
      const debtorOf = new Map<string, number>();
      for (const customer of customers) {
        if (!debtorOf.has(customer.id))
          debtorOf.set(customer.id, await ensureDebtorNumber(tx, companyId, customer));
      }

      const bookings: ExtfBooking[] = [];
      for (const invoice of invoices) {
        if (invoice.totalGross.isZero()) continue; // z.B. Schlussrechnung = Summe der Abschläge
        const customer = invoice.project.property.customer;
        const buyer = (invoice.buyerSnapshot ?? {}) as { name?: string };
        const seller = (invoice.sellerSnapshot ?? {}) as { paymentTermDays?: number };
        const issueDate = invoice.issueDate!;
        const termDays = seller.paymentTermDays ?? company.paymentTermDays;
        // Fälligkeit in Kalendertagen (TTMMJJJJ)
        const [dueYear, dueMonth, dueDay] = addCalendarDays(localDayString(issueDate, tz), termDays).split(
          '-',
        );
        bookings.push({
          amount: invoice.totalGross.abs(),
          side: invoice.totalGross.isNegative() ? 'H' : 'S',
          account: debtorOf.get(customer.id)!,
          contraAccount: revenueAccountFor(accounts, invoice),
          documentDate: ddmm(issueDate, tz),
          documentNumber: invoice.number!,
          text: `${KIND_LABELS[invoice.kind]} ${buyer.name ?? customer.name}`,
          serviceDate: ddmmyyyy(invoice.servicePeriodEnd ?? issueDate, tz),
          ...(invoice.kind !== 'cancellation' ? { dueDate: `${dueDay}${dueMonth}${dueYear}` } : {}),
        });
      }

      for (const payment of payments) {
        const invoice = payment.invoice;
        const customer = invoice.project.property.customer;
        const buyer = (invoice.buyerSnapshot ?? {}) as { name?: string };
        const [, month, dayOfMonth] = payment.paidOn.toISOString().slice(0, 10).split('-');
        const base = {
          side: 'S' as const,
          account: money[payment.method],
          documentDate: `${dayOfMonth}${month}`,
          documentNumber: invoice.number!,
        };
        const name = buyer.name ?? customer.name;
        // Anteile auf Mahnkosten und Zinsen direkt als Ertrag, der Rest an den Debitor
        const principal = payment.amount.minus(payment.costsAmount).minus(payment.interestAmount);
        if (principal.greaterThan(0))
          bookings.push({
            ...base,
            amount: principal,
            contraAccount: debtorOf.get(customer.id)!,
            text: `Zahlung ${name}`,
          });
        if (payment.costsAmount.greaterThan(0))
          bookings.push({
            ...base,
            amount: payment.costsAmount,
            contraAccount: charges.dunningCosts,
            text: `Mahnkosten ${name}`,
          });
        if (payment.interestAmount.greaterThan(0))
          bookings.push({
            ...base,
            amount: payment.interestAmount,
            contraAccount: charges.interest,
            text: `Verzugszinsen ${name}`,
          });
      }

      const compact = (day: string) => day.replace(/-/g, '');
      const buffer = buildBuchungsstapel(
        {
          consultantNumber: company.datevConsultantNumber!,
          clientNumber: company.datevClientNumber!,
          fiscalYearStart: `${from.slice(0, 4)}0101`,
          from: compact(from),
          to: compact(to),
          chart: company.datevChartOfAccounts,
          label: `${includePayments ? 'Rechnungen+Zahlungen' : 'Ausgangsrechnungen'} ${from.slice(5, 7)}/${from.slice(0, 4)}`,
          createdAt: new Date(),
        },
        bookings,
      );
      await writeAudit(tx, {
        companyId,
        userId,
        action: 'datev_export',
        entity: 'Company',
        entityId: companyId,
        newData: { from, to, count: bookings.length, payments: payments.length } as Prisma.InputJsonValue,
      });
      return {
        buffer,
        fileName: `EXTF_Buchungsstapel_${compact(from)}_${compact(to)}.csv`,
        count: bookings.length,
      };
    }, LONG_TRANSACTION);
  }

  // Debitoren-Stammdaten für DATEV: alle Kunden (Standard) oder nur die mit
  // Rechnungen, jeweils mit Debitorennummer – fehlende werden jetzt vergeben,
  // damit Stammdaten und Buchungsstapel dieselben Konten nutzen
  async exportDebtors(companyId: string, userId: string, onlyInvoiced = false) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    if (!company.datevConsultantNumber || !company.datevClientNumber) {
      throw new BadRequestException(
        'Für den DATEV-Export fehlen Berater- und Mandantennummer (Einstellungen → DATEV).',
      );
    }
    const customers = await this.prisma.customer.findMany({
      where: {
        companyId,
        ...(onlyInvoiced
          ? {
              properties: {
                some: {
                  projects: { some: { invoices: { some: { status: { in: ['issued', 'cancelled'] } } } } },
                },
              },
            }
          : {}),
      },
      include: {
        properties: {
          where: { OR: [{ street: { not: null } }, { city: { not: null } }] },
          select: { street: true, postalCode: true, city: true },
          take: 1,
        },
      },
      orderBy: [{ debtorNumber: 'asc' }, { createdAt: 'asc' }],
    });
    if (customers.length === 0) {
      throw new BadRequestException(
        onlyInvoiced ? 'Es gibt noch keine Kunden mit Rechnungen.' : 'Es gibt noch keine Kunden.',
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const debtors = [];
      for (const customer of customers) {
        const account = await ensureDebtorNumber(tx, companyId, customer);
        // ohne eigene Rechnungsanschrift: Anschrift des Objekts (wie auf der Rechnung)
        const address =
          customer.street || customer.postalCode || customer.city ? customer : customer.properties[0];
        debtors.push({
          ...customer,
          street: address?.street ?? null,
          postalCode: address?.postalCode ?? null,
          city: address?.city ?? null,
          account,
        });
      }
      debtors.sort((a, b) => a.account - b.account);
      const year = new Date().getFullYear();
      const buffer = buildDebitoren(
        {
          consultantNumber: company.datevConsultantNumber!,
          clientNumber: company.datevClientNumber!,
          fiscalYearStart: `${year}0101`,
          from: '',
          to: '',
          chart: company.datevChartOfAccounts,
          label: 'Debitoren',
          createdAt: new Date(),
        },
        debtors,
      );
      await writeAudit(tx, {
        companyId,
        userId,
        action: 'datev_export',
        entity: 'Company',
        entityId: companyId,
        newData: { kind: 'debtors', count: debtors.length } as Prisma.InputJsonValue,
      });
      return { buffer, fileName: 'EXTF_Debitoren.csv', count: debtors.length };
    }, LONG_TRANSACTION);
  }
}
