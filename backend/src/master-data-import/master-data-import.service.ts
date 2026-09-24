import { BadRequestException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PERMISSIONS } from '../common/permissions';
import { writeAudit } from '../common/audit';
import { lockFor } from '../common/advisory-lock';
import {
  detectEntity,
  ENTITIES,
  EntityType,
  Existing,
  Mapping,
  MatchedRow,
  matchRows,
  parseRows,
  suggestMapping,
  Value,
} from './entities';
import { parseSource, parseText, SourceTable } from './parse-source';

const SESSION_HOURS = 24;

// Preise im Bestand und in der Vorschau: nur mit den Preisrechten
const PRICE_PERMISSIONS: Partial<Record<EntityType, string[]>> = {
  articles: [PERMISSIONS.PRICE_PURCHASE_READ, PERMISSIONS.PRICE_SALE_READ],
  machines: [PERMISSIONS.PRICE_PURCHASE_READ],
};

// Pflicht beim Neuanlegen (beim Ändern genügt der Schlüssel)
const REQUIRED_FOR_CREATE: Partial<Record<EntityType, string[]>> = {
  articles: ['unit'],
};

const num = (d: Prisma.Decimal | null) => (d === null ? null : Number(d));

// Stammdaten-Import: Quelle einlesen, Spalten zuordnen, mit dem Bestand
// abgleichen, ausgewählte Zeilen in einer Transaktion übernehmen.
@Injectable()
export class MasterDataImportService {
  constructor(private prisma: PrismaService) {}

  private async startSession(companyId: string, userId: string, source: string, table: SourceTable) {
    await this.prisma.importSession.deleteMany({
      where: { companyId, createdAt: { lt: new Date(Date.now() - SESSION_HOURS * 3_600_000) } },
    });
    const session = await this.prisma.importSession.create({
      data: { companyId, userId, source, headers: table.headers, rows: table.rows },
    });
    const entity = detectEntity(table.headers);
    return {
      sessionId: session.id,
      source,
      headers: table.headers,
      rowCount: table.rows.length,
      sample: table.rows.slice(0, 5),
      entity,
      entities: Object.values(ENTITIES).map((def) => ({
        type: def.type,
        label: def.label,
        fields: def.fields.map(({ key, label, required }) => ({ key, label, required: !!required })),
        suggested: suggestMapping(def.type, table.headers),
      })),
    };
  }

  async fromFile(companyId: string, userId: string, file: { originalname: string; buffer: Buffer }) {
    return this.startSession(
      companyId,
      userId,
      file.originalname,
      await parseSource(file.originalname, file.buffer),
    );
  }

  async fromText(companyId: string, userId: string, text: string) {
    return this.startSession(companyId, userId, 'Eingefügter Text', parseText(text));
  }

  private async session(companyId: string, sessionId: string) {
    const session = await this.prisma.importSession.findFirst({ where: { id: sessionId, companyId } });
    if (!session)
      throw new NotFoundException('Import nicht gefunden oder abgelaufen – bitte die Quelle neu einlesen.');
    return { ...session, headers: session.headers as string[], rows: session.rows as string[][] };
  }

  private checkPermissions(entity: EntityType, permissions: string[]) {
    const missing = (PRICE_PERMISSIONS[entity] ?? []).filter((p) => !permissions.includes(p));
    if (missing.length) {
      throw new ForbiddenException(
        `Für den Import von ${ENTITIES[entity].label} fehlen: ${missing.join(', ')}`,
      );
    }
  }

  private checkMapping(entity: EntityType, headers: string[], mapping: Mapping) {
    const def = ENTITIES[entity];
    for (const [field, column] of Object.entries(mapping)) {
      if (!def.fields.some((f) => f.key === field))
        throw new BadRequestException(`Unbekanntes Feld: ${field}`);
      if (column && !headers.includes(column)) throw new BadRequestException(`Unbekannte Spalte: ${column}`);
    }
    const missing = def.fields.filter((f) => f.required && !mapping[f.key]);
    if (missing.length) {
      throw new BadRequestException(
        `Bitte eine Spalte zuordnen für: ${missing.map((f) => f.label).join(', ')}`,
      );
    }
  }

