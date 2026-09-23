import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { writeAudit } from '../common/audit';
import { PaymentsService, paidAmount } from '../invoices/payments.service';
import { invoiceNumbersIn, parseCamt053 } from './camt053';
import { BookBankTransactionDto } from './bank.dto';

type OpenInvoice = { id: string; number: string; open: Prisma.Decimal; customer: string };

// Bankabgleich: Kontoauszug (CAMT.053) einlesen, Zahlungseingänge den
// offenen Rechnungen zuordnen, nach Bestätigung als Zahlung buchen.
@Injectable()
export class BankService {
  constructor(
    private prisma: PrismaService,
    private payments: PaymentsService,
  ) {}

  // Offene Rechnungen der Firma mit Restbetrag (für Vorschläge)
  private async openInvoices(companyId: string): Promise<OpenInvoice[]> {
    const invoices = await this.prisma.invoice.findMany({
      where: { companyId, status: 'issued', kind: { not: 'cancellation' }, totalGross: { gt: 0 } },
      include: {
        payments: true,
        project: { select: { property: { select: { customer: { select: { name: true } } } } } },
      },
    });
    return invoices
      .map((i) => ({
        id: i.id,
        number: i.number!,
        open: i.totalGross.minus(paidAmount(i.payments)),
        customer: i.project.property.customer.name,
      }))
      .filter((i) => i.open.greaterThan(0));
  }

  // Vorschlag: Rechnungsnummer im Verwendungszweck; sonst genau eine offene
  // Rechnung, deren Restbetrag dem Zahlungsbetrag entspricht.
  private suggest(open: OpenInvoice[], remittance: string | null, amount: Prisma.Decimal) {
    const numbers = invoiceNumbersIn(remittance);
    const byNumber = open.find((i) => numbers.includes(i.number));
    if (byNumber) return { invoice: byNumber, reason: 'reference' as const };
    const sameAmount = open.filter((i) => i.open.equals(amount));
    return sameAmount.length === 1 ? { invoice: sameAmount[0], reason: 'amount' as const } : null;
  }

  async importStatement(companyId: string, userId: string, file: Express.Multer.File) {
    const xml = file.buffer.toString('utf8').replace(/^\uFEFF/, '');
    const { credits, skipped } = parseCamt053(xml);
    const { count } = await this.prisma.bankTransaction.createMany({
      data: credits.map((c) => ({
        companyId,
        dedupeKey: c.dedupeKey,
        accountIban: c.accountIban,
        bookingDate: new Date(`${c.bookingDate}T00:00:00Z`),
        amount: new Prisma.Decimal(c.amount),
        debtorName: c.debtorName,
        debtorIban: c.debtorIban,
        remittance: c.remittance,
        createdByUserId: userId,
      })),
      // bereits eingelesene Umsätze (gleicher dedupeKey) werden übersprungen
      skipDuplicates: true,
    });
    await writeAudit(this.prisma, {
      companyId,
      userId,
      action: 'bank_import',
      entity: 'Company',
      entityId: companyId,
      newData: { imported: count, duplicates: credits.length - count, ...skipped },
    });
    return { imported: count, duplicates: credits.length - count, skipped };
  }

