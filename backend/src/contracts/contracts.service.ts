import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { lockFor } from '../common/advisory-lock';
import { writeAudit } from '../common/audit';
import { addCalendarDays, localDayString, localTimeInZone } from '../common/time-zone';
import { absenceOn } from '../absences/absences.service';
import { resolveVatTreatment } from '../common/vat-treatment';
import { totals } from '../invoices/invoices.service';
import { CreateContractDto, ScheduleDto, UpdateContractDto } from './contract.dto';
import { dayOf, isBillingDue, nextBillingPeriod, taskOccurrences } from './contract-schedule';

const D = (n: Prisma.Decimal.Value) => new Prisma.Decimal(n);
const cents = (d: Prisma.Decimal) => d.toDecimalPlaces(2, Prisma.Decimal.ROUND_HALF_UP);
const dateOf = (day: string) => new Date(`${day}T00:00:00Z`);

const include = {
  lines: { orderBy: { position: 'asc' } },
  tasks: { orderBy: { title: 'asc' } },
  project: {
    select: {
      id: true,
      title: true,
      property: { select: { label: true, customer: { select: { name: true } } } },
    },
  },
  invoices: { select: { status: true, kind: true, servicePeriodEnd: true } },
} satisfies Prisma.MaintenanceContractInclude;

type ContractWithRelations = Prisma.MaintenanceContractGetPayload<{ include: typeof include }>;

// Zuletzt abgerechnete Zeiträume: Rechnungen des Vertrags ohne Stornos und
// ohne stornierte (ein Storno gibt den Zeitraum wieder frei)
const billedEnds = (invoices: { status: string; kind: string; servicePeriodEnd: Date | null }[]) =>
  invoices
    .filter((i) => i.kind === 'periodic' && i.status !== 'cancelled' && i.servicePeriodEnd)
    .map((i) => dayOf(i.servicePeriodEnd!));

// Pflege- und Wartungsverträge: Einsätze als Termine planen, feste Vergütung
// je Zeitraum als Rechnungsentwurf. Sperren je Vertrag verhindern doppelte
// Termine oder Rechnungen bei gleichzeitigen Anfragen.
@Injectable()
export class ContractsService {
  constructor(private prisma: PrismaService) {}

  private async today(companyId: string) {
    const company = await this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
    return { company, today: localDayString(new Date(), company.timeZone) };
  }

  // Vertrag mit nächstem Abrechnungszeitraum und Summe je Zeitraum
  private present(contract: ContractWithRelations, today: string) {
    const { invoices, ...rest } = contract;
    const period = nextBillingPeriod(
      {
        startDate: dayOf(contract.startDate),
        endDate: contract.endDate ? dayOf(contract.endDate) : null,
        billingInterval: contract.billingInterval,
      },
      billedEnds(invoices),
    );
    const netPerPeriod = contract.lines.reduce(
      (sum, l) => sum.plus(cents(l.quantity.times(l.unitPrice))),
      D(0),
    );
    return {
      ...rest,
      netPerPeriod,
      nextPeriod: period,
      billingDue:
        contract.status === 'active' && !!period && isBillingDue(period, contract.billInAdvance, today),
      tasksDue: contract.status === 'active' && contract.tasks.some((t) => dayOf(t.nextDue) <= today),
    };
  }

  async findAll(companyId: string, projectId?: string) {
    const { today } = await this.today(companyId);
    const contracts = await this.prisma.maintenanceContract.findMany({
      where: { companyId, ...(projectId ? { projectId } : {}) },
      include,
      orderBy: [{ status: 'asc' }, { title: 'asc' }],
    });
    return contracts.map((c) => this.present(c, today));
  }

  async findOne(companyId: string, id: string) {
    const contract = await this.prisma.maintenanceContract.findFirst({ where: { id, companyId }, include });
    if (!contract) throw new NotFoundException('Vertrag nicht gefunden.');
    const { today } = await this.today(companyId);
    return this.present(contract, today);
  }

  private async validate(companyId: string, dto: CreateContractDto) {
    if (dto.endDate && dto.endDate < dto.startDate) {
      throw new BadRequestException('Das Vertragsende liegt vor dem Beginn.');
    }
    const userIds = [...new Set(dto.tasks.map((t) => t.assignedUserId).filter((id): id is string => !!id))];
    if (userIds.length) {
      const found = await this.prisma.user.count({ where: { companyId, id: { in: userIds } } });
      if (found !== userIds.length) throw new BadRequestException('Mitarbeiter nicht gefunden.');
    }
  }