  private async existing(
    db: Prisma.TransactionClient,
    companyId: string,
    entity: EntityType,
  ): Promise<Existing[]> {
    switch (entity) {
      case 'customers':
        return db.customer.findMany({
          where: { companyId },
          select: {
            id: true,
            name: true,
            email: true,
            phone: true,
            street: true,
            postalCode: true,
            city: true,
            vatId: true,
            buyerReference: true,
            isBusiness: true,
            debtorNumber: true,
          },
        });
      case 'suppliers':
        return db.supplier.findMany({
          where: { companyId },
          select: { id: true, name: true, email: true, phone: true },
        });
      case 'articles':
        return (
          await db.article.findMany({
            where: { companyId },
            select: {
              id: true,
              articleNumber: true,
              name: true,
              unit: true,
              purchasePrice: true,
              salePrice: true,
            },
          })
        ).map((a) => ({ ...a, purchasePrice: num(a.purchasePrice), salePrice: num(a.salePrice) }));
      case 'machines':
        return (
          await db.machine.findMany({
            where: { companyId },
            select: { id: true, name: true, hourlyRate: true },
          })
        ).map((m) => ({ ...m, hourlyRate: num(m.hourlyRate) }));
    }
  }

  private async compare(
    db: Prisma.TransactionClient,
    companyId: string,
    session: { headers: string[]; rows: string[][] },
    entity: EntityType,
    mapping: Mapping,
  ): Promise<MatchedRow[]> {
    this.checkMapping(entity, session.headers, mapping);
    const parsed = parseRows(entity, session.headers, session.rows, mapping);
    const matched = matchRows(entity, parsed, await this.existing(db, companyId, entity));
    const required = REQUIRED_FOR_CREATE[entity] ?? [];
    const labelOf = (key: string) => ENTITIES[entity].fields.find((f) => f.key === key)!.label;
    return matched.map((row) => {
      const missing = required.filter((key) => row.values[key] === undefined);
      if ((row.status === 'new' || row.status === 'duplicate') && missing.length) {
        return {
          ...row,
          status: 'invalid',
          preselected: false,
          errors: [...row.errors, ...missing.map((key) => `${labelOf(key)} fehlt (nötig für neue Einträge)`)],
        };
      }
      return row;
    });
  }

  async preview(
    companyId: string,
    permissions: string[],
    sessionId: string,
    entity: EntityType,
    mapping: Mapping,
  ) {
    this.checkPermissions(entity, permissions);
    const session = await this.session(companyId, sessionId);
    const rows = await this.compare(this.prisma, companyId, session, entity, mapping);
    const count = (status: string) => rows.filter((r) => r.status === status).length;
    return {
      entity,
      summary: {
        total: rows.length,
        new: count('new'),
        update: count('update'),
        unchanged: count('unchanged'),
        duplicate: count('duplicate'),
        invalid: count('invalid'),
      },
      rows,
    };
  }

