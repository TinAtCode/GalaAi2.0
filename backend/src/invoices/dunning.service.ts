import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from '../mail/mail.service';
import { lockFor } from '../common/advisory-lock';
import { writeAudit } from '../common/audit';
import { addCalendarDays, localDayString } from '../common/time-zone';
import { renderLetterPdf } from '../pdf/business-document.pdf';
import { buyerFromProject, sellerFromCompany } from '../pdf/pdf-data';
import { BusinessDocumentPdf, PdfParty } from '../pdf/business-document.pdf';
import { invoiceDueDay, MAX_DUNNING_LEVEL, paidAmount } from './payments.service';
import { SendDunningDto } from './dto/invoice.dto';
import { dunningCharges } from './dunning-charges';
import { Prisma } from '@prisma/client';

export const DUNNING_TITLES: Record<number, string> = {
  1: 'Zahlungserinnerung',
  2: '1. Mahnung',
  3: '2. Mahnung',
};

const euro = (value: { toString(): string }) =>
  Number(value.toString()).toLocaleString('de-DE', { style: 'currency', currency: 'EUR' });
// JJJJ-MM-TT -> TT.MM.JJJJ
const day = (iso: string) => iso.split('-').reverse().join('.');
const dateOnly = (d: Date) => d.toISOString().slice(0, 10);

// Mahnwesen: Zahlungserinnerung, 1. und 2. Mahnung zu überfälligen
// Rechnungen, jeweils mit neuer Frist. Optional (Firmeneinstellung) mit
// Mahngebühren, Verzugszinsen und Verzugspauschale – eine eigene Forderung
// neben der Rechnung, die in der Mahnung aufgeführt wird.
@Injectable()
export class DunningService {
  constructor(
    private prisma: PrismaService,
    private mail: MailService,
  ) {}

  // Nächste Mahnstufe anlegen – nur, wenn die Rechnung überfällig und offen ist
  // und die Frist der vorigen Mahnung abgelaufen ist.
  async create(companyId: string, userId: string, invoiceId: string) {
    return this.prisma.$transaction(async (tx) => {
      // dieselbe Sperre wie bei Zahlungen: eine gleichzeitige Zahlung wird
      // vorher oder nachher gebucht, nie mitten in der Prüfung
      await lockFor(tx, 'invoice-payment', invoiceId);
      await tx.$queryRaw`SELECT id FROM "Invoice" WHERE id = ${invoiceId} AND "companyId" = ${companyId} FOR UPDATE`;
      const invoice = await tx.invoice.findFirst({
        where: { id: invoiceId, companyId },
        include: {
          payments: true,
          dunningNotices: { orderBy: { level: 'asc' } },
          project: { select: { property: { select: { customer: { select: { isBusiness: true } } } } } },
        },
      });
      if (!invoice) throw new NotFoundException('Rechnung nicht gefunden.');
      if (
        invoice.status !== 'issued' ||
        invoice.kind === 'cancellation' ||
        !invoice.totalGross.greaterThan(0)
      ) {
        throw new BadRequestException('Mahnungen gibt es nur für ausgestellte, nicht stornierte Rechnungen.');
      }
      const open = invoice.totalGross.minus(paidAmount(invoice.payments));
      if (!open.greaterThan(0)) throw new BadRequestException('Die Rechnung ist bereits bezahlt.');

      const company = await tx.company.findUniqueOrThrow({ where: { id: companyId } });
      const today = localDayString(new Date(), company.timeZone);
      const dueDay = invoiceDueDay(invoice, company);
      if (dueDay >= today) {
        throw new BadRequestException(`Die Rechnung ist noch nicht überfällig (fällig am ${day(dueDay)}).`);
      }
      const last = invoice.dunningNotices.at(-1);
      if (last && last.level >= MAX_DUNNING_LEVEL) {
        throw new BadRequestException('Die letzte Mahnstufe (2. Mahnung) ist bereits erreicht.');
      }
      if (last && dateOnly(last.deadline) >= today) {
        throw new BadRequestException(
          `Die Frist der ${DUNNING_TITLES[last.level]} läuft noch bis ${day(dateOnly(last.deadline))}.`,
        );
      }
      const level = (last?.level ?? 0) + 1;
      const deadline = addCalendarDays(today, company.dunningDeadlineDays);
      const charges = dunningCharges({
        level,
        today,
        dueDay,
        open,
        isBusiness: invoice.project.property.customer.isBusiness,
        previous: invoice.dunningNotices.map((n) => ({
          level: n.level,
          issuedOn: dateOnly(n.issuedOn),
          lumpSum: n.lumpSum,
        })),
        settings: {
          fees: [company.dunningFee1, company.dunningFee2, company.dunningFee3],
          interest: company.dunningInterest,
          baseInterestRate: company.baseInterestRate,
          lumpSum: company.dunningLumpSum,
        },
      });
      const notice = await tx.dunningNotice.create({
        data: {
          companyId,
          invoiceId,
          level,
          issuedOn: new Date(`${today}T00:00:00Z`),
          deadline: new Date(`${deadline}T00:00:00Z`),
          openAmount: open,
          fee: charges.fee,
          interest: charges.interest,
          interestRate: charges.interestRate,
          interestFrom: charges.interestFrom ? new Date(`${charges.interestFrom}T00:00:00Z`) : null,
          lumpSum: charges.lumpSum,
          createdByUserId: userId,
        },
      });
      await writeAudit(tx, {
        companyId,
        userId,
        action: 'dunning_create',
        entity: 'Invoice',
        entityId: invoiceId,
        newData: {
          level,
          deadline,
          openAmount: open.toNumber(),
          fee: charges.fee.toNumber(),
          interest: charges.interest.toNumber(),
          lumpSum: charges.lumpSum.toNumber(),
        },
      });
      return notice;
    });
  }