  private taskData(companyId: string, task: CreateContractDto['tasks'][number]) {
    return {
      companyId,
      title: task.title,
      everyWeeks: task.everyWeeks,
      seasonFrom: task.seasonFrom ?? 1,
      seasonTo: task.seasonTo ?? 12,
      startMinutes: task.startMinutes ?? 480,
      durationMinutes: task.durationMinutes ?? 120,
      assignedUserId: task.assignedUserId || null,
      nextDue: dateOf(task.nextDue),
    };
  }

  private linesData(dto: CreateContractDto) {
    return dto.lines.map((l, index) => ({
      position: index + 1,
      description: l.description,
      unit: l.unit,
      quantity: D(l.quantity),
      unitPrice: D(l.unitPrice),
    }));
  }

  private vat(company: { smallBusiness: boolean; defaultVatRate: Prisma.Decimal }, dto: CreateContractDto) {
    const vatTreatment = resolveVatTreatment(company.smallBusiness, dto.vatTreatment);
    return {
      vatTreatment,
      vatRate: D(vatTreatment === 'standard' ? (dto.vatRate ?? company.defaultVatRate) : 0),
    };
  }

  async create(companyId: string, userId: string, dto: CreateContractDto) {
    const project = await this.prisma.project.findFirst({ where: { id: dto.projectId, companyId } });
    if (!project) throw new NotFoundException('Projekt nicht gefunden.');
    await this.validate(companyId, dto);
    const { company } = await this.today(companyId);
    const contract = await this.prisma.$transaction(async (tx) => {
      const created = await tx.maintenanceContract.create({
        data: {
          companyId,
          projectId: project.id,
          title: dto.title,
          startDate: dateOf(dto.startDate),
          endDate: dto.endDate ? dateOf(dto.endDate) : null,
          billingInterval: dto.billingInterval,
          billInAdvance: dto.billInAdvance ?? true,
          ...this.vat(company, dto),
          notes: dto.notes || null,
          lines: { create: this.linesData(dto) },
          tasks: { create: dto.tasks.map((t) => this.taskData(companyId, t)) },
        },
      });
      await writeAudit(tx, {
        companyId,
        userId,
        action: 'contract.create',
        entity: 'MaintenanceContract',
        entityId: created.id,
        newData: { title: dto.title, billingInterval: dto.billingInterval },
      });
      return created;
    });
    return this.findOne(companyId, contract.id);
  }

  // Positionen werden ersetzt; Einsätze mit id bleiben erhalten (samt ihren
  // Terminen), fehlende werden entfernt, neue angelegt. Pausieren oder
  // Beenden sagt die noch geplanten künftigen Termine ab.
  async update(companyId: string, userId: string, id: string, dto: UpdateContractDto) {
    const existing = await this.prisma.maintenanceContract.findFirst({
      where: { id, companyId },
      include: { tasks: true },
    });
    if (!existing) throw new NotFoundException('Vertrag nicht gefunden.');
    await this.validate(companyId, dto);
    const known = new Set(existing.tasks.map((t) => t.id));
    if (dto.tasks.some((t) => t.id && !known.has(t.id))) {
      throw new BadRequestException('Einsatz gehört nicht zu diesem Vertrag.');
    }
    const { company } = await this.today(companyId);
    await this.prisma.$transaction(async (tx) => {
      await lockFor(tx, 'contract', id);
      const keep = dto.tasks.filter((t) => t.id).map((t) => t.id!);
      await tx.contractTask.deleteMany({ where: { companyId, contractId: id, id: { notIn: keep } } });
      for (const task of dto.tasks) {
        if (task.id)
          await tx.contractTask.update({ where: { id: task.id }, data: this.taskData(companyId, task) });
        else await tx.contractTask.create({ data: { ...this.taskData(companyId, task), contractId: id } });
      }
      await tx.contractLine.deleteMany({ where: { contractId: id } });
      const status = dto.status ?? existing.status;
      await tx.maintenanceContract.update({
        where: { id },
        data: {
          title: dto.title,
          status,
          startDate: dateOf(dto.startDate),
          endDate: dto.endDate ? dateOf(dto.endDate) : null,
          billingInterval: dto.billingInterval,
          billInAdvance: dto.billInAdvance ?? existing.billInAdvance,
          ...this.vat(company, dto),
          notes: dto.notes || null,
          lines: { create: this.linesData(dto) },
        },
      });
      if (status !== 'active') await this.cancelFutureAppointments(tx, companyId, id);
      if (status !== existing.status) {
        await writeAudit(tx, {
          companyId,
          userId,
          action: 'contract.status',
          entity: 'MaintenanceContract',
          entityId: id,
          oldData: { status: existing.status },
          newData: { status },
        });
      }
    });
    return this.findOne(companyId, id);
  }