  async list(companyId: string, status: 'open' | 'booked' | 'ignored' = 'open') {
    const transactions = await this.prisma.bankTransaction.findMany({
      where: { companyId, status },
      include: {
        payments: {
          select: { id: true, amount: true, invoiceId: true, invoice: { select: { number: true } } },
          orderBy: { createdAt: 'asc' },
        },
      },
      orderBy: [{ bookingDate: 'desc' }, { createdAt: 'asc' }],
      take: 500,
    });
    // Vorschläge mit aktuellem Stand: inzwischen bezahlte Rechnungen fallen
    // heraus, neue offene Rechnungen kommen hinzu
    const open = status === 'open' ? await this.openInvoices(companyId) : [];
    return transactions.map((t) => {
      const booked = paidAmount(t.payments);
      const rest = t.amount.minus(booked);
      // bereits aus diesem Umsatz bezahlte Rechnungen nicht erneut vorschlagen
      const candidates = open.filter((i) => !t.payments.some((p) => p.invoiceId === i.id));
      const suggestion = status === 'open' ? this.suggest(candidates, t.remittance, rest) : null;
      return {
        id: t.id,
        bookingDate: t.bookingDate.toISOString().slice(0, 10),
        amount: t.amount,
        booked,
        rest,
        debtorName: t.debtorName,
        debtorIban: t.debtorIban,
        remittance: t.remittance,
        status: t.status,
        payments: t.payments.map((p) => ({
          id: p.id,
          amount: p.amount,
          invoiceId: p.invoiceId,
          number: p.invoice.number,
        })),
        suggestion: suggestion && {
          invoiceId: suggestion.invoice.id,
          number: suggestion.invoice.number,
          open: suggestion.invoice.open,
          customer: suggestion.invoice.customer,
          reason: suggestion.reason,
        },
      };
    });
  }

  // Zuordnen und buchen: Zahlung zur Rechnung aus dem noch unverteilten Rest
  // des Bankumsatzes. Ein Umsatz kann mehrere Rechnungen begleichen; ist der
  // ganze Betrag verteilt, gilt er als gebucht. Die Zeilensperre auf dem
  // Umsatz verhindert, dass gleichzeitige Buchungen zusammen mehr verteilen.
  async book(companyId: string, userId: string, id: string, dto: BookBankTransactionDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "BankTransaction" WHERE id = ${id} AND "companyId" = ${companyId} FOR UPDATE`;
      const bank = await tx.bankTransaction.findFirst({
        where: { id, companyId },
        include: { payments: { select: { amount: true } } },
      });
      if (!bank) throw new NotFoundException('Bankumsatz nicht gefunden.');
      if (bank.status !== 'open') {
        throw new ConflictException('Der Bankumsatz ist bereits gebucht oder ignoriert.');
      }
      const rest = bank.amount.minus(paidAmount(bank.payments));
      const amount = dto.amount !== undefined ? new Prisma.Decimal(dto.amount) : rest;
      if (amount.greaterThan(rest)) {
        throw new BadRequestException(
          `Der Betrag ist höher als der noch nicht verteilte Rest des Bankumsatzes (${rest.toFixed(2).replace('.', ',')} €).`,
        );
      }
      const note = ['Bank', bank.debtorName, bank.remittance].filter(Boolean).join(': ').slice(0, 500);
      const payment = await this.payments.recordIn(
        tx,
        companyId,
        userId,
        dto.invoiceId,
        {
          amount: amount.toNumber(),
          paidOn: bank.bookingDate.toISOString().slice(0, 10),
          method: 'bank',
          note,
        },
        bank.id,
      );
      const fullyBooked = amount.equals(rest);
      if (fullyBooked) await tx.bankTransaction.update({ where: { id }, data: { status: 'booked' } });
      return { paymentId: payment.id, status: fullyBooked ? 'booked' : 'open', rest: rest.minus(amount) };
    });
  }

  // Kein Zahlungseingang zu einer Rechnung (z.B. Privateinlage, Erstattung) oder
  // Rest nach Teilbuchungen (z.B. Überzahlung, die mit dem Kunden geklärt wird)
  async setIgnored(companyId: string, id: string, ignored: boolean) {
    const { count } = await this.prisma.bankTransaction.updateMany({
      where: { id, companyId, status: ignored ? 'open' : 'ignored' },
      data: { status: ignored ? 'ignored' : 'open' },
    });
    if (count === 0) {
      const exists = await this.prisma.bankTransaction.findFirst({
        where: { id, companyId },
        select: { id: true },
      });
      if (!exists) throw new NotFoundException('Bankumsatz nicht gefunden.');
      throw new BadRequestException(
        ignored ? 'Nur offene Bankumsätze lassen sich ignorieren.' : 'Der Bankumsatz ist nicht ignoriert.',
      );
    }
    return { status: ignored ? 'ignored' : 'open' };
  }
}