  private async load(companyId: string, invoiceId: string, noticeId: string) {
    const notice = await this.prisma.dunningNotice.findFirst({
      where: { id: noticeId, invoiceId, companyId },
    });
    if (!notice) throw new NotFoundException('Mahnung nicht gefunden.');
    const invoice = await this.prisma.invoice.findFirstOrThrow({
      where: { id: invoiceId, companyId },
      include: {
        payments: true,
        dunningNotices: { orderBy: { level: 'asc' } },
        project: { include: { property: { include: { customer: true } } } },
      },
    });
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    return { notice, invoice, company };
  }

  async renderPdf(companyId: string, invoiceId: string, noticeId: string) {
    const { notice, invoice, company } = await this.load(companyId, invoiceId, noticeId);
    const tz = company.timeZone;
    const title = DUNNING_TITLES[notice.level];
    const seller =
      (invoice.sellerSnapshot as BusinessDocumentPdf['seller'] | null) ?? sellerFromCompany(company);
    const snapshot = (invoice.sellerSnapshot ?? {}) as { iban?: string; bic?: string | null };
    const iban = snapshot.iban ?? company.iban;
    const bic = snapshot.bic ?? company.bic;
    const buyer = (invoice.buyerSnapshot as PdfParty | null) ?? buyerFromProject(invoice.project);
    const customer = invoice.project.property.customer;
    const issueDay = localDayString(invoice.issueDate!, tz);
    const dueDay = invoiceDueDay(invoice, company);
    const deadline = day(dateOnly(notice.deadline));
    // bezahlt bis zur Mahnung = Bruttobetrag minus damals offener Betrag
    const paidThen = invoice.totalGross.minus(notice.openAmount);
    const previous = invoice.dunningNotices.filter((n) => n.level < notice.level);

    const opening: Record<number, string> = {
      1: `sicher ist es im Alltag untergegangen: Für die folgende Rechnung konnten wir bis heute keinen Zahlungseingang feststellen. Bitte überweisen Sie den offenen Betrag bis zum ${deadline}.`,
      2: `leider konnten wir trotz unserer Zahlungserinnerung vom ${previous[0] ? day(dateOnly(previous[0].issuedOn)) : ''} noch keinen Zahlungseingang für die folgende Rechnung feststellen. Wir bitten Sie, den offenen Betrag bis spätestens ${deadline} zu überweisen.`,
      3: `trotz unserer Zahlungserinnerung und unserer Mahnung ist der folgende Betrag weiterhin offen. Bitte begleichen Sie ihn bis spätestens ${deadline}. Sollte bis dahin keine Zahlung eingehen, müssen wir weitere Schritte prüfen.`,
    };

    // Forderung neben der Rechnung: Gebühren bis einschließlich dieser Stufe,
    // Zinsen bis zum Mahndatum, Pauschale einmalig
    const upTo = invoice.dunningNotices.filter((n) => n.level <= notice.level);
    const fees = upTo.reduce((sum, n) => sum.plus(n.fee), new Prisma.Decimal(0));
    const lumpSum = upTo.reduce((sum, n) => sum.plus(n.lumpSum), new Prisma.Decimal(0));
    const extras = fees.plus(notice.interest).plus(lumpSum);
    const summary: [string, string][] = extras.greaterThan(0)
      ? [
          ['Offener Rechnungsbetrag', euro(notice.openAmount)],
          ...(fees.greaterThan(0) ? ([['Mahngebühren', euro(fees)]] as [string, string][]) : []),
          ...(notice.interest.greaterThan(0)
            ? ([
                [
                  `Verzugszinsen ${Number(notice.interestRate).toLocaleString('de-DE', { minimumFractionDigits: 2 })} % p. a. vom ${day(dateOnly(notice.interestFrom!))} bis ${day(dateOnly(notice.issuedOn))}`,
                  euro(notice.interest),
                ],
              ] as [string, string][])
            : []),
          ...(lumpSum.greaterThan(0)
            ? ([['Verzugspauschale (§ 288 Abs. 5 BGB)', euro(lumpSum)]] as [string, string][])
            : []),
          ['Zu zahlen', euro(notice.openAmount.plus(extras))],
        ]
      : [];

    const buffer = await renderLetterPdf({
      title,
      seller,
      buyer,
      meta: [
        ['Datum', day(dateOnly(notice.issuedOn))],
        ...(customer.debtorNumber
          ? ([['Kundennummer', String(customer.debtorNumber)]] as [string, string][])
          : []),
        ['Rechnung', invoice.number!],
        ['Zahlbar bis', deadline],
      ],
      paragraphs: ['Sehr geehrte Damen und Herren,', opening[notice.level]],
      table: {
        header: ['Rechnung', 'Rechnungsdatum', 'Fällig seit', 'Betrag', 'Bezahlt', 'Offen'],
        rows: [
          [
            invoice.number!,
            day(issueDay),
            day(dueDay),
            euro(invoice.totalGross),
            euro(paidThen),
            euro(notice.openAmount),
          ],
        ],
        widths: [22, 18, 16, 15, 14, 15],
      },
      summary,
      closing: [
        ...(iban
          ? [`Bankverbindung: IBAN ${iban}${bic ? ` · BIC ${bic}` : ''} · Verwendungszweck ${invoice.number}`]
          : []),
        'Sollte sich Ihre Zahlung mit diesem Schreiben überschnitten haben, betrachten Sie es bitte als gegenstandslos.',
        'Mit freundlichen Grüßen',
        seller.name,
      ],
    });
    const fileName = `${title.replace(/[^\wäöüÄÖÜß-]+/g, '-').replace(/^-+|-+$/g, '')}-${invoice.number}.pdf`;
    return { buffer, fileName, title };
  }