  private async cancelFutureAppointments(
    tx: Prisma.TransactionClient,
    companyId: string,
    contractId: string,
  ) {
    await tx.appointment.updateMany({
      where: { companyId, status: 'planned', startTime: { gt: new Date() }, contractTask: { contractId } },
      data: { status: 'cancelled' },
    });
  }

  // Löschen nur ohne Rechnungen – sonst beenden
  async remove(companyId: string, userId: string, id: string) {
    const contract = await this.prisma.maintenanceContract.findFirst({
      where: { id, companyId },
      include: { _count: { select: { invoices: true } } },
    });
    if (!contract) throw new NotFoundException('Vertrag nicht gefunden.');
    if (contract._count.invoices > 0) {
      throw new BadRequestException(
        'Der Vertrag hat Rechnungen und kann nur beendet werden, nicht gelöscht.',
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await this.cancelFutureAppointments(tx, companyId, id);
      await tx.maintenanceContract.delete({ where: { id } });
      await writeAudit(tx, {
        companyId,
        userId,
        action: 'contract.delete',
        entity: 'MaintenanceContract',
        entityId: id,
        oldData: { title: contract.title },
      });
    });
    return { removed: true };
  }

  // Fällige Einsätze aktiver Verträge bis `until` als Termine anlegen. Der
  // Rhythmus läuft über nextDue weiter, ein zweiter Aufruf legt nichts doppelt
  // an. Hat der zugeteilte Mitarbeiter schon einen Termin zur selben Zeit,
  // bleibt der neue Termin ohne Mitarbeiter.
  async schedule(companyId: string, dto: ScheduleDto) {
    const { company, today } = await this.today(companyId);
    if (dto.until > addCalendarDays(today, 366)) {
      throw new BadRequestException('Termine lassen sich höchstens ein Jahr im Voraus planen.');
    }
    const contracts = await this.prisma.maintenanceContract.findMany({
      where: { companyId, status: 'active', ...(dto.contractId ? { id: dto.contractId } : {}) },
      select: { id: true },
    });
    if (dto.contractId && !contracts.length) {
      throw new BadRequestException('Nur aktive Verträge lassen sich planen.');
    }
    let created = 0;
    let unassigned = 0;
    for (const { id } of contracts) {
      await this.prisma.$transaction(async (tx) => {
        await lockFor(tx, 'contract', id);
        const contract = await tx.maintenanceContract.findUniqueOrThrow({
          where: { id },
          include: { tasks: true },
        });
        if (contract.status !== 'active') return;
        const start = dayOf(contract.startDate);
        for (const task of contract.tasks) {
          const from = dayOf(task.nextDue) < start ? start : dayOf(task.nextDue);
          const { days, nextDue } = taskOccurrences(
            { ...task, nextDue: from },
            dto.until,
            contract.endDate ? dayOf(contract.endDate) : null,
          );
          for (const day of days) {
            const startTime = localTimeInZone(day, task.startMinutes, company.timeZone);
            const endTime = new Date(startTime.getTime() + task.durationMinutes * 60_000);
            let assignedUserId = task.assignedUserId;
            if (assignedUserId) {
              await lockFor(tx, 'appointment', assignedUserId);
              const sameDay = await tx.appointment.findMany({
                where: {
                  companyId,
                  assignedUserId,
                  status: { not: 'cancelled' },
                  startTime: { lt: endTime, gte: new Date(startTime.getTime() - 24 * 3_600_000) },
                },
                select: { startTime: true, endTime: true },
              });
              // anderer Termin zur selben Zeit oder abwesend (Urlaub, Krankheit): offen lassen
              const clash =
                sameDay.some((a) => (a.endTime ?? new Date(a.startTime.getTime() + 3_600_000)) > startTime) ||
                Boolean(await absenceOn(tx, companyId, assignedUserId, day));
              if (clash) {
                assignedUserId = null;
                unassigned++;
              }
            }
            await tx.appointment.create({
              data: {
                companyId,
                projectId: contract.projectId,
                title: task.title,
                startTime,
                endTime,
                assignedUserId,
                contractTaskId: task.id,
                notes: `Pflegevertrag: ${contract.title}`,
              },
            });
            created++;
          }
          await tx.contractTask.update({ where: { id: task.id }, data: { nextDue: dateOf(nextDue) } });
        }
      });
    }
    return { created, unassigned };
  }

