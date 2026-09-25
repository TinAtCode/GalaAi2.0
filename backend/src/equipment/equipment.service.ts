import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DamageSeverity, EquipmentStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { lockFor } from '../common/advisory-lock';
import { changedFields, writeAudit } from '../common/audit';
import { addCalendarDays, DEFAULT_TIME_ZONE, isValidDay, localDayString } from '../common/time-zone';
import {
  CountItemDto,
  DueQueryDto,
  EquipmentDto,
  InventoryCountDto,
  MaintenanceDoneDto,
  MaintenanceDto,
  ReportDamageDto,
  UpdateDamageDto,
} from './equipment.dto';

interface Caller {
  companyId: string;
  userId: string;
}

const asDay = (day: string) => new Date(`${day}T00:00:00Z`);
const dayOf = (date: Date | null) => (date ? date.toISOString().slice(0, 10) : null);
const trimmed = (value: string | null | undefined) =>
  value === undefined ? undefined : value?.trim() || null;

// Kalendertag plus n Monate; am Monatsende wird gekappt (31.01. + 1 → 28./29.02.)
export function addMonths(day: string, months: number): string {
  const [y, m, d] = day.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(d, last))).toISOString().slice(0, 10);
}

// Zustand aus dem schlimmsten offenen Schaden
export function statusFromDamages(severities: DamageSeverity[]): EquipmentStatus {
  if (severities.includes('unusable')) return 'broken';
  if (severities.includes('limited')) return 'limited';
  return 'ready';
}

// Geräte und Fahrzeuge: Stammdaten, Schadensmeldungen von der Baustelle,
// Wartungen/Prüfungen mit Fälligkeit und Inventur-Durchgänge.
@Injectable()
export class EquipmentService {
  constructor(private prisma: PrismaService) {}

  private async today(companyId: string) {
    const company = await this.prisma.company.findUnique({
      where: { id: companyId },
      select: { timeZone: true },
    });
    return localDayString(new Date(), company?.timeZone || DEFAULT_TIME_ZONE);
  }

  private async equipmentOf(companyId: string, id: string) {
    const equipment = await this.prisma.equipment.findFirst({ where: { id, companyId } });
    if (!equipment) throw new NotFoundException('Gerät nicht gefunden.');
    return equipment;
  }

  private async recomputeStatus(tx: Prisma.TransactionClient, companyId: string, equipmentId: string) {
    const open = await tx.equipmentDamage.findMany({
      where: { companyId, equipmentId, status: { not: 'fixed' } },
      select: { severity: true },
    });
    const status = statusFromDamages(open.map((d) => d.severity));
    await tx.equipment.update({ where: { id: equipmentId }, data: { status } });
    return status;
  }

  // ── Geräte ────────────────────────────────────

  async list(companyId: string) {
    const [equipment, openDamages, maintenance] = await Promise.all([
      this.prisma.equipment.findMany({
        where: { companyId },
        orderBy: [{ retired: 'asc' }, { name: 'asc' }],
        include: { machine: { select: { id: true, name: true } } },
      }),
      this.prisma.equipmentDamage.groupBy({
        by: ['equipmentId'],
        where: { companyId, status: { not: 'fixed' } },
        _count: true,
      }),
      this.prisma.equipmentMaintenance.findMany({
        where: { companyId, active: true },
        orderBy: { nextDue: 'asc' },
        select: { equipmentId: true, title: true, nextDue: true },
      }),
    ]);
    const damages = new Map(openDamages.map((d) => [d.equipmentId, d._count]));
    const next = new Map<string, { title: string; due: string }>();
    for (const m of maintenance)
      if (!next.has(m.equipmentId)) next.set(m.equipmentId, { title: m.title, due: dayOf(m.nextDue)! });
    return equipment.map((e) => ({
      ...e,
      openDamages: damages.get(e.id) ?? 0,
      nextMaintenance: next.get(e.id) ?? null,
    }));
  }

