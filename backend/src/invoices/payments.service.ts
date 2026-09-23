import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { lockFor } from '../common/advisory-lock';
import { writeAudit } from '../common/audit';
import { addCalendarDays, calendarDaysBetween, isValidDay, localDayString } from '../common/time-zone';
import { RecordPaymentDto } from './dto/invoice.dto';

// Summe der Zahlungen einer Rechnung
export const paidAmount = (payments: { amount: Prisma.Decimal }[]) =>
  payments.reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));

// Fälligkeit (JJJJ-MM-TT): Rechnungsdatum + Zahlungsziel in Kalendertagen der
// Firmen-Zeitzone. Das Zahlungsziel stammt aus dem Stand beim Ausstellen.
export function invoiceDueDay(
  invoice: { issueDate: Date | null; sellerSnapshot: Prisma.JsonValue | null },
  company: { timeZone: string; paymentTermDays: number },
) {
  const termDays =
    (invoice.sellerSnapshot as { paymentTermDays?: number } | null)?.paymentTermDays ??
    company.paymentTermDays;
  return addCalendarDays(localDayString(invoice.issueDate!, company.timeZone), termDays);
}

// Höchste Mahnstufe: 1 Zahlungserinnerung, 2 1. Mahnung, 3 2. Mahnung
export const MAX_DUNNING_LEVEL = 3;

