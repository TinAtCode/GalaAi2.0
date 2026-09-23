import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  DEFAULT_CATEGORIES,
  DEFAULT_RULES,
  normalizeIban,
  normalizeName,
  suggestCategory,
} from './categorize';

// Kategorien und Regeln für Ausgaben; ordnet Abbuchungen automatisch zu
// (gelernt aus Zuordnungen von Hand, dann Regeln).
@Injectable()
export class CategoriesService {
  constructor(private prisma: PrismaService) {}

  // Startwerte einmal je Firma (neue Firmen; bestehende bekamen sie per
  // Migration). Die Markierung an der Firma sperrt parallele Aufrufe und
  // verhindert, dass gelöschte Startkategorien wiederkommen.
  async ensureDefaults(companyId: string) {
    const company = await this.prisma.company.findUniqueOrThrow({
      where: { id: companyId },
      select: { financeDefaultsAt: true },
    });
    if (company.financeDefaultsAt) return;
    await this.prisma.$transaction(async (tx) => {
      // wartet auf einen parallelen Aufruf und findet dann nichts mehr zu tun
      const { count } = await tx.company.updateMany({
        where: { id: companyId, financeDefaultsAt: null },
        data: { financeDefaultsAt: new Date() },
      });
      if (count === 0) return;
      await tx.expenseCategory.createMany({
        data: DEFAULT_CATEGORIES.map((name, sortOrder) => ({ companyId, name, sortOrder })),
        skipDuplicates: true,
      });
      const categories = await tx.expenseCategory.findMany({ where: { companyId } });
      const byName = new Map(categories.map((c) => [c.name, c.id]));
      await tx.categoryRule.createMany({
        data: DEFAULT_RULES.filter(([, c]) => byName.has(c)).map(([pattern, c]) => ({
          companyId,
          categoryId: byName.get(c)!,
          pattern,
          field: 'any' as const,
          // Standardregeln gelten als älteste – eigene Regeln gehen vor
          createdAt: new Date(0),
        })),
      });
    });
  }

  async list(companyId: string) {
    await this.ensureDefaults(companyId);
    const [categories, counts] = await Promise.all([
      this.prisma.expenseCategory.findMany({
        where: { companyId },
        orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
        include: { rules: { orderBy: { createdAt: 'desc' } } },
      }),
      this.prisma.bankTransaction.groupBy({
        by: ['categoryId'],
        where: { companyId, direction: 'debit' },
        _count: { _all: true },
      }),
    ]);
    return categories.map((c) => ({
      id: c.id,
      name: c.name,
      transactions: counts.find((x) => x.categoryId === c.id)?._count._all ?? 0,
      rules: c.rules.map((r) => ({ id: r.id, pattern: r.pattern, field: r.field })),
    }));
  }