  async get(companyId: string, id: string) {
    const equipment = await this.prisma.equipment.findFirst({
      where: { id, companyId },
      include: {
        machine: { select: { id: true, name: true } },
        damages: { orderBy: { createdAt: 'desc' }, take: 50 },
        maintenance: {
          orderBy: [{ active: 'desc' }, { nextDue: 'asc' }],
          include: { logs: { orderBy: { doneOn: 'desc' }, take: 5 } },
        },
      },
    });
    if (!equipment) throw new NotFoundException('Gerät nicht gefunden.');
    return {
      ...equipment,
      damages: equipment.damages.map((d) => ({ ...d, repairCost: d.repairCost?.toNumber() ?? null })),
      maintenance: equipment.maintenance.map((m) => ({
        ...m,
        nextDue: dayOf(m.nextDue),
        lastDone: dayOf(m.lastDone),
        logs: m.logs.map((l) => ({ ...l, doneOn: dayOf(l.doneOn), cost: l.cost?.toNumber() ?? null })),
      })),
    };
  }

  private fields(dto: EquipmentDto) {
    return {
      name: dto.name.trim(),
      kind: dto.kind,
      inventoryNumber: trimmed(dto.inventoryNumber),
      licensePlate: trimmed(dto.licensePlate)?.toUpperCase(),
      serialNumber: trimmed(dto.serialNumber),
      location: trimmed(dto.location),
      machineId: dto.machineId === undefined ? undefined : dto.machineId || null,
      notes: trimmed(dto.notes),
      retired: dto.retired,
    };
  }

  private async assertMachine(companyId: string, machineId?: string | null) {
    if (!machineId) return;
    const machine = await this.prisma.machine.findFirst({ where: { id: machineId, companyId } });
    if (!machine) throw new BadRequestException('Maschine nicht gefunden.');
  }

  private uniqueInventoryNumber(err: unknown): never {
    if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002')
      throw new ConflictException('Diese Inventarnummer ist schon vergeben.');
    throw err;
  }

  async create(caller: Caller, dto: EquipmentDto) {
    await this.assertMachine(caller.companyId, dto.machineId);
    const data = this.fields(dto);
    return this.prisma
      .$transaction(async (tx) => {
        const equipment = await tx.equipment.create({
          data: { ...data, retired: data.retired ?? false, companyId: caller.companyId },
        });
        await writeAudit(tx, {
          companyId: caller.companyId,
          userId: caller.userId,
          action: 'equipment_created',
          entity: 'Equipment',
          entityId: equipment.id,
          newData: { name: equipment.name, kind: equipment.kind, inventoryNumber: equipment.inventoryNumber },
        });
        return equipment;
      })
      .catch((err) => this.uniqueInventoryNumber(err));
  }

  async update(caller: Caller, id: string, dto: EquipmentDto) {
    const before = await this.equipmentOf(caller.companyId, id);
    await this.assertMachine(caller.companyId, dto.machineId);
    const data = this.fields(dto);
    const { oldData, newData, hasChanges } = changedFields(before, data);
    if (!hasChanges) return before;
    return this.prisma
      .$transaction(async (tx) => {
        const equipment = await tx.equipment.update({ where: { id }, data });
        await writeAudit(tx, {
          companyId: caller.companyId,
          userId: caller.userId,
          action: 'equipment_changed',
          entity: 'Equipment',
          entityId: id,
          oldData,
          newData,
        });
        return equipment;
      })
      .catch((err) => this.uniqueInventoryNumber(err));
  }

  // ── Schäden ───────────────────────────────────

