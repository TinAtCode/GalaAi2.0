import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { BusinessContract, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { writeAudit } from '../common/audit';
import { DEFAULT_TIME_ZONE, isValidDay, localDayString } from '../common/time-zone';
import { contractTerms, yearlyAmount } from './contract-terms';
import { BusinessContractDto } from './finance.dto';

interface Caller {
  companyId: string;
  userId: string;
}

const asDay = (day: string | null | undefined) => (day ? new Date(`${day}T00:00:00Z`) : null);
const dayOf = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
const trimmed = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;

// Versicherungen und Verträge: wann muss gekündigt sein, was kostet es im Jahr.
// Auf Wunsch läuft der Beitrag als Fixkosten mit (Vorschau, Jahresüberblick);
// die verknüpfte Fixkosten-Zeile folgt dem Vertrag (Betrag, Rhythmus, Ende).
@Injectable()
export class ContractsService {
  constructor(private prisma: PrismaService) {}

  private async today(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { timeZone: true },
    });
    return localDayString(new Date(), company?.timeZone || DEFAULT_TIME_ZONE);
  }

  private view(c: BusinessContract & { equipment?: { id: string; name: string } | null }, today: string) {
    const amount = c.amount?.toNumber() ?? null;
    const terms = contractTerms(
      {
        termEnd: dayOf(c.termEnd),
        renewalMonths: c.renewalMonths,
        noticeMonths: c.noticeMonths,
        cancelledOn: dayOf(c.cancelledOn),
      },
      today,
    );
    return {
      ...c,
      amount,
      startDate: dayOf(c.startDate),
      termEnd: dayOf(c.termEnd),
      cancelledOn: dayOf(c.cancelledOn),
      yearly: yearlyAmount(amount, c.interval),
      ...terms,
    };
  }

  async list(companyId: string) {
    const today = await this.today(companyId);
    const contracts = await this.prisma.businessContract.findMany({
      where: { companyId },
      orderBy: [{ termEnd: 'asc' }, { name: 'asc' }],
      include: { equipment: { select: { id: true, name: true } } },
    });
    const views = contracts.map((c) => this.view(c, today));
    // laufende Verträge nach Frist zuerst, beendete ans Ende
    const order = { notice_soon: 0, active: 1, open_ended: 2, cancelled: 3, expired: 4 } as const;
    views.sort(
      (a, b) =>
        order[a.state] - order[b.state] ||
        (a.noticeDeadline ?? '9999').localeCompare(b.noticeDeadline ?? '9999'),
    );
    const running = views.filter((v) => v.state !== 'expired');
    const byKind: Record<string, number> = {};
    for (const v of running) if (v.yearly) byKind[v.kind] = (byKind[v.kind] ?? 0) + v.yearly;
    return {
      today,
      contracts: views,
      summary: {
        yearlyTotal: Math.round(running.reduce((sum, v) => sum + (v.yearly ?? 0), 0) * 100) / 100,
        byKind,
        noticeSoon: views.filter((v) => v.state === 'notice_soon').length,
      },
    };
  }

  private async check(companyId: string, dto: BusinessContractDto) {
    for (const day of [dto.startDate, dto.termEnd, dto.cancelledOn, dto.firstDue])
      if (day && !isValidDay(day)) throw new BadRequestException('Ungültiges Datum.');
    if (dto.startDate && dto.termEnd && dto.termEnd < dto.startDate)
      throw new BadRequestException('Das Laufzeitende liegt vor dem Beginn.');
    if (dto.equipmentId) {
      const equipment = await this.prisma.equipment.findFirst({ where: { id: dto.equipmentId, companyId } });
      if (!equipment) throw new BadRequestException('Gerät nicht gefunden.');
    }
    if (dto.categoryId) {
      const category = await this.prisma.expenseCategory.findFirst({
        where: { id: dto.categoryId, companyId },
      });
      if (!category) throw new BadRequestException('Kategorie nicht gefunden.');
    }
    if (dto.asFixedCost && (!dto.amount || !dto.interval))
      throw new BadRequestException('Für die Fixkosten braucht der Vertrag Betrag und Rhythmus.');
  }

  private data(dto: BusinessContractDto) {
    return {
      name: dto.name.trim(),
      kind: dto.kind,
      provider: trimmed(dto.provider),
      contractNumber: trimmed(dto.contractNumber),
      amount: dto.amount === undefined ? undefined : dto.amount,
      interval: dto.interval === undefined ? undefined : dto.interval,
      startDate: dto.startDate === undefined ? undefined : asDay(dto.startDate),
      termEnd: dto.termEnd === undefined ? undefined : asDay(dto.termEnd),
      renewalMonths: dto.renewalMonths === undefined ? undefined : dto.renewalMonths,
      noticeMonths: dto.noticeMonths,
      cancelledOn: dto.cancelledOn === undefined ? undefined : asDay(dto.cancelledOn),
      equipmentId: dto.equipmentId === undefined ? undefined : dto.equipmentId || null,
      notes: trimmed(dto.notes),
    };
  }

  // Fixkosten-Zeile anlegen, angleichen oder entfernen
  private async syncFixedCost(
    tx: Prisma.TransactionClient,
    contract: BusinessContract,
    dto: BusinessContractDto,
    today: string,
  ) {
    const wanted = dto.asFixedCost ?? !!contract.recurringPaymentId;
    if (!wanted || !contract.amount || !contract.interval) {
      if (contract.recurringPaymentId) {
        await tx.businessContract.update({ where: { id: contract.id }, data: { recurringPaymentId: null } });
        await tx.recurringPayment.deleteMany({
          where: { id: contract.recurringPaymentId, companyId: contract.companyId },
        });
      }
      return;
    }
    const terms = contractTerms(
      {
        termEnd: dayOf(contract.termEnd),
        renewalMonths: contract.renewalMonths,
        noticeMonths: contract.noticeMonths,
        cancelledOn: dayOf(contract.cancelledOn),
      },
      today,
    );
    // gekündigt oder ohne Verlängerung: Fixkosten enden mit dem Vertrag
    const endDate = contract.cancelledOn || !contract.renewalMonths ? asDay(terms.endsOn) : null;
    const shared = {
      name: contract.name,
      counterpartyName: contract.provider,
      amount: contract.amount,
      interval: contract.interval,
      endDate,
      ...(dto.categoryId !== undefined ? { categoryId: dto.categoryId || null } : {}),
    };
    if (contract.recurringPaymentId) {
      await tx.recurringPayment.updateMany({
        where: { id: contract.recurringPaymentId, companyId: contract.companyId },
        data: { ...shared, ...(dto.firstDue ? { nextDue: asDay(dto.firstDue)! } : {}) },
      });
      return;
    }
    const recurring = await tx.recurringPayment.create({
      data: {
        ...shared,
        companyId: contract.companyId,
        nextDue: asDay(dto.firstDue ?? today)!,
      },
    });
    await tx.businessContract.update({
      where: { id: contract.id },
      data: { recurringPaymentId: recurring.id },
    });
  }

  async create(caller: Caller, dto: BusinessContractDto) {
    await this.check(caller.companyId, dto);
    const today = await this.today(caller.companyId);
    const id = await this.prisma.$transaction(async (tx) => {
      const contract = await tx.businessContract.create({
        data: { ...this.data(dto), noticeMonths: dto.noticeMonths ?? 3, companyId: caller.companyId },
      });
      await this.syncFixedCost(tx, contract, dto, today);
      await writeAudit(tx, {
        companyId: caller.companyId,
        userId: caller.userId,
        action: 'business_contract_created',
        entity: 'BusinessContract',
        entityId: contract.id,
        newData: { name: contract.name, kind: contract.kind, provider: contract.provider },
      });
      return contract.id;
    });
    return this.get(caller.companyId, id, today);
  }

  private async get(companyId: string, id: string, today: string) {
    const contract = await this.prisma.businessContract.findFirst({
      where: { id, companyId },
      include: { equipment: { select: { id: true, name: true } } },
    });
    if (!contract) throw new NotFoundException('Vertrag nicht gefunden.');
    return this.view(contract, today);
  }

  async update(caller: Caller, id: string, dto: BusinessContractDto) {
    const before = await this.prisma.businessContract.findFirst({
      where: { id, companyId: caller.companyId },
    });
    if (!before) throw new NotFoundException('Vertrag nicht gefunden.');
    await this.check(caller.companyId, dto);
    const today = await this.today(caller.companyId);
    await this.prisma.$transaction(async (tx) => {
      const contract = await tx.businessContract.update({ where: { id }, data: this.data(dto) });
      await this.syncFixedCost(tx, contract, dto, today);
      if (!before.cancelledOn && contract.cancelledOn)
        await writeAudit(tx, {
          companyId: caller.companyId,
          userId: caller.userId,
          action: 'business_contract_cancelled',
          entity: 'BusinessContract',
          entityId: id,
          newData: { name: contract.name, cancelledOn: dayOf(contract.cancelledOn) },
        });
    });
    return this.get(caller.companyId, id, today);
  }

  async remove(caller: Caller, id: string) {
    const contract = await this.prisma.businessContract.findFirst({
      where: { id, companyId: caller.companyId },
    });
    if (!contract) throw new NotFoundException('Vertrag nicht gefunden.');
    await this.prisma.$transaction(async (tx) => {
      await tx.businessContract.delete({ where: { id } });
      if (contract.recurringPaymentId)
        await tx.recurringPayment.deleteMany({
          where: { id: contract.recurringPaymentId, companyId: caller.companyId },
        });
      await writeAudit(tx, {
        companyId: caller.companyId,
        userId: caller.userId,
        action: 'business_contract_deleted',
        entity: 'BusinessContract',
        entityId: id,
        oldData: { name: contract.name, kind: contract.kind },
      });
    });
    return { deleted: true };
  }
}
