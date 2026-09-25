import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { IncomingInvoice, Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';
import { isValidDay, localDayString } from '../../common/time-zone';
import { FILE_STORAGE, FileStorage } from '../../documents/storage/file-storage.interface';
import { OcrService } from '../../ocr/ocr.service';
import { OcrQueue } from '../../ocr/ocr-queue';
import { CategoriesService } from '../categories.service';
import { normalizeIban, normalizeName } from '../categorize';
import { CreditNoteError, EMPTY_DRAFT, parseEInvoice, PayableDraft } from './einvoice';
import { extractFromText, TextSuggestion } from './extract-text';
import { bestMatches, discountedAmount, earliestPayment, MatchDebit, MatchPayable } from './match';
import { embeddedInvoiceXml } from './pdf-attachment';
import { AI_READ_PROMPT, draftFromAi, jsonFromText } from './ai-read';
import { AiGatewayService, Caller } from '../../ai-gateway/ai-gateway.service';
import { imagesForAi } from '../../ai-gateway/images';
import { plannedPayment } from './schedule';
import { findSupplier, rankNotes } from './delivery-match';
import { ListPayablesDto, PayPayableDto, SetDeliveryNotesDto, UpsertPayableDto } from './payables.dto';

const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toDate = (value: string | null | undefined) =>
  value === undefined ? undefined : value === null ? null : new Date(`${value}T00:00:00Z`);
const MATCH_WINDOW_DAYS = 180;

type Row = IncomingInvoice & {
  category?: { id: string; name: string } | null;
  document?: { id: string; fileName: string } | null;
  project?: { id: string; number: string | null; title: string } | null;
  supplier?: { id: string; name: string } | null;
  _count?: { deliveryNotes: number };
};
type UploadedFile = { originalname: string; buffer: Buffer; mimetype: string };

// Belege aus "Beleg einlesen" – getrennt von Dokumenten, die über das
// Dokumente-Modul hochgeladen wurden (die dürfen hier nie gelöscht werden)
export const PAYABLE_DOCUMENT_TYPE = 'incoming_invoice';
const CREDIT_NOTE_MESSAGE =
  'Das ist eine Gutschrift, keine Rechnung – Gutschriften werden hier nicht erfasst.';

const EMPTY_CANDIDATES: TextSuggestion['candidates'] = {
  supplierName: [],
  amount: [],
  invoiceNumber: [],
  iban: [],
};

// Eingangsrechnungen: erfassen (E-Rechnung, Text einer PDF/eines Fotos oder
// von Hand), mit Abbuchungen abgleichen, als bezahlt verbuchen
@Injectable()
export class PayablesService {
  private readonly logger = new Logger(PayablesService.name);

  constructor(
    private prisma: PrismaService,
    @Inject(FILE_STORAGE) private storage: FileStorage,
    private ocr: OcrService,
    private queue: OcrQueue,
    private categories: CategoriesService,
    private ai: AiGatewayService,
  ) {}

  view(p: Row) {
    return {
      id: p.id,
      supplierName: p.supplierName,
      supplierIban: p.supplierIban,
      invoiceNumber: p.invoiceNumber,
      invoiceDate: day(p.invoiceDate),
      dueDate: day(p.dueDate),
      amount: p.amount,
      netAmount: p.netAmount,
      vatAmount: p.vatAmount,
      discountPercent: p.discountPercent,
      discountUntil: day(p.discountUntil),
      discountedAmount: discountedAmount(p.amount.toFixed(2), p.discountPercent?.toFixed(2) ?? null),
      category: p.category ? { id: p.category.id, name: p.category.name } : null,
      document: p.document ? { id: p.document.id, fileName: p.document.fileName } : null,
      project: p.project ? { id: p.project.id, number: p.project.number, title: p.project.title } : null,
      supplier: p.supplier ? { id: p.supplier.id, name: p.supplier.name } : null,
      deliveryNoteCount: p._count?.deliveryNotes ?? 0,
      source: p.source,
      status: p.status,
      paidAt: day(p.paidAt),
      paidAmount: p.paidAmount,
      bankTransactionId: p.bankTransactionId,
      notes: p.notes,
      createdAt: p.createdAt,
    };
  }

  private include = {
    category: { select: { id: true, name: true } },
    document: { select: { id: true, fileName: true } },
    project: { select: { id: true, number: true, title: true } },
    supplier: { select: { id: true, name: true } },
    _count: { select: { deliveryNotes: true } },
  } as const;

  private async company(companyId: string) {
    return this.prisma.company.findUniqueOrThrow({ where: { id: companyId } });
  }

  private planInput(p: IncomingInvoice) {
    return { ...this.matchable(p), dueDate: day(p.dueDate) };
  }

  private matchable(p: IncomingInvoice): MatchPayable {
    return {
      id: p.id,
      supplierName: p.supplierName,
      supplierIban: p.supplierIban,
      invoiceNumber: p.invoiceNumber,
      invoiceDate: day(p.invoiceDate),
      earliest: earliestPayment({
        invoiceDate: day(p.invoiceDate),
        dueDate: day(p.dueDate),
        createdAt: day(p.createdAt)!,
      }),
      amount: p.amount.toFixed(2),
      discountPercent: p.discountPercent?.toFixed(2) ?? null,
      discountUntil: day(p.discountUntil),
      rejected: p.rejectedTransactionIds,
    };
  }

  // Abbuchungen, die noch keiner Eingangsrechnung zugeordnet sind
  private async freeDebits(companyId: string, since: string): Promise<MatchDebit[]> {
    const debits = await this.prisma.bankTransaction.findMany({
      where: {
        companyId,
        direction: 'debit',
        reversal: false,
        payable: null,
        bookingDate: { gte: new Date(`${since}T00:00:00Z`) },
      },
      select: {
        id: true,
        bookingDate: true,
        amount: true,
        counterpartyName: true,
        counterpartyIban: true,
        remittance: true,
      },
    });
    return debits.map((d) => ({ ...d, bookingDate: day(d.bookingDate)!, amount: d.amount.toFixed(2) }));
  }

  // Beleg einlesen: Vorschläge für das Formular, Datei als Dokument gespeichert
  async extract(companyId: string, userId: string, file: UploadedFile) {
    const name = file.originalname.toLowerCase();
    const isXml = /xml/.test(file.mimetype) || name.endsWith('.xml');
    const isPdf = file.mimetype === 'application/pdf' || name.endsWith('.pdf');
    if (!isXml && !isPdf && !file.mimetype.startsWith('image/')) {
      throw new BadRequestException(
        'Bitte eine PDF, ein Foto (JPG/PNG) oder eine E-Rechnung (XML) hochladen.',
      );
    }
    const company = await this.company(companyId);
    let draft: PayableDraft | null = null;
    let candidates = EMPTY_CANDIDATES;
    let source: 'einvoice' | 'text' | 'manual' = 'manual';
    let text: string | null = null;
    let warning: string | null = null;

    if (isXml) {
      try {
        draft = parseEInvoice(file.buffer.toString('utf8'));
      } catch (error) {
        if (error instanceof CreditNoteError) throw new BadRequestException(CREDIT_NOTE_MESSAGE);
        draft = null;
      }
      if (!draft)
        throw new BadRequestException('Die XML-Datei ist keine lesbare E-Rechnung (XRechnung/ZUGFeRD).');
      source = 'einvoice';
    } else {
      const xml = isPdf ? await embeddedInvoiceXml(file.buffer) : null;
      if (xml) {
        try {
          draft = parseEInvoice(xml);
          if (draft) source = 'einvoice';
        } catch (error) {
          if (error instanceof CreditNoteError) throw new BadRequestException(CREDIT_NOTE_MESSAGE);
          draft = null;
        }
      }
      if (!draft) {
        try {
          const result = await this.queue.run(() => this.ocr.extractFromFile(file));
          text = result.text;
          const known = await this.knownSuppliers(companyId);
          const suggestion = extractFromText(text, {
            knownSuppliers: known,
            ownIbans: company.iban ? [company.iban] : [],
            ownName: company.name,
          });
          ({ candidates, ...draft } = suggestion);
          source = 'text';
        } catch (error) {
          // Texterkennung fehlgeschlagen: Beleg trotzdem speichern, Angaben von Hand
          this.logger.warn({ msg: 'Eingangsrechnung: Text nicht lesbar', error: String(error) });
          draft = { ...EMPTY_DRAFT };
          warning = 'Der Text des Belegs ließ sich nicht lesen – bitte die Angaben von Hand eintragen.';
        }
      }
    }

    const stored = await this.storage.save(companyId, file.originalname, file.buffer);
    const document = await this.prisma.document.create({
      data: {
        companyId,
        fileName: file.originalname,
        storagePath: stored.storagePath,
        documentType: PAYABLE_DOCUMENT_TYPE,
        uploadedByUserId: userId,
        ...(text !== null ? { ocrStatus: 'done' as const, ocrText: text } : {}),
      },
    });

    const suggestion = draft!;
    const categoryId = suggestion.supplierName
      ? await this.suggestCategory(companyId, suggestion.supplierName, suggestion.supplierIban)
      : null;
    const duplicateOf = await this.findDuplicate(
      companyId,
      suggestion.supplierName,
      suggestion.invoiceNumber,
    );
    return {
      documentId: document.id,
      fileName: document.fileName,
      source,
      draft: { ...suggestion, categoryId },
      candidates,
      duplicateOf: duplicateOf ? this.view(duplicateOf) : null,
      warning,
    };
  }

  // Lieferanten aus den Stammdaten und bisherigen Eingangsrechnungen
  private async knownSuppliers(companyId: string) {
    const [suppliers, previous] = await Promise.all([
      this.prisma.supplier.findMany({
        where: { companyId, active: true },
        select: { name: true },
        take: 500,
      }),
      this.prisma.incomingInvoice.findMany({
        where: { companyId },
        distinct: ['supplierName'],
        select: { supplierName: true },
        take: 500,
      }),
    ]);
    return [...new Set([...suppliers.map((s) => s.name), ...previous.map((p) => p.supplierName)])];
  }

  // zuletzt verwendete Kategorie dieses Lieferanten, sonst Gelerntes/Regeln
  private async suggestCategory(companyId: string, supplierName: string, supplierIban: string | null) {
    const previous = await this.prisma.incomingInvoice.findMany({
      where: { companyId, categoryId: { not: null } },
      orderBy: { createdAt: 'desc' },
      select: { supplierName: true, supplierIban: true, categoryId: true },
      take: 500,
    });
    const iban = normalizeIban(supplierIban);
    const name = normalizeName(supplierName);
    const same = previous.find(
      (p) => (iban && normalizeIban(p.supplierIban) === iban) || normalizeName(p.supplierName) === name,
    );
    if (same) return same.categoryId;
    return this.categories.suggestFor(companyId, {
      counterpartyName: supplierName,
      counterpartyIban: supplierIban,
      remittance: null,
    });
  }

  private async findDuplicate(
    companyId: string,
    supplierName: string | null,
    invoiceNumber: string | null,
    exceptId?: string,
  ) {
    if (!supplierName || !invoiceNumber) return null;
    const candidates = await this.prisma.incomingInvoice.findMany({
      where: {
        companyId,
        invoiceNumber: { equals: invoiceNumber.trim(), mode: 'insensitive' },
        status: { not: 'cancelled' },
        ...(exceptId ? { id: { not: exceptId } } : {}),
      },
      include: this.include,
    });
    return candidates.find((c) => normalizeName(c.supplierName) === normalizeName(supplierName)) ?? null;
  }

  private async check(companyId: string, dto: UpsertPayableDto) {
    for (const field of ['invoiceDate', 'dueDate', 'discountUntil'] as const) {
      const value = dto[field];
      if (value && !isValidDay(value)) throw new BadRequestException('Ungültiges Datum.');
    }
    if (dto.categoryId) {
      const category = await this.prisma.expenseCategory.findFirst({
        where: { id: dto.categoryId, companyId },
      });
      if (!category) throw new NotFoundException('Kategorie nicht gefunden.');
    }
    if (dto.projectId) {
      const project = await this.prisma.project.findFirst({ where: { id: dto.projectId, companyId } });
      if (!project) throw new NotFoundException('Projekt nicht gefunden.');
    }
    if (dto.supplierId) {
      const supplier = await this.prisma.supplier.findFirst({ where: { id: dto.supplierId, companyId } });
      if (!supplier) throw new NotFoundException('Lieferant nicht gefunden.');
    }
    if (dto.documentId) {
      // nur Belege aus "Beleg einlesen", keine Projektdokumente
      const document = await this.prisma.document.findFirst({
        where: { id: dto.documentId, companyId, documentType: PAYABLE_DOCUMENT_TYPE, projectId: null },
      });
      if (!document) throw new NotFoundException('Beleg nicht gefunden.');
    }
  }

  private data(dto: UpsertPayableDto) {
    const set = <K extends keyof UpsertPayableDto, V>(
      key: K,
      map: (v: NonNullable<UpsertPayableDto[K]>) => V,
    ) => (dto[key] === undefined ? {} : { [key]: dto[key] === null ? null : map(dto[key]!) });
    return {
      ...(dto.supplierName !== undefined ? { supplierName: dto.supplierName.trim() } : {}),
      ...set('supplierIban', (v) => normalizeIban(v) || null),
      ...set('invoiceNumber', (v) => v.trim() || null),
      ...set('invoiceDate', (v) => toDate(v)),
      ...set('dueDate', (v) => toDate(v)),
      ...(dto.amount !== undefined ? { amount: dto.amount } : {}),
      ...set('netAmount', (v) => v),
      ...set('vatAmount', (v) => v),
      ...set('discountPercent', (v) => v),
      ...set('discountUntil', (v) => toDate(v)),
      ...set('categoryId', (v) => v),
      ...set('projectId', (v) => v),
      ...set('supplierId', (v) => v),
      ...set('notes', (v) => v.trim() || null),
    };
  }

  private conflict(error: unknown): never {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      const target = String((error.meta as { target?: unknown } | undefined)?.target ?? '');
      throw new ConflictException(
        target.includes('bankTransactionId')
          ? 'Diese Abbuchung ist schon einer anderen Eingangsrechnung zugeordnet.'
          : 'Dieser Beleg gehört schon zu einer Eingangsrechnung.',
      );
    }
    throw error;
  }

  async create(companyId: string, userId: string, dto: UpsertPayableDto) {
    if (!dto.supplierName || dto.amount === undefined) {
      throw new BadRequestException('Lieferant und Betrag sind Pflicht.');
    }
    await this.check(companyId, dto);
    const duplicate = await this.findDuplicate(companyId, dto.supplierName, dto.invoiceNumber ?? null);
    if (duplicate) {
      throw new ConflictException(
        `Die Rechnung ${duplicate.invoiceNumber} von ${duplicate.supplierName} ist schon erfasst.`,
      );
    }
    try {
      const created = await this.prisma.incomingInvoice.create({
        data: {
          companyId,
          supplierName: dto.supplierName.trim(),
          amount: dto.amount,
          ...this.data(dto),
          ...(dto.supplierId === undefined
            ? { supplierId: await this.resolveSupplier(companyId, dto.supplierName) }
            : {}),
          documentId: dto.documentId ?? null,
          source: dto.source ?? 'manual',
          createdByUserId: userId,
        },
        include: this.include,
      });
      // gleich mit dem Kontoauszug abgleichen (Rechnung kam nach der Zahlung);
      // ein Fehler dabei macht das Erfassen nicht rückgängig
      await this.autoMatchSafely(companyId);
      return this.view(await this.findRow(companyId, created.id));
    } catch (error) {
      this.conflict(error);
    }
  }

  private async findRow(companyId: string, id: string) {
    const row = await this.prisma.incomingInvoice.findFirst({
      where: { id, companyId },
      include: this.include,
    });
    if (!row) throw new NotFoundException('Eingangsrechnung nicht gefunden.');
    return row;
  }

  async update(companyId: string, id: string, dto: UpsertPayableDto) {
    const current = await this.findRow(companyId, id);
    await this.check(companyId, dto);
    if (dto.supplierName !== undefined || dto.invoiceNumber !== undefined) {
      const duplicate = await this.findDuplicate(
        companyId,
        dto.supplierName ?? current.supplierName,
        dto.invoiceNumber === undefined ? current.invoiceNumber : dto.invoiceNumber,
        id,
      );
      if (duplicate) {
        throw new ConflictException(
          `Die Rechnung ${duplicate.invoiceNumber} von ${duplicate.supplierName} ist schon erfasst.`,
        );
      }
    }
    // neuer Name ohne gewählten Lieferanten: Lieferant neu erkennen
    const supplier =
      dto.supplierName !== undefined && dto.supplierId === undefined
        ? { supplierId: await this.resolveSupplier(companyId, dto.supplierName) }
        : {};
    // Beleg und Herkunft bleiben wie beim Erfassen (data() übernimmt sie nicht)
    await this.prisma.incomingInvoice.updateMany({
      where: { id, companyId },
      data: { ...this.data(dto), ...supplier },
    });
    return this.view(await this.findRow(companyId, id));
  }

  // Lieferant aus den Stammdaten zum Namen auf der Rechnung (nur eindeutig)
  private async resolveSupplier(companyId: string, supplierName: string) {
    const suppliers = await this.prisma.supplier.findMany({
      where: { companyId, active: true },
      select: { id: true, name: true, matchTerms: true },
    });
    return findSupplier(supplierName, suppliers);
  }

  // Lieferscheine zur Rechnung: zugeordnete und Vorschläge (bestätigt, noch
  // nicht abgerechnet, vom selben Lieferanten – ohne Lieferant nur mit der
  // Lieferscheinnummer im Text der Rechnung)
  async deliveryNotes(companyId: string, id: string) {
    const row = await this.findRow(companyId, id);
    const select = {
      id: true,
      noteNumber: true,
      noteDate: true,
      supplier: { select: { id: true, name: true } },
      project: { select: { id: true, number: true, title: true } },
    } as const;
    const [linked, open, document] = await Promise.all([
      this.prisma.deliveryNote.findMany({
        where: { companyId, incomingInvoiceId: id },
        orderBy: [{ noteDate: 'asc' }, { createdAt: 'asc' }],
        select,
      }),
      this.prisma.deliveryNote.findMany({
        where: {
          companyId,
          status: 'confirmed',
          incomingInvoiceId: null,
          ...(row.supplierId ? { supplierId: row.supplierId } : {}),
        },
        orderBy: { createdAt: 'desc' },
        take: 500,
        select,
      }),
      row.documentId
        ? this.prisma.document.findFirst({
            where: { id: row.documentId, companyId },
            select: { ocrText: true },
          })
        : null,
    ]);
    const text = [row.invoiceNumber, row.notes, document?.ocrText].filter(Boolean).join('\n');
    const byId = new Map(open.map((n) => [n.id, n]));
    const ranked = rankNotes(
      { invoiceDate: day(row.invoiceDate), text },
      open.map((n) => ({ id: n.id, noteNumber: n.noteNumber, noteDate: day(n.noteDate) })),
    ).filter((n) => row.supplierId || n.reasons.includes('number'));
    const noteView = (n: (typeof open)[number]) => ({ ...n, noteDate: day(n.noteDate) });
    return {
      linked: linked.map(noteView),
      suggestions: ranked.slice(0, 30).map((r) => ({ ...noteView(byId.get(r.id)!), reasons: r.reasons })),
    };
  }

  // Lieferscheine genau auf diese Auswahl setzen. Gehören alle zum selben
  // Projekt und hat die Rechnung noch keins, übernimmt sie dieses Projekt.
  async setDeliveryNotes(companyId: string, id: string, dto: SetDeliveryNotesDto) {
    const row = await this.findRow(companyId, id);
    const ids = [...new Set(dto.deliveryNoteIds)];
    const notes = await this.prisma.deliveryNote.findMany({
      where: { id: { in: ids }, companyId },
      select: { id: true, status: true, projectId: true, incomingInvoiceId: true },
    });
    if (notes.length !== ids.length) throw new NotFoundException('Lieferschein nicht gefunden.');
    if (notes.some((n) => n.status !== 'confirmed'))
      throw new BadRequestException('Nur bestätigte Lieferscheine lassen sich einer Rechnung zuordnen.');
    if (notes.some((n) => n.incomingInvoiceId && n.incomingInvoiceId !== id))
      throw new ConflictException('Ein Lieferschein ist schon mit einer anderen Rechnung abgerechnet.');
    const projects = [...new Set(notes.map((n) => n.projectId).filter((p): p is string => !!p))];
    await this.prisma.$transaction(async (tx) => {
      await tx.deliveryNote.updateMany({
        where: { companyId, incomingInvoiceId: id, id: { notIn: ids } },
        data: { incomingInvoiceId: null },
      });
      // nur noch freie übernehmen – gleichzeitig vergebene bleiben bei der anderen Rechnung
      const { count } = await tx.deliveryNote.updateMany({
        where: {
          companyId,
          id: { in: ids },
          OR: [{ incomingInvoiceId: null }, { incomingInvoiceId: id }],
        },
        data: { incomingInvoiceId: id },
      });
      if (count !== ids.length)
        throw new ConflictException('Ein Lieferschein ist schon mit einer anderen Rechnung abgerechnet.');
      if (!row.projectId && projects.length === 1)
        await tx.incomingInvoice.updateMany({ where: { id, companyId }, data: { projectId: projects[0] } });
    });
    return this.deliveryNotes(companyId, id);
  }

  // Löschen samt Beleg; die Abbuchung bleibt unverändert im Kontoauszug
  async remove(companyId: string, id: string) {
    const row = await this.findRow(companyId, id);
    const document = row.documentId
      ? await this.prisma.document.findFirst({
          where: { id: row.documentId, companyId, documentType: PAYABLE_DOCUMENT_TYPE },
        })
      : null;
    await this.prisma.$transaction(async (tx) => {
      await tx.incomingInvoice.deleteMany({ where: { id, companyId } });
      if (document) {
        await tx.ocrJob.deleteMany({ where: { companyId, documentId: document.id } });
        await tx.document.deleteMany({ where: { id: document.id, companyId } });
      }
    });
    if (document) await this.removeFile(companyId, document.id, document.storagePath);
    return { deleted: true };
  }

  // Datei eines gelöschten Belegs entfernen; ein Fehler bleibt nur im Log
  private async removeFile(companyId: string, documentId: string, storagePath: string) {
    await this.storage
      .remove(companyId, storagePath)
      .catch((error) =>
        this.logger.error({ msg: 'Beleg-Datei nicht gelöscht', documentId, error: String(error) }),
      );
  }

  // Eingelesener Beleg, der doch nicht erfasst wird ("Verwerfen")
  // Beleg von der KI lesen lassen (Aufgabe „beleg_lesen“, Anbieter mit
  // „Bilder verstehen“): Foto oder die ersten Seiten der PDF als Bild. Das
  // Ergebnis ist wie beim Texterkennen nur ein Vorschlag fürs Formular.
  async readWithAi(caller: Caller, documentId: string) {
    const { companyId } = caller;
    const document = await this.prisma.document.findFirst({
      where: { id: documentId, companyId, documentType: PAYABLE_DOCUMENT_TYPE },
    });
    if (!document) throw new NotFoundException('Beleg nicht gefunden.');
    const images = await imagesForAi(await this.storage.read(companyId, document.storagePath));
    const company = await this.company(companyId);
    const result = await this.ai.runTask(caller, 'beleg_lesen', AI_READ_PROMPT, undefined, images);
    // eigene Agenten dürfen die Felder auch strukturiert in `data` liefern
    const structured = result.data && Object.keys(EMPTY_DRAFT).some((key) => key in result.data!);
    const draft = draftFromAi(
      structured ? result.data! : jsonFromText(result.text),
      company.iban ? [company.iban] : [],
    );
    const categoryId = draft.supplierName
      ? await this.suggestCategory(companyId, draft.supplierName, draft.supplierIban)
      : null;
    const duplicateOf = await this.findDuplicate(companyId, draft.supplierName, draft.invoiceNumber);
    return {
      draft: { ...draft, categoryId },
      duplicateOf: duplicateOf ? this.view(duplicateOf) : null,
      providerName: result.providerName,
      readable: Object.values(draft).some((v) => v !== null),
    };
  }

  async discardDocument(companyId: string, documentId: string) {
    const document = await this.prisma.document.findFirst({
      where: {
        id: documentId,
        companyId,
        documentType: PAYABLE_DOCUMENT_TYPE,
        projectId: null,
        payable: null,
      },
    });
    if (!document) throw new NotFoundException('Beleg nicht gefunden oder schon einer Rechnung zugeordnet.');
    await this.prisma.$transaction([
      this.prisma.ocrJob.deleteMany({ where: { companyId, documentId } }),
      this.prisma.document.deleteMany({ where: { id: documentId, companyId, payable: null } }),
    ]);
    await this.storage
      .remove(companyId, document.storagePath)
      .catch((error) =>
        this.logger.error({ msg: 'Beleg-Datei nicht gelöscht', documentId, error: String(error) }),
      );
    return { deleted: true };
  }

  async file(companyId: string, id: string) {
    const row = await this.findRow(companyId, id);
    if (!row.documentId) throw new NotFoundException('Zu dieser Rechnung gibt es keinen Beleg.');
    const document = await this.prisma.document.findFirstOrThrow({
      where: { id: row.documentId, companyId },
    });
    return { fileName: document.fileName, content: await this.storage.read(companyId, document.storagePath) };
  }

  // Liste; offene mit Vorschlag der passenden Abbuchung
  async list(companyId: string, query: ListPayablesDto) {
    const status = query.status ?? 'open';
    const company = await this.company(companyId);
    const today = localDayString(new Date(), company.timeZone);
    const rows = await this.prisma.incomingInvoice.findMany({
      where: {
        companyId,
        ...(status === 'all' ? {} : { status }),
        ...(query.projectId ? { projectId: query.projectId } : {}),
      },
      include: this.include,
      orderBy:
        status === 'open'
          ? [{ dueDate: 'asc' }, { createdAt: 'asc' }]
          : [{ paidAt: 'desc' }, { createdAt: 'desc' }],
      take: 500,
    });
    const open = rows.filter((r) => r.status === 'open');
    const matches = open.length
      ? bestMatches(
          open.map((r) => this.matchable(r)),
          await this.freeDebits(companyId, this.since(open, today)),
        )
      : [];
    const items = rows.map((r) => {
      const match = matches.find((m) => m.payableId === r.id);
      const plan = r.status === 'open' ? plannedPayment(this.planInput(r), today) : null;
      return {
        ...this.view(r),
        plan,
        match: match
          ? {
              transactionId: match.debit.id,
              bookingDate: match.debit.bookingDate,
              amount: match.debit.amount,
              counterpartyName: match.debit.counterpartyName,
              reasons: match.reasons,
            }
          : null,
      };
    });
    // offene nach dem geplanten Zahltag
    if (status === 'open') items.sort((a, b) => a.plan!.date.localeCompare(b.plan!.date));
    return items;
  }

  // frühestes Datum, ab dem Abbuchungen in Frage kommen (höchstens 180 Tage zurück)
  private since(open: IncomingInvoice[], today: string) {
    const window = new Date(`${today}T00:00:00Z`);
    window.setUTCDate(window.getUTCDate() - MATCH_WINDOW_DAYS);
    const floor = window.toISOString().slice(0, 10);
    const earliest = open.map((r) => this.matchable(r).earliest).sort()[0];
    return earliest && earliest > floor ? earliest : floor;
  }

  // Nach dem Kontoauszug-Import bzw. Erfassen: eindeutige Treffer (Betrag
  // und Rechnungsnummer im Verwendungszweck) gleich als bezahlt verbuchen
  async autoMatch(companyId: string) {
    const open = await this.prisma.incomingInvoice.findMany({ where: { companyId, status: 'open' } });
    if (!open.length) return { paid: 0 };
    const company = await this.company(companyId);
    const today = localDayString(new Date(), company.timeZone);
    const matches = bestMatches(
      open.map((r) => this.matchable(r)),
      await this.freeDebits(companyId, this.since(open, today)),
    ).filter((m) => m.auto);
    let paid = 0;
    for (const m of matches) {
      try {
        await this.pay(companyId, m.payableId, { bankTransactionId: m.debit.id });
        paid++;
      } catch (error) {
        // inzwischen von Hand verbucht oder Abbuchung anders zugeordnet
        if (!(error instanceof ConflictException)) throw error;
      }
    }
    return { paid };
  }

  // für Aufrufer, deren eigentliche Arbeit schon gespeichert ist
  async autoMatchSafely(companyId: string) {
    try {
      return await this.autoMatch(companyId);
    } catch (error) {
      this.logger.error({
        msg: 'Abgleich der Eingangsrechnungen fehlgeschlagen',
        companyId,
        error: String(error),
      });
      return { paid: 0 };
    }
  }

  async pay(companyId: string, id: string, dto: PayPayableDto) {
    const row = await this.findRow(companyId, id);
    if (row.status !== 'open') throw new ConflictException('Diese Rechnung ist nicht mehr offen.');
    let paidAt: string;
    let paidAmount: string;
    let categoryForTransaction: string | null = null;
    if (dto.bankTransactionId) {
      const tx = await this.prisma.bankTransaction.findFirst({
        where: { id: dto.bankTransactionId, companyId, direction: 'debit' },
      });
      if (!tx) throw new NotFoundException('Abbuchung nicht gefunden.');
      paidAt = day(tx.bookingDate)!;
      paidAmount = tx.amount.toFixed(2);
      if (row.categoryId && !tx.categoryId && tx.categorySource === null)
        categoryForTransaction = row.categoryId;
    } else {
      const company = await this.company(companyId);
      paidAt = dto.paidAt ?? localDayString(new Date(), company.timeZone);
      if (!isValidDay(paidAt)) throw new BadRequestException('Ungültiges Datum.');
      const discounted = discountedAmount(row.amount.toFixed(2), row.discountPercent?.toFixed(2) ?? null);
      const inTime = row.discountUntil && paidAt <= day(row.discountUntil)!;
      paidAmount = dto.amount?.toFixed(2) ?? (discounted && inTime ? discounted : row.amount.toFixed(2));
    }
    try {
      await this.prisma.$transaction(async (tx) => {
        // bedingt: gleichzeitiges Verbuchen gelingt nur einmal
        const { count } = await tx.incomingInvoice.updateMany({
          where: { id, companyId, status: 'open' },
          data: {
            status: 'paid',
            paidAt: new Date(`${paidAt}T00:00:00Z`),
            paidAmount,
            bankTransactionId: dto.bankTransactionId ?? null,
          },
        });
        if (count === 0) throw new ConflictException('Diese Rechnung ist nicht mehr offen.');
        // Kategorie der Rechnung an die Abbuchung, wenn sie noch keine hat
        if (categoryForTransaction) {
          await tx.bankTransaction.updateMany({
            where: { id: dto.bankTransactionId, companyId, categoryId: null, categorySource: null },
            data: { categoryId: categoryForTransaction, categorySource: 'rule', categorizedAt: new Date() },
          });
        }
      });
    } catch (error) {
      this.conflict(error);
    }
    return this.view(await this.findRow(companyId, id));
  }

  // wieder offen (falsch zugeordnet) bzw. storniert/ohne Zahlung erledigt
  async reopen(companyId: string, id: string) {
    const row = await this.findRow(companyId, id);
    await this.prisma.incomingInvoice.updateMany({
      where: { id, companyId },
      data: {
        status: 'open',
        paidAt: null,
        paidAmount: null,
        bankTransactionId: null,
        // falsch zugeordnete Abbuchung nicht wieder vorschlagen oder automatisch verbuchen
        ...(row.bankTransactionId && !row.rejectedTransactionIds.includes(row.bankTransactionId)
          ? { rejectedTransactionIds: { push: row.bankTransactionId } }
          : {}),
      },
    });
    return this.view(await this.findRow(companyId, id));
  }

  async cancel(companyId: string, id: string) {
    const row = await this.findRow(companyId, id);
    if (row.status === 'paid') throw new ConflictException('Bezahlte Rechnungen zuerst wieder öffnen.');
    await this.prisma.incomingInvoice.updateMany({ where: { id, companyId }, data: { status: 'cancelled' } });
    return this.view(await this.findRow(companyId, id));
  }

  // Offene Eingangsrechnungen mit geplantem Zahltag (für Vorschau und
  // Jahresüberblick). Ohne die, zu denen schon eine passende Abbuchung im
  // Kontoauszug steht – die ist im Kontostand bzw. bei den Ausgaben enthalten.
  async openPlan(companyId: string, today: string) {
    const open = await this.prisma.incomingInvoice.findMany({ where: { companyId, status: 'open' } });
    if (!open.length) return [];
    const matched = new Set(
      bestMatches(
        open.map((r) => this.matchable(r)),
        await this.freeDebits(companyId, this.since(open, today)),
      ).map((m) => m.payableId),
    );
    return open
      .filter((r) => !matched.has(r.id))
      .map((r) => ({
        id: r.id,
        name: r.invoiceNumber ? `${r.supplierName} (${r.invoiceNumber})` : r.supplierName,
        categoryId: r.categoryId,
        ...plannedPayment(this.planInput(r), today),
      }));
  }
}