  async reportDamage(caller: Caller, equipmentId: string, dto: ReportDamageDto) {
    const equipment = await this.equipmentOf(caller.companyId, equipmentId);
    if (equipment.retired) throw new BadRequestException('Das Gerät ist ausgemustert.');
    if (dto.projectId) {
      const project = await this.prisma.project.findFirst({
        where: { id: dto.projectId, companyId: caller.companyId },
      });
      if (!project) throw new BadRequestException('Projekt nicht gefunden.');
    }
    return this.prisma.$transaction(async (tx) => {
      await lockFor(tx, 'equipment', equipmentId);
      const damage = await tx.equipmentDamage.create({
        data: {
          companyId: caller.companyId,
          equipmentId,
          projectId: dto.projectId || null,
          reportedByUserId: caller.userId,
          description: dto.description.trim(),
          severity: dto.severity,
        },
      });
      const status = await this.recomputeStatus(tx, caller.companyId, equipmentId);
      await writeAudit(tx, {
        companyId: caller.companyId,
        userId: caller.userId,
        action: 'equipment_damage_reported',
        entity: 'EquipmentDamage',
        entityId: damage.id,
        newData: { equipment: equipment.name, severity: dto.severity, description: damage.description },
      });
      return { ...damage, repairCost: null, equipmentStatus: status };
    });
  }

  async openDamages(companyId: string) {
    const damages = await this.prisma.equipmentDamage.findMany({
      where: { companyId, status: { not: 'fixed' } },
      orderBy: { createdAt: 'desc' },
      include: { equipment: { select: { id: true, name: true, kind: true } } },
    });
    return damages.map((d) => ({ ...d, repairCost: d.repairCost?.toNumber() ?? null }));
  }

  async updateDamage(caller: Caller, id: string, dto: UpdateDamageDto) {
    const before = await this.prisma.equipmentDamage.findFirst({
      where: { id, companyId: caller.companyId },
    });
    if (!before) throw new NotFoundException('Schadensmeldung nicht gefunden.');
    const fixed = dto.status === 'fixed';
    const data = {
      status: dto.status,
      resolutionNote: trimmed(dto.resolutionNote),
      repairCost: dto.repairCost === undefined ? undefined : dto.repairCost,
      resolvedAt: fixed ? (before.resolvedAt ?? new Date()) : null,
      resolvedByUserId: fixed ? (before.resolvedByUserId ?? caller.userId) : null,
    };
    const { oldData, newData } = changedFields(before, {
      status: data.status,
      resolutionNote: data.resolutionNote,
      repairCost: data.repairCost,
    });
    return this.prisma.$transaction(async (tx) => {
      await lockFor(tx, 'equipment', before.equipmentId);
      const damage = await tx.equipmentDamage.update({ where: { id }, data });
      const status = await this.recomputeStatus(tx, caller.companyId, before.equipmentId);
      await writeAudit(tx, {
        companyId: caller.companyId,
        userId: caller.userId,
        action: 'equipment_damage_changed',
        entity: 'EquipmentDamage',
        entityId: id,
        oldData,
        newData,
      });
      return { ...damage, repairCost: damage.repairCost?.toNumber() ?? null, equipmentStatus: status };
    });
  }

  // ── Wartung ───────────────────────────────────

  async addMaintenance(caller: Caller, equipmentId: string, dto: MaintenanceDto) {
    await this.equipmentOf(caller.companyId, equipmentId);
    if (!isValidDay(dto.nextDue)) throw new BadRequestException('Ungültiges Datum.');
    const maintenance = await this.prisma.equipmentMaintenance.create({
      data: {
        companyId: caller.companyId,
        equipmentId,
        title: dto.title.trim(),
        intervalMonths: dto.intervalMonths ?? null,
        nextDue: asDay(dto.nextDue),
        notes: trimmed(dto.notes),
        active: dto.active ?? true,
      },
    });
    return { ...maintenance, nextDue: dto.nextDue, lastDone: null };
  }

  private async maintenanceOf(companyId: string, id: string) {
    const maintenance = await this.prisma.equipmentMaintenance.findFirst({ where: { id, companyId } });
    if (!maintenance) throw new NotFoundException('Wartung nicht gefunden.');
    return maintenance;
  }