  async create(companyId: string, name: string) {
    await this.ensureDefaults(companyId);
    const max = await this.prisma.expenseCategory.aggregate({
      where: { companyId },
      _max: { sortOrder: true },
    });
    try {
      return await this.prisma.expenseCategory.create({
        data: { companyId, name: name.trim(), sortOrder: (max._max.sortOrder ?? 0) + 1 },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Diese Kategorie gibt es schon.');
      throw error;
    }
  }

  private async category(companyId: string, id: string) {
    const category = await this.prisma.expenseCategory.findFirst({ where: { id, companyId } });
    if (!category) throw new NotFoundException('Kategorie nicht gefunden.');
    return category;
  }

  async rename(companyId: string, id: string, name: string) {
    await this.category(companyId, id);
    try {
      return await this.prisma.expenseCategory.update({ where: { id }, data: { name: name.trim() } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictException('Diese Kategorie gibt es schon.');
      throw error;
    }
  }

  // Löschen: Umsätze und Fixkosten verlieren die Kategorie, Regeln fallen weg
  // Umsätze der Kategorie gelten danach als noch nicht zugeordnet und
  // bekommen, wo Gelerntes oder eine Regel passt, gleich eine neue.
  async remove(companyId: string, id: string) {
    await this.category(companyId, id);
    await this.prisma.$transaction([
      this.prisma.bankTransaction.updateMany({
        where: { companyId, categoryId: id },
        data: { categoryId: null, categorySource: null, categorizedAt: null },
      }),
      this.prisma.expenseCategory.delete({ where: { id } }),
    ]);
    await this.categorizeOpen(companyId);
    return { deleted: true };
  }

  async addRule(
    companyId: string,
    categoryId: string,
    pattern: string,
    field: 'any' | 'counterparty' | 'remittance' | 'iban',
  ) {
    await this.category(companyId, categoryId);
    const trimmed = field === 'iban' ? normalizeIban(pattern) : pattern.trim().toLowerCase();
    if (trimmed.length < 2) throw new BadRequestException('Das Stichwort braucht mindestens 2 Zeichen.');
    const rule = await this.prisma.categoryRule.create({
      data: { companyId, categoryId, pattern: trimmed, field },
    });
    // offene Abbuchungen gleich mit der neuen Regel zuordnen
    const { assigned } = await this.categorizeOpen(companyId);
    return { ...rule, assigned };
  }

  async removeRule(companyId: string, id: string) {
    const { count } = await this.prisma.categoryRule.deleteMany({ where: { id, companyId } });
    if (count === 0) throw new NotFoundException('Regel nicht gefunden.');
    return { deleted: true };
  }

  // Abbuchungen ohne Kategorie (und nicht von Hand geleert) zuordnen
  async categorizeOpen(companyId: string) {
    await this.ensureDefaults(companyId);
    const [rules, manual, open] = await Promise.all([
      this.prisma.categoryRule.findMany({ where: { companyId }, orderBy: { createdAt: 'desc' } }),
      this.prisma.bankTransaction.findMany({
        where: { companyId, categorySource: 'manual', categoryId: { not: null } },
        orderBy: { categorizedAt: 'asc' },
        select: { counterpartyName: true, counterpartyIban: true, categoryId: true },
      }),
      this.prisma.bankTransaction.findMany({
        where: { companyId, direction: 'debit', categoryId: null, categorySource: null },
        select: { id: true, counterpartyName: true, counterpartyIban: true, remittance: true },
      }),
    ]);
    // spätere Zuordnungen überschreiben frühere
    const learned = { byIban: new Map<string, string>(), byName: new Map<string, string>() };
    for (const m of manual) {
      const iban = normalizeIban(m.counterpartyIban);
      const name = normalizeName(m.counterpartyName);
      if (iban) learned.byIban.set(iban, m.categoryId!);
      if (name) learned.byName.set(name, m.categoryId!);
    }
    let assigned = 0;
    for (const t of open) {
      const hit = suggestCategory(t, rules, learned);
      if (!hit) continue;
      // bedingt: nur, wenn inzwischen niemand von Hand zugeordnet hat
      const { count } = await this.prisma.bankTransaction.updateMany({
        where: { id: t.id, companyId, categorySource: null },
        data: { categoryId: hit.categoryId, categorySource: hit.source, categorizedAt: new Date() },
      });
      assigned += count;
    }
    return { assigned };
  }

  // Zuordnung von Hand (null = bewusst ohne Kategorie); optional als Regel
  // für diesen Empfänger merken. Danach lernen die offenen Umsätze mit.
  async assign(companyId: string, transactionId: string, categoryId: string | null, createRule: boolean) {
    const transaction = await this.prisma.bankTransaction.findFirst({
      where: { id: transactionId, companyId },
    });
    if (!transaction) throw new NotFoundException('Kontobewegung nicht gefunden.');
    if (categoryId) await this.category(companyId, categoryId);
    await this.prisma.bankTransaction.update({
      where: { id: transactionId },
      data: { categoryId, categorySource: 'manual', categorizedAt: new Date() },
    });
    if (createRule && categoryId && transaction.counterpartyName) {
      await this.prisma.categoryRule.create({
        data: {
          companyId,
          categoryId,
          pattern: normalizeName(transaction.counterpartyName),
          field: 'counterparty',
        },
      });
    }
    const { assigned } = await this.categorizeOpen(companyId);
    return { categoryId, alsoAssigned: assigned };
  }
}