  // Rechnungsentwurf für den nächsten Zeitraum; `onlyDue` = nur, wenn fällig
  private async invoiceNext(companyId: string, contractId: string, today: string, onlyDue: boolean) {
    return this.prisma.$transaction(async (tx) => {
      await lockFor(tx, 'invoice-order', contractId);
      const contract = await tx.maintenanceContract.findUniqueOrThrow({
        where: { id: contractId },
        include: { lines: { orderBy: { position: 'asc' } }, invoices: true },
      });
      if (contract.status !== 'active') {
        throw new BadRequestException('Nur aktive Verträge werden abgerechnet.');
      }
      if (!contract.lines.length) throw new BadRequestException('Der Vertrag hat keine Positionen.');
      const period = nextBillingPeriod(
        {
          startDate: dayOf(contract.startDate),
          endDate: contract.endDate ? dayOf(contract.endDate) : null,
          billingInterval: contract.billingInterval,
        },
        billedEnds(contract.invoices),
      );
      if (!period) throw new BadRequestException('Der Vertrag ist bis zu seinem Ende abgerechnet.');
      if (onlyDue && !isBillingDue(period, contract.billInAdvance, today)) return null;
      // letzter, gekürzter Zeitraum: Preis anteilig nach Tagen (auf Cent gerundet)
      const share = period.share;
      const lines = contract.lines.map((l) => {
        const unitPrice = share ? cents(l.unitPrice.times(share.days).dividedBy(share.of)) : l.unitPrice;
        return {
          description: share
            ? `${l.description} (anteilig ${share.days} von ${share.of} Tagen)`
            : l.description,
          unit: l.unit,
          quantity: l.quantity,
          unitPrice,
          lineTotal: cents(l.quantity.times(unitPrice)),
        };
      });
      return tx.invoice.create({
        data: {
          companyId,
          projectId: contract.projectId,
          contractId: contract.id,
          kind: 'periodic',
          vatRate: contract.vatRate,
          vatTreatment: contract.vatTreatment,
          ...totals(lines, contract.vatRate),
          servicePeriodStart: dateOf(period.start),
          servicePeriodEnd: dateOf(period.end),
          lineItems: { create: lines.map((l, index) => ({ ...l, position: index + 1 })) },
        },
        include: { lineItems: { orderBy: { position: 'asc' } } },
      });
    });
  }

  // Nächsten Zeitraum abrechnen, auch vor der Fälligkeit
  async createInvoice(companyId: string, contractId: string) {
    const contract = await this.prisma.maintenanceContract.findFirst({
      where: { id: contractId, companyId },
    });
    if (!contract) throw new NotFoundException('Vertrag nicht gefunden.');
    const { today } = await this.today(companyId);
    return (await this.invoiceNext(companyId, contractId, today, false))!;
  }

  // Alle fälligen Zeiträume aller aktiven Verträge als Entwürfe (je Vertrag
  // höchstens 24 auf einmal, falls lange nicht abgerechnet wurde)
  async invoiceDue(companyId: string) {
    const { today } = await this.today(companyId);
    const contracts = await this.prisma.maintenanceContract.findMany({
      where: { companyId, status: 'active' },
      select: { id: true, _count: { select: { lines: true } } },
    });
    const invoices: { id: string; contractId: string | null }[] = [];
    for (const contract of contracts) {
      if (!contract._count.lines) continue;
      for (let i = 0; i < 24; i++) {
        const invoice = await this.invoiceNext(companyId, contract.id, today, true).catch((err) => {
          if (err instanceof BadRequestException) return null;
          throw err;
        });
        if (!invoice) break;
        invoices.push({ id: invoice.id, contractId: invoice.contractId });
      }
    }
    return { created: invoices.length, invoices };
  }
}