  async updateMaintenance(caller: Caller, id: string, dto: MaintenanceDto) {
    await this.maintenanceOf(caller.companyId, id);
    if (!isValidDay(dto.nextDue)) throw new BadRequestException('Ungültiges Datum.');
    const maintenance = await this.prisma.equipmentMaintenance.update({
      where: { id },
      data: {
        title: dto.title.trim(),
        intervalMonths: dto.intervalMonths ?? null,
        nextDue: asDay(dto.nextDue),
        notes: trimmed(dto.notes),
        active: dto.active,
      },
    });
    return { ...maintenance, nextDue: dayOf(maintenance.nextDue), lastDone: dayOf(maintenance.lastDone) };
  }

  // Erledigt: Protokoll schreiben, nächste Fälligkeit um das Intervall weiter;
  // ohne Intervall (einmalige Prüfung) ist die Wartung danach abgeschlossen
  async maintenanceDone(caller: Caller, id: string, dto: MaintenanceDoneDto) {
    if (!isValidDay(dto.doneOn)) throw new BadRequestException('Ungültiges Datum.');
    if (dto.doneOn > (await this.today(caller.companyId)))
      throw new BadRequestException('Erledigt kann nicht in der Zukunft liegen.');
    return this.prisma.$transaction(async (tx) => {
      await lockFor(tx, 'maintenance', id);
      const maintenance = await tx.equipmentMaintenance.findFirst({
        where: { id, companyId: caller.companyId },
      });
      if (!maintenance) throw new NotFoundException('Wartung nicht gefunden.');
      if (!maintenance.active) throw new BadRequestException('Die Wartung ist nicht aktiv.');
      await tx.equipmentMaintenanceLog.create({
        data: {
          companyId: caller.companyId,
          maintenanceId: id,
          doneOn: asDay(dto.doneOn),
          userId: caller.userId,
          note: trimmed(dto.note),
          cost: dto.cost ?? null,
        },
      });
      const nextDue = maintenance.intervalMonths ? addMonths(dto.doneOn, maintenance.intervalMonths) : null;
      const updated = await tx.equipmentMaintenance.update({
        where: { id },
        data: {
          lastDone: asDay(dto.doneOn),
          ...(nextDue ? { nextDue: asDay(nextDue) } : { active: false }),
        },
      });
      await writeAudit(tx, {
        companyId: caller.companyId,
        userId: caller.userId,
        action: 'equipment_maintenance_done',
        entity: 'EquipmentMaintenance',
        entityId: id,
        newData: { title: maintenance.title, doneOn: dto.doneOn, nextDue },
      });
      return { ...updated, nextDue: dayOf(updated.nextDue), lastDone: dayOf(updated.lastDone) };
    });
  }

  // Fällige und überfällige Wartungen bis zu einem Tag (Standard: 30 Tage)
  async due(companyId: string, query: DueQueryDto) {
    const today = await this.today(companyId);
    const until = query.until ?? addCalendarDays(today, 30);
    if (!isValidDay(until)) throw new BadRequestException('Ungültiges Datum.');
    return this.maintenanceBetween(companyId, null, until, today);
  }

  // auch für den Kalender: aktive Wartungen mit Fälligkeit im Zeitraum
  async maintenanceBetween(companyId: string, from: string | null, to: string, today?: string) {
    const now = today ?? (await this.today(companyId));
    const rows = await this.prisma.equipmentMaintenance.findMany({
      where: {
        companyId,
        active: true,
        equipment: { retired: false },
        nextDue: { ...(from ? { gte: asDay(from) } : {}), lte: asDay(to) },
      },
      orderBy: { nextDue: 'asc' },
      include: { equipment: { select: { id: true, name: true } } },
    });
    return rows.map((m) => ({
      id: m.id,
      title: m.title,
      due: dayOf(m.nextDue)!,
      overdue: dayOf(m.nextDue)! < now,
      equipment: m.equipment,
    }));
  }

  // ── Inventur ──────────────────────────────────

  listCounts(companyId: string) {
    return this.prisma.inventoryCount.findMany({
      where: { companyId },
      orderBy: { createdAt: 'desc' },
      take: 50,
      include: { _count: { select: { items: true } } },
    });
  }