  // Übernahme der ausgewählten Zeilen (Zeilennummern der Quelle). Der Abgleich
  // läuft in der Transaktion erneut – was sich seit der Vorschau geändert hat,
  // zählt. Ungültige oder unveränderte Zeilen werden nie übernommen.
  async apply(
    companyId: string,
    userId: string,
    permissions: string[],
    sessionId: string,
    entity: EntityType,
    mapping: Mapping,
    accept: number[],
  ) {
    this.checkPermissions(entity, permissions);
    const session = await this.session(companyId, sessionId);
    const accepted = new Set(accept);
    const result = await this.prisma
      .$transaction(
        async (tx) => {
          await lockFor(tx, 'master-data-import', `${companyId}:${entity}`);
          const rows = await this.compare(tx, companyId, session, entity, mapping);
          let created = 0;
          let updated = 0;
          const skipped: { row: number; reason: string }[] = [];
          for (const row of rows) {
            if (!accepted.has(row.index)) continue;
            if (row.status === 'invalid' || row.status === 'unchanged') {
              skipped.push({
                row: row.index + 2,
                reason: row.status === 'invalid' ? row.errors.join('; ') : 'unverändert',
              });
              continue;
            }
            if (row.status === 'update') {
              await this.update(
                tx,
                entity,
                row.matchId!,
                Object.fromEntries(row.changes.map((c) => [c.field, c.new])),
              );
              updated++;
            } else {
              await this.create(tx, companyId, entity, row.values);
              created++;
            }
          }
          await writeAudit(tx, {
            companyId,
            userId,
            action: 'masterdata.import',
            entity: entity,
            entityId: sessionId,
            newData: { source: session.source, created, updated, skipped: skipped.length },
          });
          return { created, updated, skipped };
        },
        { timeout: 60_000 },
      )
      .catch((error: unknown) => {
        // eindeutige Werte (Debitorennummer, Artikelnummer) schon vergeben: nichts übernommen
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
          throw new BadRequestException(
            'Ein eindeutiger Wert (z.B. Debitoren- oder Artikelnummer) ist schon vergeben. Es wurde nichts übernommen.',
          );
        }
        throw error;
      });
    await this.prisma.importSession.deleteMany({ where: { id: sessionId, companyId } });
    return result;
  }

  private async create(
    tx: Prisma.TransactionClient,
    companyId: string,
    entity: EntityType,
    v: Record<string, Value>,
  ) {
    const text = (key: string) => (v[key] === undefined ? undefined : (v[key] as string));
    switch (entity) {
      case 'customers':
        if (v.debtorNumber !== undefined) {
          const taken = await tx.customer.findFirst({
            where: { companyId, debtorNumber: v.debtorNumber as number },
            select: { id: true },
          });
          if (taken) throw new BadRequestException(`Debitorennummer ${v.debtorNumber} ist schon vergeben.`);
        }
        await tx.customer.create({
          data: {
            companyId,
            name: text('name')!,
            email: text('email'),
            phone: text('phone'),
            street: text('street'),
            postalCode: text('postalCode'),
            city: text('city'),
            vatId: text('vatId'),
            buyerReference: text('buyerReference'),
            isBusiness: (v.isBusiness as boolean | undefined) ?? false,
            debtorNumber: v.debtorNumber as number | undefined,
          },
        });
        return;
      case 'suppliers':
        await tx.supplier.create({
          data: { companyId, name: text('name')!, email: text('email'), phone: text('phone') },
        });
        return;
      case 'articles':
        await tx.article.create({
          data: {
            companyId,
            articleNumber: text('articleNumber')!,
            name: text('name')!,
            unit: text('unit')!,
            purchasePrice: (v.purchasePrice as number | undefined) ?? 0,
            salePrice: (v.salePrice as number | undefined) ?? 0,
          },
        });
        return;
      case 'machines':
        await tx.machine.create({
          data: { companyId, name: text('name')!, hourlyRate: v.hourlyRate as number },
        });
    }
  }

  private async update(
    tx: Prisma.TransactionClient,
    entity: EntityType,
    id: string,
    data: Record<string, Value>,
  ) {
    switch (entity) {
      case 'customers':
        await tx.customer.update({ where: { id }, data: data as Prisma.CustomerUpdateInput });
        return;
      case 'suppliers':
        await tx.supplier.update({ where: { id }, data: data as Prisma.SupplierUpdateInput });
        return;
      case 'articles':
        await tx.article.update({ where: { id }, data: data as Prisma.ArticleUpdateInput });
        return;
      case 'machines':
        await tx.machine.update({ where: { id }, data: data as Prisma.MachineUpdateInput });
    }
  }

  async discard(companyId: string, sessionId: string) {
    await this.prisma.importSession.deleteMany({ where: { id: sessionId, companyId } });
    return { discarded: true };
  }
}