// Zahlungseingänge und offene Posten. Die Rechnung bleibt unverändert;
// offen ist der Bruttobetrag abzüglich aller Zahlungen.
@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService) {}

  async record(companyId: string, userId: string, invoiceId: string, dto: RecordPaymentDto) {
    if (!isValidDay(dto.paidOn)) {
      throw new BadRequestException('Ungültiges Zahlungsdatum – erwartet z.B. 2026-09-23.');
    }
    return this.prisma.$transaction((tx) => this.recordIn(tx, companyId, userId, invoiceId, dto));
  }

  // Wie record(), aber in einer bestehenden Transaktion (z.B. Bankabgleich:
  // Zahlung buchen und Bankumsatz als gebucht markieren – beides oder nichts).
  async recordIn(
    tx: Prisma.TransactionClient,
    companyId: string,
    userId: string,
    invoiceId: string,
    dto: RecordPaymentDto,
    bankTransactionId?: string,
  ) {
    if (!isValidDay(dto.paidOn)) {
      throw new BadRequestException('Ungültiges Zahlungsdatum – erwartet z.B. 2026-09-23.');
    }
    {
      // Sperre je Rechnung: zwei gleichzeitige Zahlungen dürfen zusammen den
      // offenen Betrag nicht überschreiten. Dazu die Zeile der Rechnung selbst
      // sperren: ein gleichzeitiges Storno wartet, und eine Zahlung nach dem
      // Storno sieht den neuen Status.
      await lockFor(tx, 'invoice-payment', invoiceId);
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} AND "companyId" = ${companyId} FOR UPDATE`;
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, companyId },
        include: { payments: true },
      });
      if (!invoice) throw new NotFoundException('Rechnung nicht gefunden.');
      if (
        invoice.status !== 'issued' ||
        invoice.kind === 'cancellation' ||
        !invoice.totalGross.greaterThan(0)
      ) {
        throw new BadRequestException(
          'Zahlungen gibt es nur für ausgestellte Rechnungen (nicht für Entwürfe, Stornos oder stornierte Rechnungen).',
        );
      }
      const paid = invoice.payments.reduce((sum, p) => sum.plus(p.amount), new Prisma.Decimal(0));
      const open = invoice.totalGross.minus(paid);
      const amount = new Prisma.Decimal(dto.amount);
      if (amount.greaterThan(open)) {
        throw new BadRequestException(
          `Die Zahlung übersteigt den offenen Betrag (${open.toFixed(2).replace('.', ',')} €).`,
        );
      }
      const payment = await tx.invoicePayment.create({
        data: {
          companyId,
          invoiceId,
          amount,
          paidOn: new Date(`${dto.paidOn}T00:00:00Z`),
          method: dto.method ?? 'bank',
          note: dto.note?.trim() || null,
          bankTransactionId: bankTransactionId ?? null,
          createdByUserId: userId,
        },
      });
      await writeAudit(tx, {
        companyId,
        userId,
        action: 'invoice_payment',
        entity: 'Invoice',
        entityId: invoiceId,
        newData: { amount: amount.toNumber(), paidOn: dto.paidOn, method: payment.method },
      });
      return payment;
    }
  }

  async remove(companyId: string, userId: string, invoiceId: string, paymentId: string) {
    return this.prisma.$transaction(async (tx) => {
      // Kam die Zahlung aus dem Bankabgleich, zuerst den Bankumsatz sperren –
      // dieselbe Reihenfolge wie beim Buchen (Umsatz, dann Rechnung)
      const bankRef = await tx.invoicePayment.findFirst({
        where: { id: paymentId, invoiceId, companyId },
        select: { bankTransactionId: true },
      });
      if (bankRef?.bankTransactionId) {
        await tx.$queryRaw`SELECT id FROM "BankTransaction" WHERE id = ${bankRef.bankTransactionId} AND "companyId" = ${companyId} FOR UPDATE`;
      }
      await lockFor(tx, 'invoice-payment', invoiceId);
      const payment = await tx.invoicePayment.findFirst({ where: { id: paymentId, invoiceId, companyId } });
      if (!payment) throw new NotFoundException('Zahlung nicht gefunden.');
      // Der Bankumsatz ist wieder (teilweise) offen – auch wenn der Rest
      // ignoriert war, denn nun ist mehr als dieser Rest unverteilt
      if (payment.bankTransactionId) {
        await tx.bankTransaction.updateMany({
          where: { id: payment.bankTransactionId, companyId },
          data: { status: 'open' },
        });
      }
      await tx.invoicePayment.delete({ where: { id: payment.id } });
      await writeAudit(tx, {
        companyId,
        userId,
        action: 'invoice_payment_delete',
        entity: 'Invoice',
        entityId: invoiceId,
        oldData: {
          amount: payment.amount.toNumber(),
          paidOn: payment.paidOn.toISOString().slice(0, 10),
          method: payment.method,
        },
      });
      return { deleted: true };
    });
  }

  // Offene Posten: ausgestellte Rechnungen mit Restbetrag, älteste
  // Fälligkeit zuerst. Fällig = Rechnungsdatum + Zahlungsziel.
  async openItems(companyId: string) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    const tz = company.timeZone;
    const invoices = await this.prisma.invoice.findMany({
      where: { companyId, status: 'issued', kind: { not: 'cancellation' }, totalGross: { gt: 0 } },
      include: {
        payments: true,
        dunningNotices: { orderBy: { level: 'asc' } },
        project: {
          select: {
            id: true,
            title: true,
            property: { select: { customer: { select: { id: true, name: true } } } },
          },
        },
      },
    });
    const today = localDayString(new Date(), tz);
    return invoices
      .map((invoice) => {
        const paid = paidAmount(invoice.payments);
        const open = invoice.totalGross.minus(paid);
        const dueDay = invoiceDueDay(invoice, company);
        const daysOverdue = Math.max(0, calendarDaysBetween(dueDay, today));
        const last = invoice.dunningNotices.at(-1);
        const lastDeadline = last ? last.deadline.toISOString().slice(0, 10) : null;
        // Nächste Mahnstufe möglich: überfällig, Höchststufe nicht erreicht,
        // Frist der letzten Mahnung abgelaufen
        const canDun =
          daysOverdue > 0 &&
          (last?.level ?? 0) < MAX_DUNNING_LEVEL &&
          (lastDeadline === null || lastDeadline < today);
        return {
          invoiceId: invoice.id,
          number: invoice.number,
          kind: invoice.kind,
          issueDate: invoice.issueDate,
          dueDate: dueDay,
          daysOverdue,
          dunning: invoice.dunningNotices.map((n) => ({
            id: n.id,
            level: n.level,
            issuedOn: n.issuedOn.toISOString().slice(0, 10),
            deadline: n.deadline.toISOString().slice(0, 10),
            sentAt: n.sentAt,
          })),
          nextDunningLevel: canDun ? (last?.level ?? 0) + 1 : null,
          totalGross: invoice.totalGross,
          paid,
          open,
          project: { id: invoice.project.id, title: invoice.project.title },
          customer: invoice.project.property.customer,
        };
      })
      .filter((item) => item.open.greaterThan(0))
      .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || (a.number ?? '').localeCompare(b.number ?? ''));
  }
}