  async send(companyId: string, userId: string, invoiceId: string, noticeId: string, dto: SendDunningDto) {
    const { notice, invoice, company } = await this.load(companyId, invoiceId, noticeId);
    // Nur eine aktuelle Mahnung versenden: sonst ginge ein überholter Betrag
    // oder eine abgelaufene Frist an den Kunden
    if (invoice.status !== 'issued') {
      throw new BadRequestException('Die Rechnung ist storniert – die Mahnung wird nicht versendet.');
    }
    const open = invoice.totalGross.minus(paidAmount(invoice.payments));
    if (!open.greaterThan(0)) throw new BadRequestException('Die Rechnung ist bereits bezahlt.');
    if (invoice.dunningNotices.at(-1)?.id !== notice.id) {
      throw new BadRequestException(
        'Es gibt bereits eine höhere Mahnstufe – nur die neueste wird versendet.',
      );
    }
    if (!open.equals(notice.openAmount)) {
      throw new BadRequestException(
        `Seit dieser Mahnung ist eine Zahlung eingegangen (offen jetzt ${euro(open)}) – die Mahnung wird nicht versendet.`,
      );
    }
    const today = localDayString(new Date(), company.timeZone);
    if (dateOnly(notice.deadline) < today) {
      throw new BadRequestException(
        'Die Frist dieser Mahnung ist abgelaufen – bitte die nächste Mahnstufe erstellen.',
      );
    }
    const to = dto.to ?? invoice.project.property.customer.email;
    if (!to) {
      throw new BadRequestException(
        'Keine Empfängeradresse: beim Kunden ist keine E-Mail-Adresse hinterlegt.',
      );
    }
    this.mail.assertConfigured();
    const { buffer, fileName, title } = await this.renderPdf(companyId, invoiceId, noticeId);
    const text =
      dto.message ??
      [
        'Guten Tag,',
        '',
        `anbei erhalten Sie unsere ${title} zur Rechnung ${invoice.number}.`,
        'Sollte sich Ihre Zahlung damit überschnitten haben, betrachten Sie diese Nachricht bitte als gegenstandslos.',
        '',
        'Mit freundlichen Grüßen',
        company.name,
      ].join('\n');
    await this.mail.send({
      to,
      replyTo: company.email ?? undefined,
      subject: `${title} zu Rechnung ${invoice.number} – ${company.name}`,
      text,
      attachments: [{ filename: fileName, content: buffer, contentType: 'application/pdf' }],
    });
    const sentAt = new Date();
    await this.prisma.dunningNotice.updateMany({
      where: { id: noticeId, invoiceId, companyId },
      data: { sentAt, sentTo: to },
    });
    await writeAudit(this.prisma, {
      companyId,
      userId,
      action: 'dunning_send',
      entity: 'Invoice',
      entityId: invoiceId,
      newData: { to, title },
    });
    return { sent: true, to };
  }
}