  async createCount(caller: Caller, dto: InventoryCountDto) {
    return this.prisma.$transaction(async (tx) => {
      await lockFor(tx, 'inventory', caller.companyId);
      const open = await tx.inventoryCount.findFirst({
        where: { companyId: caller.companyId, closedAt: null },
      });
      if (open) throw new ConflictException('Es läuft schon eine Inventur. Bitte erst abschließen.');
      return tx.inventoryCount.create({
        data: { companyId: caller.companyId, title: dto.title.trim(), startedByUserId: caller.userId },
      });
    });
  }

  // Alle Geräte (ohne ausgemusterte) mit dem Stand dieser Inventur
  async getCount(companyId: string, id: string) {
    const count = await this.prisma.inventoryCount.findFirst({
      where: { id, companyId },
      include: { items: true },
    });
    if (!count) throw new NotFoundException('Inventur nicht gefunden.');
    const equipment = await this.prisma.equipment.findMany({
      where: { companyId, OR: [{ retired: false }, { id: { in: count.items.map((i) => i.equipmentId) } }] },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, kind: true, inventoryNumber: true, location: true },
    });
    const items = new Map(count.items.map((i) => [i.equipmentId, i]));
    const rows = equipment.map((e) => ({ equipment: e, item: items.get(e.id) ?? null }));
    return {
      ...count,
      items: undefined,
      rows,
      summary: {
        total: rows.length,
        found: rows.filter((r) => r.item?.found).length,
        missing: rows.filter((r) => r.item && !r.item.found).length,
        open: rows.filter((r) => !r.item).length,
      },
    };
  }

  async countItem(caller: Caller, countId: string, equipmentId: string, dto: CountItemDto) {
    await this.equipmentOf(caller.companyId, equipmentId);
    return this.prisma.$transaction(async (tx) => {
      await lockFor(tx, 'inventory-count', countId);
      const count = await tx.inventoryCount.findFirst({
        where: { id: countId, companyId: caller.companyId },
      });
      if (!count) throw new NotFoundException('Inventur nicht gefunden.');
      if (count.closedAt) throw new BadRequestException('Die Inventur ist abgeschlossen.');
      const data = {
        found: dto.found,
        location: trimmed(dto.location) ?? null,
        note: trimmed(dto.note) ?? null,
        countedByUserId: caller.userId,
        countedAt: new Date(),
      };
      return tx.inventoryCountItem.upsert({
        where: { countId_equipmentId: { countId, equipmentId } },
        create: { ...data, companyId: caller.companyId, countId, equipmentId },
        update: data,
      });
    });
  }

  // Abschließen: gefundene Geräte bekommen Datum und Standort der Inventur
  async closeCount(caller: Caller, id: string) {
    return this.prisma.$transaction(async (tx) => {
      await lockFor(tx, 'inventory-count', id);
      const count = await tx.inventoryCount.findFirst({
        where: { id, companyId: caller.companyId },
        include: { items: true },
      });
      if (!count) throw new NotFoundException('Inventur nicht gefunden.');
      if (count.closedAt) throw new BadRequestException('Die Inventur ist schon abgeschlossen.');
      const closedAt = new Date();
      for (const item of count.items.filter((i) => i.found))
        await tx.equipment.update({
          where: { id: item.equipmentId },
          data: { lastInventoryAt: closedAt, ...(item.location ? { location: item.location } : {}) },
        });
      const closed = await tx.inventoryCount.update({
        where: { id },
        data: { closedAt, closedByUserId: caller.userId },
      });
      const missing = count.items.filter((i) => !i.found).map((i) => i.equipmentId);
      await writeAudit(tx, {
        companyId: caller.companyId,
        userId: caller.userId,
        action: 'inventory_closed',
        entity: 'InventoryCount',
        entityId: id,
        newData: { title: count.title, counted: count.items.length, missing },
      });
      return closed;
    });
  }
}
