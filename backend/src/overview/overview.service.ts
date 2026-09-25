import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSIONS } from '../common/permissions';
import { addCalendarDays, localDayString } from '../common/time-zone';

export interface Todo {
  key: string;
  label: string;
  count: number;
  to: string;
  // Hinweis unter der Zahl, z.B. „davon 2 überfällig“
  meta?: string;
  // bis zu drei direkte Sprungziele (z.B. die Projekte der Angebote)
  examples?: { label: string; to: string }[];
}

const day = (value: string) => new Date(`${value}T00:00:00Z`);

// „Zu erledigen“ auf Mein Tag: was im Büro ansteht, je nach Rechten. Nur
// Zählungen und wenige Beispiele – die Arbeit selbst passiert auf den Seiten.
@Injectable()
export class OverviewService {
  constructor(private prisma: PrismaService) {}

  async todos(companyId: string, permissions: string[]): Promise<Todo[]> {
    const can = (p: string) => permissions.includes(p);
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { timeZone: true },
    });
    const today = localDayString(new Date(), company.timeZone);
    const tasks: Promise<Todo | null>[] = [];

    if (can(PERMISSIONS.DOCUMENT_READ))
      tasks.push(
        this.prisma.deliveryNote.count({ where: { companyId, status: 'open' } }).then((count) => ({
          key: 'delivery_notes',
          label: 'Lieferscheine zuordnen',
          count,
          to: '/lieferscheine',
        })),
      );

    if (can(PERMISSIONS.CHECKLIST_MANAGE))
      tasks.push(
        this.prisma.checklistTemplate.count({ where: { companyId, status: 'proposed' } }).then((count) => ({
          key: 'checklist_proposals',
          label: 'Checklisten-Vorschläge prüfen',
          count,
          to: '/checklisten',
        })),
      );

    if (can(PERMISSIONS.MASTERDATA_WRITE)) {
      tasks.push(
        this.prisma.equipmentDamage
          .findMany({
            where: { companyId, status: { in: ['open', 'in_repair'] } },
            select: { equipment: { select: { id: true, name: true } } },
            orderBy: { createdAt: 'asc' },
          })
          .then((damages) => ({
            key: 'damages',
            label: 'Schäden an Geräten',
            count: damages.length,
            to: '/geraete',
            examples: [...new Map(damages.map((d) => [d.equipment.id, d.equipment])).values()]
              .slice(0, 3)
              .map((e) => ({ label: e.name, to: `/geraete/${e.id}` })),
          })),
      );
      tasks.push(
        this.prisma.equipmentMaintenance
          .findMany({
            where: {
              companyId,
              active: true,
              nextDue: { lte: day(addCalendarDays(today, 14)) },
              equipment: { retired: false },
            },
            select: { nextDue: true, equipment: { select: { id: true, name: true } } },
            orderBy: { nextDue: 'asc' },
          })
          .then((due) => {
            const overdue = due.filter((m) => m.nextDue < day(today)).length;
            return {
              key: 'maintenance',
              label: 'Wartung fällig (14 Tage)',
              count: due.length,
              to: '/geraete',
              ...(overdue ? { meta: `davon ${overdue} überfällig` } : {}),
              examples: due
                .slice(0, 3)
                .map((m) => ({ label: m.equipment.name, to: `/geraete/${m.equipment.id}` })),
            };
          }),
      );
    }

    const quoteList = (status: 'draft' | 'sent', key: string, label: string) =>
      this.prisma.quote
        .findMany({
          where: { companyId, status },
          select: { number: true, project: { select: { id: true, title: true } } },
          orderBy: { createdAt: 'asc' },
        })
        .then((quotes) => ({
          key,
          label,
          count: quotes.length,
          to: '/projekte',
          examples: quotes.slice(0, 3).map((q) => ({
            label: `${q.number ?? 'Angebot'} · ${q.project.title}`,
            to: `/projekte/${q.project.id}#angebote`,
          })),
        }));
    if (can(PERMISSIONS.QUOTE_APPROVE)) tasks.push(quoteList('draft', 'quotes_draft', 'Angebote freigeben'));
    if (can(PERMISSIONS.QUOTE_CREATE)) tasks.push(quoteList('sent', 'quotes_sent', 'Angebote ohne Antwort'));

    if (can(PERMISSIONS.EMPLOYEE_DATA_READ))
      tasks.push(
        this.prisma.timeEntry.count({ where: { companyId, status: 'completed' } }).then((count) => ({
          key: 'time_entries',
          label: 'Zeiten freigeben',
          count,
          to: '/team',
        })),
      );

    if (can(PERMISSIONS.FINANCE_READ))
      tasks.push(
        this.prisma.incomingInvoice
          .findMany({
            where: {
              companyId,
              status: 'open',
              OR: [{ dueDate: null }, { dueDate: { lte: day(addCalendarDays(today, 7)) } }],
            },
            select: { dueDate: true },
          })
          .then((open) => {
            const overdue = open.filter((i) => i.dueDate && i.dueDate < day(today)).length;
            return {
              key: 'payables',
              label: 'Eingangsrechnungen bezahlen (7 Tage)',
              count: open.length,
              to: '/finanzen?tab=payables',
              ...(overdue ? { meta: `davon ${overdue} überfällig` } : {}),
            };
          }),
      );

    // bestätigte Lieferscheine, zu denen nach 30 Tagen noch keine Rechnung
    // zugeordnet ist (fehlende oder übersehene Lieferantenrechnung)
    if (can(PERMISSIONS.FINANCE_READ))
      tasks.push(
        this.prisma.deliveryNote
          .count({
            where: {
              companyId,
              status: 'confirmed',
              incomingInvoiceId: null,
              confirmedAt: { lte: day(addCalendarDays(today, -30)) },
            },
          })
          .then((count) => ({
            key: 'unbilled_delivery_notes',
            label: 'Lieferscheine ohne Rechnung (über 30 Tage)',
            count,
            to: '/lieferscheine',
          })),
      );

    // nur, was wirklich ansteht
    return (await Promise.all(tasks)).filter((t): t is Todo => !!t && t.count > 0);
  }

  // Schnellsuche nach Belegnummern: Angebot A-…, Rechnung R-… → Projekt
  async searchNumbers(companyId: string, permissions: string[], q: string) {
    const term = q.trim();
    if (term.length < 3) return [];
    const can = (p: string) => permissions.includes(p);
    const contains = { contains: term, mode: 'insensitive' as const };
    const [quotes, invoices] = await Promise.all([
      can(PERMISSIONS.CUSTOMER_READ)
        ? this.prisma.quote.findMany({
            where: { companyId, number: contains },
            select: { number: true, project: { select: { id: true, title: true } } },
            orderBy: { createdAt: 'desc' },
            take: 5,
          })
        : [],
      can(PERMISSIONS.INVOICE_CREATE)
        ? this.prisma.invoice.findMany({
            where: { companyId, number: contains },
            select: { number: true, project: { select: { id: true, title: true } } },
            orderBy: { createdAt: 'desc' },
            take: 5,
          })
        : [],
    ]);
    return [
      ...quotes.map((q) => ({
        label: q.number!,
        meta: `Angebot · ${q.project.title}`,
        to: `/projekte/${q.project.id}#angebote`,
      })),
      ...invoices.map((i) => ({
        label: i.number!,
        meta: `Rechnung · ${i.project.title}`,
        to: `/projekte/${i.project.id}#rechnungen`,
      })),
    ];
  }
}
